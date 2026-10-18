import { clearNuxtData, useAsyncData, useRequestFetch } from '#app'
import type { CatalogViewingHistoryItem, CatalogViewingHistoryResponse, CatalogViewingStatus } from '@tv/shared/catalog'
import { isRecord } from '@tv/shared/type-guards'
import * as v from 'valibot'
import { computed, onScopeDispose, shallowRef, watch, type Ref } from 'vue'
import { catalogViewingHistoryResponseSchema } from '~/utils/catalog-response.ts'

type HistoryOutcome =
  | { status: 'idle' }
  | { key: string; generation: number; status: 'loaded'; page: CatalogViewingHistoryResponse }
  | { key: string; generation: number; status: 'error' | 'unauthorized' }

function historyKey(accountId: string | null, status: CatalogViewingStatus | null): string {
  return `catalog-viewing-history:${accountId ?? 'anonymous'}:${status ?? 'all'}`
}

function isInvalidCursor(error: unknown): boolean {
  if (!isRecord(error) || error.statusCode !== 400 || !isRecord(error.data)) { return false }

  const body = error.data.error

  return isRecord(body) && body.code === 'INVALID_REQUEST' && isRecord(body.fields) && typeof body.fields.cursor === 'string'
}

// Owns SSR history, explicit refresh, and cancellation within an account and status filter.
function useViewingHistory(accountId: Readonly<Ref<string | null>>, status: Readonly<Ref<CatalogViewingStatus | null>>) {
  const requestFetch = useRequestFetch()
  const key = computed(() => historyKey(accountId.value, status.value))
  const confirmed = shallowRef<CatalogViewingHistoryResponse | null>(null)
  const generation = shallowRef(0)
  const isLoadingMore = shallowRef(false)
  const hasLoadMoreError = shallowRef(false)
  const needsRefresh = shallowRef(false)
  const failedRead = shallowRef(false)
  const loadMoreUnauthorized = shallowRef(false)
  let controller: AbortController | null = null
  let activeRequest: Promise<CatalogViewingHistoryItem[]> | null = null

  function cancelContinuation(): void {
    generation.value += 1

    controller?.abort()

    controller = null
    activeRequest = null
    isLoadingMore.value = false
    hasLoadMoreError.value = false
  }

  function reset(): void {
    cancelContinuation()

    confirmed.value = null
    needsRefresh.value = false
    failedRead.value = false
    loadMoreUnauthorized.value = false
  }

  watch([accountId, status], (_scope, [previousAccount, previousStatus]) => {
    reset()

    const previousKey = historyKey(previousAccount, previousStatus)

    clearNuxtData(previousKey)
  }, { flush: 'sync' })

  const ready = useAsyncData(key, async (_app, { signal }): Promise<HistoryOutcome> => {
    const requestedKey = key.value
    const requestGeneration = generation.value

    if (accountId.value === null) { return { status: 'idle' } }

    try {
      const query = status.value === null ? undefined : { status: status.value }

      const response = await requestFetch('/api/catalog/viewing-history', {
        query,
        retry: 0,
        signal
      })

      signal.throwIfAborted()

      const parsed = v.safeParse(catalogViewingHistoryResponseSchema, response)

      if (!parsed.success) {
        globalThis.console.error('Catalog viewing history response validation failed.', parsed.issues)

        return {
          key: requestedKey,
          generation: requestGeneration,
          status: 'error'
        }
      }

      return {
        key: requestedKey,
        generation: requestGeneration,
        status: 'loaded',
        page: parsed.output
      }
    } catch (error) {
      if (signal.aborted) { throw error }

      const unauthorized = isRecord(error) && error.statusCode === 401

      if (!unauthorized) {
        globalThis.console.warn({
          error,
          message: 'Catalog viewing history request failed.'
        })
      }

      return {
        key: requestedKey,
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

    if (current?.status === 'idle' || current?.generation !== generation.value || current.key !== key.value) { return }

    return current
  })

  watch(outcome, current => {
    if (current?.status === 'loaded') {
      confirmed.value = current.page
      needsRefresh.value = false
      failedRead.value = false
    } else if (current?.status === 'error') {
      failedRead.value = true
    } else if (current?.status === 'unauthorized') {
      confirmed.value = null
      failedRead.value = false
    }
  }, {
    flush: 'sync',
    immediate: true
  })

  const unauthorized = computed(() => outcome.value?.status === 'unauthorized' || loadMoreUnauthorized.value)
  const items = computed(() => unauthorized.value ? [] : confirmed.value?.items ?? [])
  const hasData = computed(() => confirmed.value !== null && !unauthorized.value)
  const hasMore = computed(() => hasData.value && confirmed.value?.nextCursor !== null && !needsRefresh.value)
  const hasError = computed(() => failedRead.value && !hasData.value)
  const hasRefreshError = computed(() => failedRead.value && hasData.value)
  const isLoading = computed(() => accountId.value !== null && !hasData.value && !hasError.value && !unauthorized.value)
  const isRefreshing = computed(() => accountId.value !== null && ready.status.value === 'pending')

  function clear(): void {
    reset()
    ready.clear()
  }

  async function reload(): Promise<boolean> {
    cancelContinuation()

    if (accountId.value === null) { return false }

    const requestedKey = key.value
    const requestGeneration = generation.value

    await ready.execute({ dedupe: 'cancel' })

    return requestedKey === key.value && requestGeneration === generation.value && outcome.value?.status === 'loaded'
  }

  async function loadMore(): Promise<CatalogViewingHistoryItem[]> {
    if (activeRequest !== null) { return activeRequest }

    const cursor = confirmed.value?.nextCursor

    if (!hasMore.value || cursor === null || cursor === undefined || isRefreshing.value) { return [] }

    const requestedKey = key.value
    const requestGeneration = generation.value
    const requestController = new globalThis.AbortController()

    const query = status.value === null ? { cursor } : {
      cursor,
      status: status.value
    }

    controller = requestController
    isLoadingMore.value = true
    hasLoadMoreError.value = false

    function isCurrent(): boolean {
      return !requestController.signal.aborted && generation.value === requestGeneration && key.value === requestedKey
    }

    const request = (async (): Promise<CatalogViewingHistoryItem[]> => {
      try {
        const response = await requestFetch('/api/catalog/viewing-history', {
          query,
          retry: 0,
          signal: requestController.signal
        })

        if (!isCurrent()) { return [] }

        const parsed = v.safeParse(catalogViewingHistoryResponseSchema, response)

        if (!parsed.success || parsed.output.nextCursor === cursor) {
          globalThis.console.error('Catalog viewing history continuation validation failed.', parsed)

          hasLoadMoreError.value = true

          return []
        }

        const existingKeys = items.value.map(item => item.viewingId)
        const known = new Set(existingKeys)
        const added = parsed.output.items.filter(item => !known.has(item.viewingId))

        confirmed.value = {
          items: [...items.value, ...added],
          nextCursor: parsed.output.nextCursor
        }

        return added
      } catch (error) {
        if (!isCurrent()) { return [] }

        if (isRecord(error) && error.statusCode === 401) {
          confirmed.value = null
          loadMoreUnauthorized.value = true
        } else if (isInvalidCursor(error)) {
          needsRefresh.value = true
        } else {
          globalThis.console.warn({
            error,
            message: 'Catalog viewing history continuation failed.'
          })

          hasLoadMoreError.value = true
        }

        return []
      } finally {
        if (isCurrent()) { isLoadingMore.value = false }
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

  onScopeDispose(clear)

  return {
    hasError,
    hasRefreshError,
    hasLoadMoreError,
    hasMore,
    isLoading,
    isLoadingMore,
    isRefreshing,
    items,
    loadMore,
    needsRefresh,
    ready,
    reload,
    unauthorized
  }
}

export { useViewingHistory }
