import { useRequestFetch } from '#app'

import {
  catalogTimelineResponseSchema,
  type CatalogTimelineItem,
  type CatalogTimelineQuery
} from '@tv/shared/catalog-timeline'

import { isRecord } from '@tv/shared/type-guards'
import { ref, shallowRef, toRef, watch, type Ref } from 'vue'
import * as v from 'valibot'
import { useRequestCancellation } from '~/composables/use-request-cancellation.ts'
import { timelineItemKey } from '~/utils/title-timeline.ts'

interface TimelineOptions {
  automaticLoad?: boolean;
  mutationVersion: Readonly<Ref<number>>;
  timeZone: Readonly<Ref<string | null>>;
  viewingContext: Readonly<Ref<string>>;
}

function useTitleTimeline(catalogItemId: Readonly<Ref<string | null>>, accountId: Readonly<Ref<string | null>>, { automaticLoad = import.meta.client, mutationVersion, timeZone, viewingContext }: TimelineOptions) {
  const requestFetch = useRequestFetch()
  const reads = useRequestCancellation()
  const items = ref<CatalogTimelineItem[]>([])
  const nextCursor = shallowRef<string | null>(null)
  const status = shallowRef<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const isLoadingMore = shallowRef(false)
  const readError = shallowRef('')
  const failedPage = shallowRef<'first' | 'more' | null>(null)
  const unauthorized = shallowRef(false)
  const didRecoverCursor = shallowRef(false)
  const canLoadMore = toRef(() => nextCursor.value !== null && !isLoadingMore.value)

  function reset(): void {
    reads.cancel()

    items.value = []
    nextCursor.value = null
    status.value = 'idle'
    isLoadingMore.value = false
    readError.value = ''
    failedPage.value = null
    unauthorized.value = false
    didRecoverCursor.value = false
  }

  function path(): string | null {
    if (accountId.value === null || catalogItemId.value === null || timeZone.value === null) { return null }

    const encodedId = encodeURIComponent(catalogItemId.value)

    return `/api/catalog/items/${encodedId}/timeline`
  }

  async function requestHistoryPage(url: string, query: CatalogTimelineQuery, signal: AbortSignal) {
    try {
      const response: unknown = await requestFetch(url, {
        query,
        retry: 0,
        signal
      })

      return {
        response,
        recovered: false
      }
    } catch (error) {
      const expiredCursor = query.cursor !== undefined && isRecord(error) && error.statusCode === 400

      if (!expiredCursor || signal.aborted) { throw error }

      // Preserve visible history while replacing a cursor invalidated by a deployment.
      const response: unknown = await requestFetch(url, {
        query: { timeZone: query.timeZone },
        retry: 0,
        signal
      })

      return {
        response,
        recovered: true
      }
    }
  }

  function mergePage(nextItems: CatalogTimelineItem[], replacePage: boolean): void {
    const entries = replacePage ? [] : items.value.map(item => {
      const key = timelineItemKey(item)

      return [key, item] as const
    })

    const records = new Map<string, CatalogTimelineItem>(entries)

    for (const item of nextItems) {
      const key = timelineItemKey(item)

      records.set(key, item)
    }

    const recordsIterator = records.values()

    items.value = [...recordsIterator]
  }

  async function load(more = false): Promise<boolean> {
    const url = path()
    const zone = timeZone.value

    if (url === null || zone === null || (more && !canLoadMore.value)) { return false }

    const request = reads.start()
    const cursor = more ? nextCursor.value : null
    const hadData = status.value === 'loaded'

    const query = cursor === null ? { timeZone: zone } : {
      timeZone: zone,
      cursor
    }

    isLoadingMore.value = more
    readError.value = ''
    failedPage.value = null
    didRecoverCursor.value = false

    if (!hadData) { status.value = 'loading' }

    try {
      const pageRequest = await requestHistoryPage(url, query, request.signal)
      const isCurrent = reads.isCurrent(request)

      if (!isCurrent) { return false }

      const page = v.parse(catalogTimelineResponseSchema, pageRequest.response)

      mergePage(page.items, !more || pageRequest.recovered)

      didRecoverCursor.value = pageRequest.recovered
      nextCursor.value = page.nextCursor
      status.value = 'loaded'

      return true
    } catch (error) {
      const isCurrent = reads.isCurrent(request)

      if (!isCurrent) { return false }

      const isErrorRecord = isRecord(error)

      if (isErrorRecord && error.statusCode === 401) {
        unauthorized.value = true
      } else {
        globalThis.console.warn({
          error,
          message: 'Title timeline request failed.'
        })

        readError.value = more ? 'We couldn’t load more history. Try again.' : 'We couldn’t refresh your timeline. Try again.'
        failedPage.value = more ? 'more' : 'first'

        if (!hadData) { status.value = 'error' }
      }

      return false
    } finally {
      const isFinished = reads.finish(request)

      if (isFinished) { isLoadingMore.value = false }
    }
  }

  const identitySources = [() => catalogItemId.value, () => accountId.value, () => timeZone.value]
  const mutationSources = [() => viewingContext.value, () => mutationVersion.value]
  const reloadSources = [...identitySources, ...mutationSources]

  watch(identitySources, () => {
    reset()
  }, {
    flush: 'sync',
    immediate: true
  })

  watch(mutationSources, () => {
    reads.cancel()

    isLoadingMore.value = false
  }, { flush: 'sync' })

  // Batch identity, context and confirmed-mutation changes into one reload.
  watch(reloadSources, () => {
    if (automaticLoad) { void load() }
  }, { immediate: true })

  return {
    didRecoverCursor,
    failedPage,
    isLoadingMore,
    items,
    load,
    nextCursor,
    readError,
    status,
    unauthorized
  }
}

export { useTitleTimeline }
export type TitleTimelineState = ReturnType<typeof useTitleTimeline>
