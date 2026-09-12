import { useAsyncData, useRequestFetch } from '#app'
import type { CatalogReleaseItem } from '@tv/shared/catalog'
import { isRecord } from '@tv/shared/type-guards'
import * as v from 'valibot'
import { computed, onScopeDispose, watch, type Ref } from 'vue'
import type { CalendarReleaseRange } from '~/utils/calendar-date.ts'
import { catalogReleasesResponseSchema } from '~/utils/catalog-response.ts'

type ReleasesOutcome =
  | { status: 'idle' }
  | { generation: number; items: CatalogReleaseItem[]; status: 'loaded' }
  | { generation: number; status: 'error' | 'unauthorized' }

// Owns private release requests across account and calendar-range changes.
function useCatalogReleases(
  accountId: Readonly<Ref<string | null>>,
  range: Readonly<Ref<CalendarReleaseRange | null>>
) {
  const requestFetch = useRequestFetch()
  let generation = 0
  const rangeFrom = computed(() => range.value?.from ?? null)
  const rangeTo = computed(() => range.value?.to ?? null)

  const ready = useAsyncData('catalog-releases', async (_app, { signal }): Promise<ReleasesOutcome> => {
    const requestedAccountId = accountId.value
    const requestedRange = range.value
    const requestGeneration = generation

    if (requestedAccountId === null || requestedRange === null) {
      return { status: 'idle' }
    }

    try {
      const response = await requestFetch('/api/catalog/releases', {
        query: requestedRange,
        retry: 0,
        signal
      })

      signal.throwIfAborted()

      const parsed = v.safeParse(catalogReleasesResponseSchema, response)

      if (!parsed.success) {
        globalThis.console.error('Catalog releases response validation failed.', parsed.issues)

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
        message: 'Catalog releases request failed.'
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

  const isLoading = computed(() => accountId.value !== null && range.value !== null && (
    ready.status.value === 'idle'
    || ready.status.value === 'pending'
    || currentOutcome.value === undefined
  ))

  const hasError = computed(() => currentOutcome.value?.status === 'error')
  const unauthorized = computed(() => currentOutcome.value?.status === 'unauthorized')

  async function reload(): Promise<void> {
    generation += 1

    ready.clear()

    if (accountId.value !== null && range.value !== null) {
      await ready.execute({ dedupe: 'cancel' })
    }
  }

  watch([accountId, rangeFrom, rangeTo], (
    [currentAccountId, currentFrom, currentTo],
    [previousAccountId, previousFrom, previousTo]
  ) => {
    if (
      currentAccountId === previousAccountId
      && currentFrom === previousFrom
      && currentTo === previousTo
    ) {
      return
    }

    generation += 1

    ready.clear()

    if (currentAccountId !== null && currentFrom !== null && currentTo !== null) {
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

export { useCatalogReleases }
