import { clearNuxtData, useAsyncData, useRequestFetch } from '#app'
import type { CatalogViewingSummaryResponse } from '@tv/shared/catalog'
import { isRecord } from '@tv/shared/type-guards'
import * as v from 'valibot'
import { computed, onScopeDispose, shallowRef, watch, type Ref } from 'vue'
import { catalogViewingSummaryResponseSchema } from '~/utils/catalog-response.ts'

type SummaryOutcome =
  | { status: 'idle' }
  | { accountId: string; generation: number; status: 'loaded'; summary: CatalogViewingSummaryResponse }
  | { accountId: string; generation: number; status: 'error' | 'unauthorized' }

function summaryKey(accountId: string | null): string {
  return `catalog-viewing-summary:${accountId ?? 'anonymous'}`
}

// Owns the private SSR summary and rejects responses from an earlier account or request.
function useViewingSummary(accountId: Readonly<Ref<string | null>>) {
  const requestFetch = useRequestFetch()
  const key = computed(() => summaryKey(accountId.value))
  const generation = shallowRef(0)
  const failedRead = shallowRef(false)
  const confirmed = shallowRef<CatalogViewingSummaryResponse | null>(null)

  watch(accountId, (_accountId, previousAccountId) => {
    generation.value += 1
    confirmed.value = null
    failedRead.value = false

    const previousKey = summaryKey(previousAccountId)

    clearNuxtData(previousKey)
  }, { flush: 'sync' })

  const ready = useAsyncData(key, async (_app, { signal }): Promise<SummaryOutcome> => {
    const requestedAccountId = accountId.value
    const requestGeneration = generation.value

    if (requestedAccountId === null) {
      return { status: 'idle' }
    }

    try {
      const response = await requestFetch('/api/catalog/viewing-summary', {
        retry: 0,
        signal
      })

      signal.throwIfAborted()

      const parsed = v.safeParse(catalogViewingSummaryResponseSchema, response)

      if (!parsed.success) {
        globalThis.console.error('Catalog viewing summary response validation failed.', parsed.issues)

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
        summary: parsed.output
      }
    } catch (error) {
      if (signal.aborted) {
        throw error
      }

      const unauthorized = isRecord(error) && error.statusCode === 401

      if (!unauthorized) {
        globalThis.console.warn({
          error,
          message: 'Catalog viewing summary request failed.'
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

    if (current?.status === 'idle' || current?.generation !== generation.value || current.accountId !== accountId.value) {
      return
    }

    return current
  })

  watch(outcome, current => {
    if (current?.status === 'loaded') {
      confirmed.value = current.summary
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

  const summary = computed(() => confirmed.value)
  const hasError = computed(() => failedRead.value && summary.value === null)
  const hasRefreshError = computed(() => failedRead.value && summary.value !== null)
  const unauthorized = computed(() => outcome.value?.status === 'unauthorized')
  const isLoading = computed(() => accountId.value !== null && summary.value === null && !hasError.value && !unauthorized.value)
  const isRefreshing = computed(() => accountId.value !== null && ready.status.value === 'pending')

  function clear(): void {
    generation.value += 1
    confirmed.value = null
    failedRead.value = false

    ready.clear()
  }

  async function reload(): Promise<boolean> {
    generation.value += 1

    if (accountId.value === null) { return false }

    const requestedAccountId = accountId.value
    const requestGeneration = generation.value

    await ready.execute({ dedupe: 'cancel' })

    return requestedAccountId === accountId.value && requestGeneration === generation.value && outcome.value?.status === 'loaded'
  }

  onScopeDispose(clear)

  return {
    hasError,
    hasRefreshError,
    isRefreshing,
    isLoading,
    ready,
    reload,
    summary,
    unauthorized
  }
}

export { useViewingSummary }
