import { useRequestFetch } from '#app'
import { isRecord } from '@tv/shared/type-guards'
import { reactive, ref, watch, type Ref } from 'vue'
import * as v from 'valibot'
import type { RatingStatus } from '~/composables/use-catalog-rating.ts'
import { useEpisodeRatingRequests } from '~/composables/use-episode-rating-requests.ts'

import {
  episodeRatingsSeasonPath,
  hasCompleteEpisodeRatings,
  type EpisodeRatingSeason
} from '~/utils/catalog-episode-ratings.ts'

import { catalogEpisodeRatingsResponseSchema, catalogRatingResponseSchema } from '~/utils/catalog-response.ts'

interface EpisodeRatingState {
  score: number | null;
  status: RatingStatus;
  isSaving: boolean;
  saveError: string;
}

// One mounted season owns its private batch and independent episode mutations.
function useCatalogEpisodeRatings(season: EpisodeRatingSeason, episodeIds: string[], accountId: Readonly<Ref<string | null>>) {
  const requestFetch = useRequestFetch()
  const requests = useEpisodeRatingRequests()
  const initialEntries = new Map<string, EpisodeRatingState>()
  const entries = reactive(initialEntries)
  const batchError = ref(false)
  const isBatchLoading = ref(false)
  const unauthorized = ref<'load' | 'mutation' | null>(null)
  const seasonPath = episodeRatingsSeasonPath(season)

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
    if (accountId.value === null) {
      return
    }

    const request = requests.start('batch')

    isBatchLoading.value = true

    try {
      const url = `${seasonPath}/ratings`

      const response = await requestFetch(url, {
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

    if (entry === undefined || entry.isSaving || accountId.value === null) {
      return
    }

    const request = requests.start(episodeId)

    entry.status = 'loading'
    entry.saveError = ''

    try {
      const id = encodeURIComponent(episodeId)
      const url = `/api/catalog/episodes/${id}/rating`

      const response = await requestFetch(url, {
        retry: 0,
        signal: request.controller.signal
      })

      if (!requests.isCurrent(episodeId, request)) {
        return
      }

      const parsed = v.parse(catalogRatingResponseSchema, response)

      entry.score = parsed.score
      entry.status = 'loaded'
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

  async function save(episodeId: string, score: number | null): Promise<boolean> {
    const entry = entries.get(episodeId)

    if (entry === undefined || entry.isSaving || entry.status !== 'loaded' || accountId.value === null) {
      return false
    }

    const request = requests.start(episodeId)

    entry.isSaving = true
    entry.saveError = ''

    try {
      const id = encodeURIComponent(episodeId)
      const url = `/api/catalog/episodes/${id}/rating`
      const method = score === null ? 'DELETE' : 'PUT'
      const body = score === null ? undefined : { score }

      const response = await requestFetch(url, {
        method,
        body,
        retry: 0,
        signal: request.controller.signal
      })

      if (!requests.isCurrent(episodeId, request)) {
        return false
      }

      const parsed = v.parse(catalogRatingResponseSchema, response)

      if (parsed.score !== score) {
        throw new Error('Episode rating response did not match the requested score.')
      }

      entry.score = parsed.score

      return true
    } catch (error) {
      if (!requests.isCurrent(episodeId, request)) {
        return false
      }

      if (isRecord(error) && error.statusCode === 401) {
        unauthorized.value = 'mutation'

        return false
      }

      globalThis.console.warn({
        error,
        message: 'Catalog episode rating update request failed.'
      })

      entry.saveError = 'We couldn’t save your rating. Try again.'

      return false
    } finally {
      if (requests.finish(episodeId, request)) {
        entry.isSaving = false
      }
    }
  }

  function ratingFor(episodeId: string): EpisodeRatingState {
    const entry = entries.get(episodeId)

    if (entry === undefined) {
      throw new Error('Episode is outside the active rating season.')
    }

    return entry
  }

  watch(accountId, id => {
    reset()

    if (!import.meta.env.SSR && id !== null) {
      void loadBatch()
    }
  }, {
    immediate: true,
    flush: 'sync'
  })

  return {
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
