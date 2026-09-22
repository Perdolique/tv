import { clearNuxtData, useAsyncData, useRequestFetch } from '#app'
import type { CatalogViewingSummaryResponse } from '@tv/shared/catalog'
import { isRecord } from '@tv/shared/type-guards'
import * as v from 'valibot'
import { computed, onScopeDispose, watch, type Ref } from 'vue'
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
  let generation = 0

  watch(accountId, (_accountId, previousAccountId) => {
    generation += 1

    const previousKey = summaryKey(previousAccountId)

    clearNuxtData(previousKey)
  }, { flush: 'sync' })

  const ready = useAsyncData(key, async (_app, { signal }): Promise<SummaryOutcome> => {
    const requestedAccountId = accountId.value
    const requestGeneration = generation

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

    if (current?.status === 'idle' || current?.generation !== generation || current.accountId !== accountId.value) {
      return
    }

    return current
  })

  const summary = computed(() => outcome.value?.status === 'loaded' ? outcome.value.summary : null)
  const hasError = computed(() => outcome.value?.status === 'error')
  const unauthorized = computed(() => outcome.value?.status === 'unauthorized')
  const isLoading = computed(() => accountId.value !== null && (ready.status.value === 'pending' || outcome.value === undefined))

  function clear(): void {
    generation += 1

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
    isLoading,
    ready,
    reload,
    summary,
    unauthorized
  }
}

export { useViewingSummary }
