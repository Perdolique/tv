import { useRequestFetch } from '#app'
import { catalogTimelineResponseSchema, type CatalogTimelineItem } from '@tv/shared/catalog-timeline'
import { isRecord } from '@tv/shared/type-guards'
import { computed, ref, watch, type Ref } from 'vue'
import * as v from 'valibot'
import { useRequestCancellation } from '~/composables/use-request-cancellation.ts'
import { timelineItemKey } from '~/utils/title-timeline.ts'

interface TimelineOptions {
  automaticLoad?: boolean;
  timeZone: Readonly<Ref<string | null>>;
  viewingContext: Readonly<Ref<string>>;
}

function useTitleTimeline(catalogItemId: Readonly<Ref<string | null>>, accountId: Readonly<Ref<string | null>>, { automaticLoad = import.meta.client, timeZone, viewingContext }: TimelineOptions) {
  const requestFetch = useRequestFetch()
  const reads = useRequestCancellation()
  const items = ref<CatalogTimelineItem[]>([])
  const nextCursor = ref<string | null>(null)
  const status = ref<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const isLoadingMore = ref(false)
  const readError = ref('')
  const failedPage = ref<'first' | 'more' | null>(null)
  const unauthorized = ref(false)
  const canLoadMore = computed(() => nextCursor.value !== null && !isLoadingMore.value)

  function reset(): void {
    reads.cancel()

    items.value = []
    nextCursor.value = null
    status.value = 'idle'
    isLoadingMore.value = false
    readError.value = ''
    failedPage.value = null
    unauthorized.value = false
  }

  function path(): string | null {
    if (accountId.value === null || catalogItemId.value === null || timeZone.value === null) { return null }

    const encodedId = encodeURIComponent(catalogItemId.value)

    return `/api/catalog/items/${encodedId}/timeline`
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

    if (!hadData) { status.value = 'loading' }

    try {
      const response: unknown = await requestFetch(url, {
        query,
        retry: 0,
        signal: request.signal
      })

      if (!reads.isCurrent(request)) { return false }

      const page = v.parse(catalogTimelineResponseSchema, response)
      const existingIds = items.value.map(timelineItemKey)
      const known = new Set(existingIds)

      const added = page.items.filter(item => {
        const key = timelineItemKey(item)

        return !known.has(key)
      })

      items.value = more ? [...items.value, ...added] : page.items
      nextCursor.value = page.nextCursor
      status.value = 'loaded'

      return true
    } catch (error) {
      if (!reads.isCurrent(request)) { return false }

      if (isRecord(error) && error.statusCode === 401) {
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
      if (reads.finish(request)) { isLoadingMore.value = false }
    }
  }

  watch([catalogItemId, accountId, timeZone], () => {
    reset()

    if (automaticLoad) { void load() }
  }, {
    flush: 'sync',
    immediate: true
  })

  watch(viewingContext, () => {
    reads.cancel()

    isLoadingMore.value = false

    if (automaticLoad) { void load() }
  }, { flush: 'sync' })

  return {
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
