import { useRequestFetch } from '#app'

import {
  catalogTimelineEpisodesResponseSchema,
  catalogTimelineResponseSchema,
  type CatalogTimelineEpisode,
  type CatalogTimelineItem
} from '@tv/shared/catalog-timeline'

import { isRecord } from '@tv/shared/type-guards'
import { computed, onScopeDispose, reactive, ref, watch, type Ref } from 'vue'
import * as v from 'valibot'
import { useRequestCancellation } from '~/composables/use-request-cancellation.ts'
import { timelineItemKey } from '~/utils/title-timeline.ts'

interface TimelineOptions {
  automaticLoad?: boolean;
  timeZone: Readonly<Ref<string | null>>;
  viewingContext: Readonly<Ref<string>>;
}

interface TimelineEpisodeGroup {
  items: CatalogTimelineEpisode[];
  nextCursor: string | null;
  isLoading: boolean;
  isLoaded: boolean;
  error: string;
}

type EpisodeGroupRow = Extract<CatalogTimelineItem, { kind: 'episode_group' }>

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
  const groupState = new Map<string, TimelineEpisodeGroup>()
  const groups = reactive(groupState)
  const groupRequests = new Map<string, InstanceType<typeof globalThis.AbortController>>()
  const canLoadMore = computed(() => nextCursor.value !== null && !isLoadingMore.value)
  let generation = 0

  function cancelGroups(): void {
    generation += 1

    const controllers = groupRequests.values()

    for (const controller of controllers) { controller.abort() }

    groupRequests.clear()

    const activeGroups = groups.values()

    for (const group of activeGroups) { group.isLoading = false }
  }

  function reset(): void {
    reads.cancel()
    cancelGroups()

    items.value = []
    nextCursor.value = null
    status.value = 'idle'
    isLoadingMore.value = false
    readError.value = ''
    failedPage.value = null
    unauthorized.value = false

    groups.clear()
  }

  function path(): string | null {
    if (accountId.value === null || catalogItemId.value === null || timeZone.value === null) { return null }

    const encodedId = encodeURIComponent(catalogItemId.value)

    return `/api/catalog/items/${encodedId}/timeline`
  }

  function syncGroups(replacements: CatalogTimelineItem[]): void {
    cancelGroups()

    const groupIds = groups.keys()

    for (const id of groupIds) {
      const previous = items.value.find(item => {
        const key = timelineItemKey(item)

        return key === id
      })

      const replacement = replacements.find(item => {
        const key = timelineItemKey(item)

        return key === id
      })

      const sameSnapshot = previous?.kind === 'episode_group' && replacement?.kind === 'episode_group' && previous.episodesCursor === replacement.episodesCursor

      if (!sameSnapshot) { groups.delete(id) }
    }
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

      if (!more) { syncGroups(page.items) }

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

  function groupFor(id: string): TimelineEpisodeGroup {
    let group = groups.get(id)

    if (group === undefined) {
      group = {
        items: [],
        nextCursor: null,
        isLoading: false,
        isLoaded: false,
        error: ''
      }

      groups.set(id, group)
    }

    return groups.get(id) ?? group
  }

  async function loadEpisodes(row: EpisodeGroupRow, more = false): Promise<boolean> {
    const url = path()
    const zone = timeZone.value
    const key = timelineItemKey(row)
    const group = groupFor(key)

    if (url === null || zone === null || group.isLoading || (more && group.nextCursor === null)) { return false }

    const controller = new globalThis.AbortController()
    const requestGeneration = generation
    const cursor = more ? group.nextCursor : null
    const cursorQuery = cursor === null ? {} : { cursor }

    const query = {
      timeZone: zone,
      viewingId: row.viewingId,
      localDate: row.localDate,
      groupCursor: row.episodesCursor,
      ...cursorQuery
    }

    groupRequests.set(key, controller)

    group.isLoading = true
    group.error = ''

    const episodesUrl = `${url}/episodes`

    try {
      const response: unknown = await requestFetch(episodesUrl, {
        query,
        retry: 0,
        signal: controller.signal
      })

      if (controller.signal.aborted || requestGeneration !== generation) { return false }

      const page = v.parse(catalogTimelineEpisodesResponseSchema, response)
      const existingIds = group.items.map(item => item.id)
      const known = new Set(existingIds)
      const added = page.items.filter(item => !known.has(item.id))

      group.items = more ? [...group.items, ...added] : page.items
      group.nextCursor = page.nextCursor
      group.isLoaded = true

      return true
    } catch (error) {
      if (controller.signal.aborted || requestGeneration !== generation) { return false }

      if (isRecord(error) && error.statusCode === 401) {
        unauthorized.value = true
      } else {
        globalThis.console.warn({
          error,
          message: 'Timeline episode group request failed.'
        })

        group.error = 'We couldn’t load these episodes. Try again.'
      }

      return false
    } finally {
      if (groupRequests.get(key) === controller) {
        groupRequests.delete(key)

        group.isLoading = false
      }
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
    cancelGroups()

    isLoadingMore.value = false

    if (automaticLoad) { void load() }
  }, { flush: 'sync' })

  onScopeDispose(cancelGroups)

  return {
    failedPage,
    groupFor,
    isLoadingMore,
    items,
    load,
    loadEpisodes,
    nextCursor,
    readError,
    status,
    unauthorized
  }
}

export { useTitleTimeline }
export type TitleTimelineState = ReturnType<typeof useTitleTimeline>
