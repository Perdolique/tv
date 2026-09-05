/* oxlint-disable eslint/max-lines -- Search lifecycle scenarios share one focused composable harness. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, ref, shallowRef } from 'vue'

interface FetchOptions {
  signal: AbortSignal;
}
interface MockTarget {
  query: Record<string, string>;
}

interface HarnessRoute {
  path: string;
  hash: string;
  query: Record<string, string>;
}

const harness = vi.hoisted(() => {
  const route: HarnessRoute = {
    path: '/',
    hash: '',
    query: {}
  }

  return {
  fetch: vi.fn<(url: string, options: FetchOptions) => Promise<unknown>>(),
  replace: vi.fn(),
  route
  }
})

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Models the async-data boundary without loading the entire Nuxt application.
vi.mock('#app', () => { return {
  useRequestFetch: () => harness.fetch,
  useRoute: () => harness.route,
  useRouter: () => { return { replace: harness.replace } },

  // oxlint-disable-next-line typescript/promise-function-async -- Nuxt returns a promise with synchronous ref properties, not an async wrapper.
  useAsyncData: (_key: string, handler: (app: unknown, options: FetchOptions) => Promise<unknown>) => {
    const data = shallowRef<unknown>()
    const status = ref('idle')
    let controller = new globalThis.AbortController()

    const execute = async () => {
      controller.abort()

      controller = new globalThis.AbortController()

      const active = controller

      status.value = 'pending'

      try {
        const result = await handler({}, { signal: active.signal })

        if (!active.signal.aborted) {
          data.value = result
          status.value = 'success'
        }
      } catch {
        if (!active.signal.aborted) {
          status.value = 'error'
        }
      }
    }

    const clear = () => {
      controller.abort()

      data.value = undefined
      status.value = 'idle'
    }

    const initial = execute()

    return Object.assign(initial, {
      data,
      status,
      execute,
      clear
    })
  }
} })

const { useCatalogSearch } = await import('../use-catalog-search.ts')

const movie = {
  id: 'arrival',
  title: 'Arrival',
  titleLocale: 'en',
  originalTitle: 'Arrival',
  originalTitleLocale: 'en',
  releaseYear: 2016,
  type: 'movie'
}

const scopes: ReturnType<typeof effectScope>[] = []

async function setup(authenticated = true) {
  const scope = effectScope()

  scopes.push(scope)

  const enabled = ref(authenticated)
  const search = scope.run(() => useCatalogSearch(enabled))

  if (search === undefined) {
    throw new Error('Search scope did not start')
  }

  await search.ready

  return {
    search,
    enabled,
    scope
  }
}

function requestSignal(): AbortSignal {
  const options = harness.fetch.mock.calls[0]?.[1]

  if (options === undefined) { throw new Error('Expected a search request') }

  return options.signal
}

describe(useCatalogSearch, () => {
  beforeEach(() => {
    vi.useFakeTimers()
    harness.fetch.mockReset().mockResolvedValue({ items: [movie] })

    harness.route = reactive({
      path: '/',
      hash: '',
      query: {}
    })

    harness.replace.mockReset().mockImplementation((target: MockTarget) => { harness.route.query = target.query })
  })

  afterEach(() => {
    for (const scope of scopes) {
      scope.stop()
    }

    scopes.length = 0

    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not search for guests or empty input', async () => {
    const { search } = await setup(false)

    search.changeInput('Dark')
    await vi.advanceTimersByTimeAsync(250)
    search.changeInput('   ')
    await nextTick()
    expect(harness.fetch).not.toHaveBeenCalled()
    expect(search.lastResult.value).toBeUndefined()
  })

  it('normalizes NFC and whitespace, and does not duplicate Enter or equivalent input', async () => {
    const { search } = await setup()

    search.changeInput('Cafe')
    await vi.advanceTimersByTimeAsync(299)
    expect(harness.fetch).not.toHaveBeenCalled()
    search.changeInput('  Cafe\u0301  ')
    await search.search()
    await vi.advanceTimersByTimeAsync(500)
    expect(harness.fetch).toHaveBeenCalledTimes(1)

    expect(harness.fetch).toHaveBeenCalledWith('/api/catalog/search', expect.objectContaining({
      query: { query: 'Café' },
      retry: 0
    }))

    search.changeInput('Café')
    await vi.advanceTimersByTimeAsync(300)
    expect(harness.fetch).toHaveBeenCalledTimes(1)
  })

  it('searches after 300ms and synchronizes URL without dropping other parameters', async () => {
    harness.route.query = { source: 'home' }

    const { search } = await setup()

    search.changeInput('Arrival')
    await vi.advanceTimersByTimeAsync(300)
    expect(harness.fetch).toHaveBeenCalledTimes(1)

    expect(harness.route.query).toStrictEqual({
      source: 'home',
      query: 'Arrival'
    })

    harness.route.query = {
      source: 'home',
      query: 'Dark'
    }

    await nextTick()
    await vi.advanceTimersByTimeAsync(0)
    expect(search.input.value).toBe('Dark')
    expect(harness.fetch).toHaveBeenCalledTimes(2)
    search.clear()
    await nextTick()
    expect(harness.route.query).toStrictEqual({ source: 'home' })
    expect(search.lastResult.value).toBeUndefined()
  })

  it('retains the successful list on failure and retries the current query', async () => {
    const { search } = await setup()

    search.changeInput('Arrival')
    await search.search()
    harness.fetch.mockRejectedValueOnce(new Error('private database details'))
    search.changeInput('Dark')
    await search.search()
    expect(search.failure.value).toBe('Dark')

    expect(search.lastResult.value).toStrictEqual({
      query: 'Arrival',
      items: [movie]
    })

    harness.fetch.mockResolvedValueOnce({ items: [] })
    await search.search(true)
    expect(search.failure.value).toBe('')

    expect(search.lastResult.value).toStrictEqual({
      query: 'Dark',
      items: []
    })
  })

  it('does not expose loading feedback for a request completed in 162ms', async () => {
    const { search } = await setup()
    const deferred = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(deferred.promise)
    search.changeInput('Arrival')

    const pending = search.search()

    await vi.advanceTimersByTimeAsync(162)
    deferred.resolve({ items: [movie] })

    await pending

    expect(search.isLoading.value).toBe(false)
    expect(search.lastResult.value?.query).toBe('Arrival')
  })

  it('keeps visible loading feedback long enough to avoid a boundary flash', async () => {
    const { search } = await setup()
    const deferred = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(deferred.promise)
    search.changeInput('Arrival')

    const pending = search.search()

    await vi.advanceTimersByTimeAsync(0)
    expect(search.isLoading.value).toBe(false)
    await vi.advanceTimersByTimeAsync(199)
    expect(search.isLoading.value).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(search.isLoading.value).toBe(true)
    deferred.resolve({ items: [movie] })

    await pending

    expect(search.isLoading.value).toBe(true)
    expect(search.lastResult.value).toBeUndefined()
    await vi.advanceTimersByTimeAsync(199)
    expect(search.isLoading.value).toBe(true)
    expect(search.lastResult.value).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(search.isLoading.value).toBe(false)
    expect(search.lastResult.value?.query).toBe('Arrival')
  })

  it('rejects malformed responses instead of displaying unvalidated data', async () => {
    const { search } = await setup()

    harness.fetch.mockResolvedValueOnce({ items: [{ title: 'unsafe' }] })
    search.changeInput('Dark')
    await search.search()
    expect(search.failure.value).toBe('Dark')
    expect(search.lastResult.value).toBeUndefined()
  })

  it('aborts a previous request and ignores even its late 401', async () => {
    const { search } = await setup()
    const deferred = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(deferred.promise)
    search.changeInput('Arrival')

    const previous = search.search()

    await vi.advanceTimersByTimeAsync(0)

    const signal = requestSignal()

    search.changeInput('Dark')
    await search.search()
    expect(signal.aborted).toBe(true)
    deferred.reject({ statusCode: 401 })

    await previous

    expect(search.unauthorized.value).toBe(false)
    expect(search.lastResult.value?.query).toBe('Dark')
  })

  it.each(['clear', 'sign-out', 'unmount'] as const)('cancels pending requests and timers on %s', async (action) => {
    const { search, enabled, scope } = await setup()
    const deferred = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(deferred.promise)
    search.changeInput('Arrival')

    const pending = search.search()

    await vi.advanceTimersByTimeAsync(0)

    const signal = requestSignal()

    search.changeInput('Dark')

    const actions = {
      clear: search.clear,
      'sign-out': () => { enabled.value = false },
      unmount: () => { scope.stop() }
    }

    actions[action]()
    expect(signal.aborted).toBe(true)
    deferred.resolve({ items: [movie] })

    await pending

    await vi.advanceTimersByTimeAsync(500)
    expect(harness.fetch).toHaveBeenCalledTimes(1)
    expect(search.lastResult.value).toBeUndefined()
    expect(search.failure.value).toBe('')
  })

  it('clears successful data and reports a current 401 to the session owner', async () => {
    const { search } = await setup()

    search.changeInput('Arrival')
    await search.search()
    harness.fetch.mockRejectedValueOnce({ statusCode: 401 })
    search.changeInput('Dark')
    await search.search()
    expect(search.lastResult.value).toBeUndefined()
    expect(search.unauthorized.value).toBe(true)
    expect(search.failure.value).toBe('')
  })

  it('settles URL navigation before a fast unauthorized response can redirect', async () => {
    const { search } = await setup()
    const navigation = Promise.withResolvers<null>()

    harness.replace.mockImplementationOnce(async (target: MockTarget) => {
      await navigation.promise
      harness.route.query = target.query
    })

    harness.fetch.mockRejectedValueOnce({ statusCode: 401 })
    search.changeInput('Dark')

    const pending = search.search()

    await nextTick()
    expect(harness.fetch).not.toHaveBeenCalled()
    navigation.resolve(null)

    await pending

    expect(harness.route.query).toStrictEqual({ query: 'Dark' })
    expect(search.unauthorized.value).toBe(true)
  })

  it('does not start an obsolete request after URL navigation resolves late', async () => {
    const { search } = await setup()
    const navigation = Promise.withResolvers<null>()

    harness.replace.mockReturnValueOnce(navigation.promise)
    search.changeInput('Arrival')

    const pending = search.search()

    search.clear()
    navigation.resolve(null)

    await pending

    expect(harness.fetch).not.toHaveBeenCalled()
    expect(search.lastResult.value).toBeUndefined()
  })

})
