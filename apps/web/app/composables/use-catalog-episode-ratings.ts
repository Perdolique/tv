import { useRequestFetch } from '#app'
import { isRecord } from '@tv/shared/type-guards'
import { reactive, shallowRef, toRef, watch, type Ref } from 'vue'
import * as v from 'valibot'
import type { RatingStatus } from '~/composables/use-catalog-rating.ts'
import { useEpisodeRatingRequests } from '~/composables/use-episode-rating-requests.ts'

import {
  episodeRatingsSeasonPath,
  hasCompleteEpisodeRatings,
  type EpisodeRatingSeason
} from '~/utils/catalog-episode-ratings.ts'

import { catalogEpisodeRatingsResponseSchema, catalogRatingMutationResponseSchema } from '@tv/shared/catalog-viewings'
import type { CatalogViewingsState } from '~/composables/use-catalog-viewings.ts'

interface EpisodeRatingState {
  score: number | null;
  status: RatingStatus;
  isSaving: boolean;
  saveError: string;
}

interface EpisodeRatingsOptions {
  season: EpisodeRatingSeason;
  episodeIds: string[];
  accountId: Readonly<Ref<string | null>>;
  viewings: CatalogViewingsState;
}

// A mounted season owns private score reads; the title owner serializes its mutations.
function useCatalogEpisodeRatings({ season, episodeIds, accountId, viewings }: EpisodeRatingsOptions) {
  const requestFetch = useRequestFetch()
  const requests = useEpisodeRatingRequests()
  const initialEntries = new Map<string, EpisodeRatingState>()
  const entries = reactive(initialEntries)
  const batchError = shallowRef(false)
  const isBatchLoading = shallowRef(false)
  const unauthorized = shallowRef<'load' | 'mutation' | null>(null)
  const seasonPath = episodeRatingsSeasonPath(season)
  const needsViewing = toRef(() => viewings.summary.value.currentViewingId === null && viewings.selectedViewingId.value === null)
  const { isSaving } = viewings
  const canLoad = toRef(() => accountId.value !== null && !isSaving.value && viewings.pendingMutation.value === null)
  let writeRequest: object | null = null

  function reset(): void {
    requests.cancel()
    entries.clear()

    for (const id of episodeIds) {
      entries.set(id, {
        score: null,
        status: 'idle',
        isSaving: false,
        saveError: ''
      })
    }

    batchError.value = false
    isBatchLoading.value = false
    unauthorized.value = null
  }

  async function loadBatch(): Promise<void> {
    if (!canLoad.value) {
      return
    }

    const request = requests.start('batch')

    isBatchLoading.value = true

    try {
      const url = `${seasonPath}/ratings`
      const viewingId = viewings.selectedViewingId.value

      const response = await requestFetch(url, {
        query: viewingId === null ? undefined : { viewingId },
        retry: 0,
        signal: request.controller.signal
      })

      if (!requests.isCurrent('batch', request)) {
        return
      }

      const parsed = v.parse(catalogEpisodeRatingsResponseSchema, response)

      if (!hasCompleteEpisodeRatings(parsed.items, episodeIds)) {
        throw new Error('Episode ratings did not match the requested season.')
      }

      if (viewingId !== null && parsed.viewing?.id !== viewingId) { throw new Error('Episode ratings viewing mismatch') }

      viewings.applyConfirmed(parsed)

      batchError.value = false

      for (const item of parsed.items) {
        const entry = entries.get(item.episodeId)

        if (entry !== undefined && requests.canApplyBatch(item.episodeId, request.revision)) {
          entry.score = item.score
          entry.status = 'loaded'
        }
      }
    } catch (error) {
      if (!requests.isCurrent('batch', request)) {
        return
      }

      if (isRecord(error) && error.statusCode === 401) {
        unauthorized.value = 'load'

        return
      }

      globalThis.console.warn({
        error,
        message: 'Catalog episode ratings request failed.'
      })

      batchError.value = true

      for (const [id, entry] of entries) {
        if (entry.status !== 'loaded' && requests.canApplyBatch(id, request.revision)) {
          entry.status = 'error'
        }
      }
    } finally {
      if (requests.finish('batch', request)) {
        isBatchLoading.value = false
      }
    }
  }

  async function load(episodeId: string): Promise<void> {
    const entry = entries.get(episodeId)

    if (entry === undefined || entry.isSaving || accountId.value === null || viewings.pendingMutation.value !== null) {
      return
    }

    const request = requests.start(episodeId)

    entry.status = 'loading'
    entry.saveError = ''

    try {
      const id = encodeURIComponent(episodeId)
      const url = `/api/catalog/episodes/${id}/rating`
      const viewingId = viewings.selectedViewingId.value

      const response = await requestFetch(url, {
        query: viewingId === null ? undefined : { viewingId },
        retry: 0,
        signal: request.controller.signal
      })

      if (!requests.isCurrent(episodeId, request)) {
        return
      }

      const parsed = v.parse(catalogRatingMutationResponseSchema, response)

      viewings.applyConfirmed(parsed)

      const currentEntry = entries.get(episodeId)

      if (currentEntry !== undefined) {
        currentEntry.score = parsed.score
        currentEntry.status = 'loaded'
      }
    } catch (error) {
      if (!requests.isCurrent(episodeId, request)) {
        return
      }

      if (isRecord(error) && error.statusCode === 401) {
        unauthorized.value = 'load'

        return
      }

      globalThis.console.warn({
        error,
        message: 'Catalog episode rating request failed.'
      })

      entry.status = 'error'
    } finally {
      requests.finish(episodeId, request)
    }
  }

  function mutationKey(episodeId: string): string {
    return `rating:episode:${episodeId}:${viewings.selectedViewingId.value ?? 'current'}`
  }

  async function save(episodeId: string, score: number | null, viewingDate?: string): Promise<boolean> {
    const entry = entries.get(episodeId)

    if (entry?.status !== 'loaded' || accountId.value === null || isSaving.value) { return false }

    requests.cancel()

    entry.isSaving = true
    entry.saveError = ''

    const requestAccount = accountId.value
    const requestViewingId = viewings.selectedViewingId.value
    const request = {}

    writeRequest = request

    const id = encodeURIComponent(episodeId)
    const itemId = encodeURIComponent(season.catalogItemId)
    const selected = viewings.selectedViewing.value
    const historical = viewings.isHistorical.value && selected !== null
    const viewingId = selected === null ? '' : encodeURIComponent(selected.id)
    const url = historical ? `/api/catalog/items/${itemId}/viewings/${viewingId}/episodes/${id}/rating` : `/api/catalog/episodes/${id}/rating`
    const key = mutationKey(episodeId)
    const ratingViewing = historical ? selected : undefined

    const response = await viewings.saveScore({
      url,
      key,
      score,
      viewingDate,
      viewing: ratingViewing
    })

    if (writeRequest === request) { writeRequest = null }

    if (requestAccount !== accountId.value || requestViewingId !== viewings.selectedViewingId.value) { return false }

    const currentEntry = entries.get(episodeId)

    if (currentEntry === undefined) { return false }

    currentEntry.isSaving = false

    if (response === null) {
      currentEntry.saveError = viewings.saveError.value
      unauthorized.value = viewings.unauthorized.value

      return false
    }

    const result = v.parse(catalogRatingMutationResponseSchema, response)

    currentEntry.score = result.score
    currentEntry.status = 'loaded'

    if (!import.meta.env.SSR) {
      const entryValues = entries.values()
      const currentEntries = [...entryValues]
      const needsScores = currentEntries.some(item => item.status === 'idle')

      if (needsScores) { void loadBatch() }
    }

    return true
  }

  function hasUnconfirmedMutation(episodeId: string): boolean {
    const key = mutationKey(episodeId)

    return viewings.unconfirmedMutation.value?.key === key
  }

  function isBlocked(episodeId: string): boolean {
    const key = mutationKey(episodeId)

    return viewings.isMutationBlocked(key)
  }

  async function retryMutation(): Promise<boolean> {
    const pendingKey = viewings.pendingMutation.value?.key
    const requestAccount = accountId.value
    const requestViewingId = viewings.selectedViewingId.value

    const episodeId = episodeIds.find(id => {
      const key = mutationKey(id)

      return key === pendingKey
    })

    const saved = await viewings.retryMutation()

    if (requestAccount !== accountId.value || requestViewingId !== viewings.selectedViewingId.value) { return false }

    const entry = episodeId === undefined ? undefined : entries.get(episodeId)

    if (entry !== undefined) {
      entry.saveError = saved ? '' : viewings.saveError.value
      unauthorized.value = viewings.unauthorized.value
    }

    if (saved) { await loadBatch() }

    return saved
  }

  function ratingFor(episodeId: string): EpisodeRatingState {
    const entry = entries.get(episodeId)

    if (entry === undefined) {
      throw new Error('Episode is outside the active rating season.')
    }

    return entry
  }

  watch([() => accountId.value, () => viewings.selectionKey.value], ([id]) => {
    reset()

    if (!import.meta.env.SSR && id !== null) {
      void loadBatch()
    }
  }, {
    immediate: true,
    flush: 'sync'
  })

  watch(viewings.isSaving, saving => {
    if (saving) { requests.cancel() }
    else if (!import.meta.env.SSR && writeRequest === null && viewings.pendingMutation.value === null) {
      const mutation = viewings.completedMutation.value
      const removedMark = mutation?.operation === 'watches' && mutation.method === 'DELETE'
      const entryValues = entries.values()
      const currentEntries = [...entryValues]
      const needsScores = currentEntries.some(entry => entry.status === 'idle' || entry.status === 'loading')

      if (removedMark || needsScores) { void loadBatch() }
    }
  }, { flush: 'sync' })

  return {
    hasUnconfirmedMutation,
    isBlocked,
    isSaving,
    needsViewing,
    retryMutation,
    batchError,
    isBatchLoading,
    unauthorized,
    loadBatch,
    load,
    save,
    ratingFor
  }
}

export { useCatalogEpisodeRatings }
export type { EpisodeRatingState }
