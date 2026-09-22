import { clearNuxtData, useAsyncData, useRequestFetch } from '#app'
import type { CatalogViewingHistoryItem, CatalogViewingHistoryResponse } from '@tv/shared/catalog'
import { isRecord } from '@tv/shared/type-guards'
import * as v from 'valibot'
import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import { catalogViewingHistoryResponseSchema } from '~/utils/catalog-response.ts'

type HistoryOutcome =
  | { status: 'idle' }
  | { accountId: string; generation: number; status: 'loaded'; page: CatalogViewingHistoryResponse }
  | { accountId: string; generation: number; status: 'error' | 'unauthorized' }

function historyKey(accountId: string | null): string {
  return `catalog-viewing-history:${accountId ?? 'anonymous'}`
}

// Owns SSR history, its cursor continuation, and account-scoped cancellation.
function useViewingHistory(accountId: Readonly<Ref<string | null>>) {
  const requestFetch = useRequestFetch()
  const key = computed(() => historyKey(accountId.value))
  const continuation = ref<CatalogViewingHistoryResponse | null>(null)
  const isLoadingMore = ref(false)
  const hasLoadMoreError = ref(false)
  const loadMoreUnauthorized = ref(false)
  let generation = 0
  let controller: AbortController | null = null
  let activeRequest: Promise<CatalogViewingHistoryItem[]> | null = null

  function clearContinuation(): void {
    generation += 1

    controller?.abort()

    controller = null
    activeRequest = null
    continuation.value = null
    isLoadingMore.value = false
    hasLoadMoreError.value = false
    loadMoreUnauthorized.value = false
  }

  watch(accountId, (_accountId, previousAccountId) => {
    clearContinuation()

    const previousKey = historyKey(previousAccountId)

    clearNuxtData(previousKey)
  }, { flush: 'sync' })

  const ready = useAsyncData(key, async (_app, { signal }): Promise<HistoryOutcome> => {
    const requestedAccountId = accountId.value
    const requestGeneration = generation

    if (requestedAccountId === null) {
      return { status: 'idle' }
    }

    try {
      const response = await requestFetch('/api/catalog/viewing-history', {
        retry: 0,
        signal
      })

      signal.throwIfAborted()

      const parsed = v.safeParse(catalogViewingHistoryResponseSchema, response)

      if (!parsed.success) {
        globalThis.console.error('Catalog viewing history response validation failed.', parsed.issues)

        return {
          accountId: requestedAccountId,
          generation: requestGeneration,
          status: 'error'
        }
      }

      return {
        accountId: requestedAccountId,
        generation: requestGeneration,
        status: 'loaded',
        page: parsed.output
      }
    } catch (error) {
      if (signal.aborted) {
        throw error
      }

      const unauthorized = isRecord(error) && error.statusCode === 401

      if (!unauthorized) {
        globalThis.console.warn({
          error,
          message: 'Catalog viewing history request failed.'
        })
      }

      return {
        accountId: requestedAccountId,
        generation: requestGeneration,
        status: unauthorized ? 'unauthorized' : 'error'
      }
    }
  }, {
    dedupe: 'cancel',
    lazy: true
  })

  const outcome = computed(() => {
    const current = ready.data.value

    if (current?.status === 'idle' || current?.generation !== generation || current.accountId !== accountId.value) {
      return
    }

    return current
  })

  const items = computed(() => {
    if (outcome.value?.status !== 'loaded' || loadMoreUnauthorized.value) {
      return []
    }

    return continuation.value === null
      ? outcome.value.page.items
      : [...outcome.value.page.items, ...continuation.value.items]
  })

  const nextCursor = computed(() => {
    if (outcome.value?.status !== 'loaded') {
      return null
    }

    return continuation.value === null ? outcome.value.page.nextCursor : continuation.value.nextCursor
  })

  const hasMore = computed(() => nextCursor.value !== null && !loadMoreUnauthorized.value)
  const hasError = computed(() => outcome.value?.status === 'error')
  const unauthorized = computed(() => outcome.value?.status === 'unauthorized' || loadMoreUnauthorized.value)
  const isLoading = computed(() => accountId.value !== null && (ready.status.value === 'pending' || outcome.value === undefined))

  async function loadMore(): Promise<CatalogViewingHistoryItem[]> {
    if (activeRequest !== null) {
      return activeRequest
    }

    const requestedCursor = nextCursor.value
    const requestedAccountId = accountId.value

    if (requestedAccountId === null || requestedCursor === null || unauthorized.value) {
      return []
    }

    const requestGeneration = generation
    const requestController = new globalThis.AbortController()

    controller = requestController
    isLoadingMore.value = true
    hasLoadMoreError.value = false

    const request = (async (): Promise<CatalogViewingHistoryItem[]> => {
      try {
        const response = await requestFetch('/api/catalog/viewing-history', {
          query: { cursor: requestedCursor },
          retry: 0,
          signal: requestController.signal
        })

        requestController.signal.throwIfAborted()

        if (generation !== requestGeneration || accountId.value !== requestedAccountId) {
          return []
        }

        const parsed = v.safeParse(catalogViewingHistoryResponseSchema, response)

        if (!parsed.success || parsed.output.nextCursor === requestedCursor) {
          globalThis.console.error('Catalog viewing history continuation validation failed.', parsed)

          hasLoadMoreError.value = true

          return []
        }

        const existingKeys = items.value.map(item => `${item.kind}:${item.entryId}`)
        const known = new Set(existingKeys)
        const added = parsed.output.items.filter(item => !known.has(`${item.kind}:${item.entryId}`))
        const previous = continuation.value?.items ?? []

        continuation.value = {
          items: [...previous, ...added],
          nextCursor: parsed.output.nextCursor
        }

        return added
      } catch (error) {
        if (requestController.signal.aborted || generation !== requestGeneration || accountId.value !== requestedAccountId) {
          return []
        }

        if (isRecord(error) && error.statusCode === 401) {
          continuation.value = null
          loadMoreUnauthorized.value = true
        } else {
          globalThis.console.warn({
            error,
            message: 'Catalog viewing history continuation failed.'
          })

          hasLoadMoreError.value = true
        }

        return []
      } finally {
        if (generation === requestGeneration) {
          isLoadingMore.value = false
        }
      }
    })()

    activeRequest = request

    try {
      return await request
    } finally {
      if (activeRequest === request) {
        activeRequest = null
        controller = null
      }
    }
  }

  function clear(): void {
    clearContinuation()
    ready.clear()
  }

  async function reload(): Promise<void> {
    clear()

    if (accountId.value !== null) {
      await ready.execute({ dedupe: 'cancel' })
    }
  }

  onScopeDispose(clear)

  return {
    hasError,
    hasLoadMoreError,
    hasMore,
    isLoading,
    isLoadingMore,
    items,
    loadMore,
    ready,
    reload,
    unauthorized
  }
}

export { useViewingHistory }
