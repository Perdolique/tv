import { useAsyncData, useRequestFetch } from '#app'
import type { CatalogWatchlistItem } from '@tv/shared/catalog'
import { isRecord } from '@tv/shared/type-guards'
import * as v from 'valibot'
import { computed, onScopeDispose, watch, type Ref } from 'vue'
import { catalogWatchlistResponseSchema } from '~/utils/catalog-response.ts'

type WatchlistOutcome =
  | { status: 'idle' }
  | { generation: number; items: CatalogWatchlistItem[]; status: 'loaded' }
  | { generation: number; status: 'error' | 'unauthorized' }

// Owns the private watchlist request, account changes, and stale response rejection.
function useCatalogWatchlist(accountId: Readonly<Ref<string | null>>) {
  const requestFetch = useRequestFetch()
  let generation = 0

  const ready = useAsyncData('catalog-watchlist', async (_app, { signal }): Promise<WatchlistOutcome> => {
    const requestedAccountId = accountId.value
    const requestGeneration = generation

    if (requestedAccountId === null) {
      return { status: 'idle' }
    }

    try {
      const response = await requestFetch('/api/catalog/watchlist', {
        retry: 0,
        signal
      })

      const parsed = v.safeParse(catalogWatchlistResponseSchema, response)

      if (!parsed.success) {
        globalThis.console.error('Catalog watchlist response validation failed.', parsed.issues)

        return {
          generation: requestGeneration,
          status: 'error'
        }
      }

      return {
        generation: requestGeneration,
        items: parsed.output.items,
        status: 'loaded'
      }
    } catch (error) {
      if (signal.aborted) {
        throw error
      }

      if (isRecord(error) && error.statusCode === 401) {
        return {
          generation: requestGeneration,
          status: 'unauthorized'
        }
      }

      globalThis.console.warn({
        error,
        message: 'Catalog watchlist request failed.'
      })

      return {
        generation: requestGeneration,
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
      || outcome.generation !== generation
    ) {
      return
    }

    return outcome
  })

  const items = computed(() => currentOutcome.value?.status === 'loaded'
    ? currentOutcome.value.items
    : [])

  const isLoading = computed(() => accountId.value !== null && (
    ready.status.value === 'idle'
    || ready.status.value === 'pending'
    || currentOutcome.value === undefined
  ))

  const hasError = computed(() => currentOutcome.value?.status === 'error')
  const unauthorized = computed(() => currentOutcome.value?.status === 'unauthorized')

  async function reload(): Promise<void> {
    generation += 1

    ready.clear()

    if (accountId.value !== null) {
      await ready.execute({ dedupe: 'cancel' })
    }
  }

  watch(accountId, (currentAccountId, previousAccountId) => {
    if (currentAccountId === previousAccountId) {
      return
    }

    generation += 1

    ready.clear()

    if (currentAccountId !== null) {
      void ready.execute({ dedupe: 'cancel' })
    }
  }, { flush: 'sync' })

  onScopeDispose(() => {
    generation += 1

    ready.clear()
  })

  return {
    hasError,
    isLoading,
    items,
    ready,
    reload,
    unauthorized
  }
}

export { useCatalogWatchlist }
