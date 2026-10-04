import { useAsyncData, useRequestFetch } from '#app'
import type { CatalogEpisodeRatingSummary, CatalogRatingSummaryResponse } from '@tv/shared/catalog'
import { computed, onScopeDispose, reactive, watch } from 'vue'
import * as v from 'valibot'
import { useEpisodeRatingRequests } from '~/composables/use-episode-rating-requests.ts'

import {
  episodeRatingsSeasonPath,
  hasCompleteEpisodeRatings,
  type EpisodeRatingSeason
} from '~/utils/catalog-episode-ratings.ts'

import {
  catalogEpisodeRatingSummariesResponseSchema,
  catalogRatingSummaryResponseSchema
} from '~/utils/catalog-response.ts'

interface EpisodeRatingSummaryState {
  summary: CatalogRatingSummaryResponse | undefined;
  hasError: boolean;
  isLoading: boolean;
}

type EpisodeSummariesOutcome =
  | { status: 'loaded'; items: CatalogEpisodeRatingSummary[]; revision: number }
  | { status: 'error'; revision: number }

// Public summaries survive account changes; the mounted season owns all requests.
function useCatalogEpisodeRatingSummaries(season: EpisodeRatingSeason, episodeIds: string[]) {
  const requestFetch = useRequestFetch()
  const requests = useEpisodeRatingRequests()
  const initialEntries = new Map<string, EpisodeRatingSummaryState>()
  const entries = reactive(initialEntries)
  const seasonPath = episodeRatingsSeasonPath(season)
  const key = `catalog-episode-rating-summaries:${seasonPath}`

  for (const id of episodeIds) {
    entries.set(id, {
      summary: undefined,
      hasError: false,
      isLoading: true
    })
  }

  const ready = useAsyncData(key, async (_app, { signal }): Promise<EpisodeSummariesOutcome> => {
    const request = requests.start('batch')
    const combinedSignal = globalThis.AbortSignal.any([signal, request.controller.signal])

    try {
      const url = `${seasonPath}/rating-summaries`

      const response = await requestFetch(url, {
        retry: 0,
        signal: combinedSignal
      })

      combinedSignal.throwIfAborted()

      const parsed = v.parse(catalogEpisodeRatingSummariesResponseSchema, response)

      if (!hasCompleteEpisodeRatings(parsed.items, episodeIds)) {
        throw new Error('Episode rating summaries did not match the requested season.')
      }

      return {
        status: 'loaded',
        items: parsed.items,
        revision: request.revision
      }
    } catch (error) {
      if (combinedSignal.aborted) {
        throw error
      }

      globalThis.console.warn({
        error,
        message: 'Catalog episode rating summaries request failed.'
      })

      return {
        status: 'error',
        revision: request.revision
      }
    } finally {
      requests.finish('batch', request)
    }
  }, {
    dedupe: 'cancel',
    lazy: true
  })

  const batchError = computed(() => ready.data.value?.status === 'error' || ready.status.value === 'error')
  const isBatchLoading = computed(() => ready.status.value === 'idle' || ready.status.value === 'pending')

  watch(ready.data, outcome => {
    if (outcome === undefined) {
      return
    }

    const summariesById = new Map<string, CatalogEpisodeRatingSummary>()

    if (outcome.status === 'loaded') {
      for (const item of outcome.items) {
        summariesById.set(item.episodeId, item)
      }
    }

    for (const id of episodeIds) {
      const entry = entries.get(id)

      if (entry !== undefined && requests.canApplyBatch(id, outcome.revision)) {
        entry.isLoading = false

        if (outcome.status === 'loaded') {
          const result = summariesById.get(id)

          if (result !== undefined) {
            entry.summary = {
              averageScore: result.averageScore,
              ratingCount: result.ratingCount
            }
            entry.hasError = false
          }
        }
      }
    }
  }, {
    immediate: true,
    flush: 'sync'
  })

  async function reload(episodeId: string): Promise<void> {
    const entry = entries.get(episodeId)

    if (entry === undefined) {
      return
    }

    const request = requests.start(episodeId)

    entry.isLoading = true

    try {
      const id = encodeURIComponent(episodeId)
      const url = `/api/catalog/episodes/${id}/rating-summary`

      const response = await requestFetch(url, {
        retry: 0,
        signal: request.controller.signal
      })

      if (!requests.isCurrent(episodeId, request)) {
        return
      }

      entry.summary = v.parse(catalogRatingSummaryResponseSchema, response)
      entry.hasError = false
    } catch (error) {
      if (!requests.isCurrent(episodeId, request)) {
        return
      }

      globalThis.console.warn({
        error,
        message: 'Catalog episode rating summary request failed.'
      })

      entry.hasError = true
    } finally {
      if (requests.finish(episodeId, request)) {
        entry.isLoading = false
      }
    }
  }

  function summaryFor(episodeId: string): EpisodeRatingSummaryState {
    const entry = entries.get(episodeId)

    if (entry === undefined) {
      throw new Error('Episode is outside the active rating season.')
    }

    return entry
  }

  onScopeDispose(() => { ready.clear() })

  return {
    ready,
    batchError,
    isBatchLoading,
    reload,
    summaryFor
  }
}

export { useCatalogEpisodeRatingSummaries }
