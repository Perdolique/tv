import { useAsyncData, useRequestFetch, useRoute, useRouter } from '#app'
import type { CatalogSearchItem } from '@tv/shared/catalog'
import { isRecord } from '@tv/shared/type-guards'
import * as v from 'valibot'
import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import { catalogSearchResponseSchema, normalizeSearchQuery } from '~/utils/catalog-response.ts'

interface SearchResult {
  items: CatalogSearchItem[];
  query: string;
}

type SearchOutcome =
  | { status: 'idle' }
  | { generation: number; status: 'success'; result: SearchResult }
  | { generation: number; status: 'error' | 'unauthorized'; query: string }

const LOADING_INDICATOR_DELAY_MS = 200
const LOADING_INDICATOR_MINIMUM_MS = 200
const SEARCH_DEBOUNCE_MS = 300

// Owns URL synchronization, request lifetime, and the last successful search, not the session.
function useCatalogSearch(isAuthenticated: Ref<boolean>) {
  const route = useRoute()
  const router = useRouter()
  const requestFetch = useRequestFetch()
  const initialQuery = normalizeSearchQuery(route.query.query)
  const input = ref(initialQuery)
  const query = ref(input.value)
  const lastResult = shallowRef<SearchResult>()
  const failure = ref('')
  const isLoading = ref(false)
  const unauthorized = ref(false)

  // oxlint-disable-next-line eslint/init-declarations -- No debounce timer exists until the user types.
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined

  // oxlint-disable-next-line eslint/init-declarations -- Fast requests never create a visible loading state.
  let loadingTimer: ReturnType<typeof globalThis.setTimeout> | undefined

  // oxlint-disable-next-line eslint/init-declarations -- Outcomes normally apply immediately unless loading is already visible.
  let outcomeTimer: ReturnType<typeof globalThis.setTimeout> | undefined
  let disposed = false
  let generation = 0
  let loadingStartedAt = 0

  const ready = useAsyncData('catalog-search', async (_app, { signal }): Promise<SearchOutcome> => {
    const requestedQuery = query.value
    const requestGeneration = generation

    if (!isAuthenticated.value || requestedQuery === '') {
      return { status: 'idle' }
    }

    try {
      const response = await requestFetch('/api/catalog/search', {
        query: { query: requestedQuery },
        retry: 0,
        signal
      })

      const { items } = v.parse(catalogSearchResponseSchema, response)

      return {
        generation: requestGeneration,
        status: 'success',

        result: {
          items,
          query: requestedQuery
        }
      }
    } catch (error) {
      if (signal.aborted) {
        throw error
      }

      const isUnauthorized = isRecord(error) && error.statusCode === 401
      const status = isUnauthorized ? 'unauthorized' : 'error'

      return {
        generation: requestGeneration,
        status,
        query: requestedQuery
      }
    }
  }, { dedupe: 'cancel' })

  function cancelTimer(): void {
    globalThis.clearTimeout(timer)

    timer = undefined
  }

  function cancelLoadingTimer(): void {
    globalThis.clearTimeout(loadingTimer)

    loadingTimer = undefined
  }

  function cancelOutcomeTimer(): void {
    globalThis.clearTimeout(outcomeTimer)

    outcomeTimer = undefined
  }

  function reset(): void {
    generation += 1

    cancelTimer()
    cancelLoadingTimer()
    cancelOutcomeTimer()
    ready.clear()

    query.value = ''
    lastResult.value = undefined
    failure.value = ''
    isLoading.value = false
    loadingStartedAt = 0
    unauthorized.value = false
  }

  function applyOutcome(outcome: Exclude<SearchOutcome, { status: 'idle' }>): void {
    if (outcome.generation !== generation || !isAuthenticated.value || disposed) {
      return
    }

    isLoading.value = false
    loadingStartedAt = 0

    if (outcome.status === 'success') {
      lastResult.value = outcome.result
      failure.value = ''
    } else if (outcome.status === 'error') {
      failure.value = outcome.query
    } else {
      reset()

      unauthorized.value = true
    }
  }

  function settleOutcome(outcome: Exclude<SearchOutcome, { status: 'idle' }>): void {
    cancelLoadingTimer()

    if (!isLoading.value) {
      applyOutcome(outcome)

      return
    }

    const visibleDuration = Date.now() - loadingStartedAt
    const remainingDuration = LOADING_INDICATOR_MINIMUM_MS - visibleDuration

    if (remainingDuration <= 0) {
      applyOutcome(outcome)

      return
    }

    outcomeTimer = globalThis.setTimeout(() => {
      applyOutcome(outcome)
    }, remainingDuration)
  }

  function startLoadingTimer(): void {
    cancelLoadingTimer()

    loadingTimer = globalThis.setTimeout(() => {
      if (ready.status.value === 'pending') {
        loadingStartedAt = Date.now()
        isLoading.value = true
      }
    }, LOADING_INDICATOR_DELAY_MS)
  }

  watch(ready.data, (outcome) => {
    if (outcome === undefined || outcome.status === 'idle') {
      return
    }

    settleOutcome(outcome)
  }, {
    immediate: true,
    flush: 'sync'
  })

  async function updateUrl(value: string): Promise<void> {
    const nextQuery = { ...route.query }

    if (value === '') {
      delete nextQuery.query
    } else {
      nextQuery.query = value
    }

    await router.replace({
      path: route.path,
      query: nextQuery,
      hash: route.hash
    })
  }

  async function search(force = false): Promise<void> {
    cancelTimer()

    const nextQuery = normalizeSearchQuery(input.value)

    if (nextQuery === '') {
      reset()
      await updateUrl('')

      return
    }

    if (!isAuthenticated.value || disposed || (!force && nextQuery === query.value)) {
      return
    }

    generation += 1

    const searchGeneration = generation

    cancelOutcomeTimer()
    ready.clear()

    query.value = nextQuery
    failure.value = ''

    // Settle the URL before a fast 401 can trigger competing navigation to sign-in.
    await updateUrl(nextQuery)

    if (generation !== searchGeneration) {
      return
    }

    startLoadingTimer()
    await ready.execute({ dedupe: 'cancel' })
  }

  function changeInput(value: string): void {
    input.value = value

    cancelTimer()

    if (normalizeSearchQuery(value) === '') {
      void search()

      return
    }

    timer = globalThis.setTimeout(() => { void search() }, SEARCH_DEBOUNCE_MS)
  }

  function clear(): void {
    input.value = ''
    void search()
  }

  watch(() => route.query.query, (value) => {
    const normalized = normalizeSearchQuery(value)

    if (normalized === query.value) {
      return
    }

    input.value = normalized
    void search()
  })

  watch(isAuthenticated, (authenticated) => {
    if (authenticated) {
      input.value = normalizeSearchQuery(route.query.query)
      void search()
    } else {
      reset()
    }
  }, { flush: 'sync' })

  onScopeDispose(() => {
    disposed = true

    reset()
  })

  return {
    changeInput,
    clear,
    failure,
    input,
    isLoading,
    lastResult,
    ready,
    search,
    unauthorized
  }
}

export { useCatalogSearch }
