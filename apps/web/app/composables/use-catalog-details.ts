import { useAsyncData, useRequestFetch } from '#app'
import type { CatalogDetailsItem } from '@tv/shared/catalog'
import { isRecord } from '@tv/shared/type-guards'
import { computed, onScopeDispose } from 'vue'
import * as v from 'valibot'
import { catalogDetailsResponseSchema } from '~/utils/catalog-response.ts'

type DetailsOutcome =
  | { status: 'loaded'; item: CatalogDetailsItem }
  | { status: 'not-found' | 'error' }

const catalogItemIdSchema = v.pipe(v.string(), v.uuid())

// Owns one title request and its cancellation; account restoration never gates public data.
function useCatalogDetails(id: string, titleLocale: string) {
  const requestFetch = useRequestFetch()
  const key = `catalog-details:${id}:${titleLocale}`
  const url = `/api/catalog/items/${encodeURIComponent(id)}`

  const ready = useAsyncData(key, async (_app, { signal }): Promise<DetailsOutcome> => {
    if (!v.is(catalogItemIdSchema, id)) {
      return { status: 'not-found' }
    }

    try {
      const response = await requestFetch(url, {
        query: { titleLocale },
        retry: 0,
        signal
      })

      const parsed = v.safeParse(catalogDetailsResponseSchema, response)

      if (!parsed.success) {
        globalThis.console.error('Catalog details response validation failed.', parsed.issues)

        return { status: 'error' }
      }

      return {
        status: 'loaded',
        item: parsed.output.item
      }
    } catch (error) {
      if (signal.aborted) {
        throw error
      }

      const isNotFound = isRecord(error) && error.statusCode === 404
      const status = isNotFound ? 'not-found' : 'error'

      return { status }
    }
  }, {
    dedupe: 'cancel',
    lazy: true
  })

  const item = computed(() => ready.data.value?.status === 'loaded' ? ready.data.value.item : undefined)
  const isLoading = computed(() => ready.status.value === 'pending' || ready.status.value === 'idle')
  const isNotFound = computed(() => ready.data.value?.status === 'not-found')
  const hasError = computed(() => ready.data.value?.status === 'error' || ready.status.value === 'error')

  onScopeDispose(() => { ready.clear() })

  return {
    hasError,
    isLoading,
    isNotFound,
    item,
    ready
  }
}

export { useCatalogDetails }
