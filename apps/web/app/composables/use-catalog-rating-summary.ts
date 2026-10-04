import { useAsyncData, useRequestFetch } from '#app'
import type { CatalogRatingSummaryResponse } from '@tv/shared/catalog'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import * as v from 'valibot'
import { catalogRatingSummaryResponseSchema } from '~/utils/catalog-response.ts'

type RatingSummaryOutcome =
  | { status: 'loaded'; summary: CatalogRatingSummaryResponse }
  | { status: 'error' }

// Public data owns its request lifecycle, independently of account restoration.
function useCatalogRatingSummary(id: string) {
  const requestFetch = useRequestFetch()
  const key = `catalog-rating-summary:${id}`
  const encodedId = encodeURIComponent(id)
  const url = `/api/catalog/items/${encodedId}/rating-summary`
  const summary = shallowRef<CatalogRatingSummaryResponse>()

  const ready = useAsyncData(key, async (_app, { signal }): Promise<RatingSummaryOutcome> => {
    try {
      const response = await requestFetch(url, {
        retry: 0,
        signal
      })

      signal.throwIfAborted()

      const parsed = v.safeParse(catalogRatingSummaryResponseSchema, response)

      if (!parsed.success) {
        globalThis.console.error('Catalog rating summary response validation failed.', parsed.issues)

        return { status: 'error' }
      }

      return {
        status: 'loaded',
        summary: parsed.output
      }
    } catch (error) {
      if (signal.aborted) {
        throw error
      }

      globalThis.console.warn({
        error,
        message: 'Catalog rating summary request failed.'
      })

      return { status: 'error' }
    }
  }, {
    dedupe: 'cancel',
    lazy: true
  })

  watch(ready.data, outcome => {
    if (outcome?.status === 'loaded') {
      summary.value = outcome.summary
    }
  }, {
    immediate: true,
    flush: 'sync'
  })

  const hasError = computed(() => ready.data.value?.status === 'error' || ready.status.value === 'error')
  const isLoading = computed(() => ready.status.value === 'pending' || ready.status.value === 'idle')

  onScopeDispose(() => {
    ready.clear()

    summary.value = undefined
  })

  return {
    hasError,
    isLoading,
    ready,
    summary
  }
}

export { useCatalogRatingSummary }
