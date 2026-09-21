import { useAsyncData, useRequestFetch } from '#app'
import type { CatalogEpisode } from '@tv/shared/catalog'
import * as v from 'valibot'
import { computed, onScopeDispose, watch, type Ref } from 'vue'
import { catalogEpisodesResponseSchema } from '~/utils/catalog-response.ts'

type EpisodesOutcome =
  | { status: 'idle' }
  | { catalogItemId: string; items: CatalogEpisode[]; status: 'loaded' }
  | { catalogItemId: string; status: 'error' }

// Owns the public episode request independently from title metadata and private account state.
function useCatalogEpisodes(
  catalogItemId: Readonly<Ref<string | null>>,
  keyId: string
) {
  const requestFetch = useRequestFetch()
  const key = `catalog-episodes:${keyId}`

  const ready = useAsyncData(key, async (_app, { signal }): Promise<EpisodesOutcome> => {
    const requestedCatalogItemId = catalogItemId.value

    if (requestedCatalogItemId === null) {
      return { status: 'idle' }
    }

    const url = `/api/catalog/items/${encodeURIComponent(requestedCatalogItemId)}/episodes`

    try {
      const response = await requestFetch(url, {
        retry: 0,
        signal
      })

      signal.throwIfAborted()

      const parsed = v.safeParse(catalogEpisodesResponseSchema, response)

      if (!parsed.success) {
        globalThis.console.error('Catalog episodes response validation failed.', parsed.issues)

        return {
          catalogItemId: requestedCatalogItemId,
          status: 'error'
        }
      }

      return {
        catalogItemId: requestedCatalogItemId,
        items: parsed.output.items,
        status: 'loaded'
      }
    } catch (error) {
      if (signal.aborted) {
        throw error
      }

      globalThis.console.warn({
        error,
        message: 'Catalog episodes request failed.'
      })

      return {
        catalogItemId: requestedCatalogItemId,
        status: 'error'
      }
    }
  }, {
    dedupe: 'cancel',
    lazy: true
  })

  const currentOutcome = computed(() => {
    const outcome = ready.data.value

    if (
      outcome === undefined
      || outcome.status === 'idle'
      || outcome.catalogItemId !== catalogItemId.value
    ) {
      return
    }

    return outcome
  })

  const items = computed(() => currentOutcome.value?.status === 'loaded'
    ? currentOutcome.value.items
    : [])

  const isLoaded = computed(() => currentOutcome.value?.status === 'loaded')
  const isEmpty = computed(() => isLoaded.value && items.value.length === 0)
  const hasError = computed(() => currentOutcome.value?.status === 'error' || ready.status.value === 'error')

  const isLoading = computed(() => catalogItemId.value !== null && (
    ready.status.value === 'pending'
    || ready.status.value === 'idle'
    || currentOutcome.value === undefined
  ))

  async function reload(): Promise<void> {
    if (catalogItemId.value !== null) {
      await ready.execute({ dedupe: 'cancel' })
    }
  }

  watch(catalogItemId, (currentCatalogItemId, previousCatalogItemId) => {
    if (currentCatalogItemId === previousCatalogItemId) {
      return
    }

    ready.clear()

    if (currentCatalogItemId !== null) {
      void ready.execute({ dedupe: 'cancel' })
    }
  }, { flush: 'sync' })

  onScopeDispose(() => { ready.clear() })

  return {
    hasError,
    isEmpty,
    isLoading,
    items,
    ready,
    reload
  }
}

export { useCatalogEpisodes }
