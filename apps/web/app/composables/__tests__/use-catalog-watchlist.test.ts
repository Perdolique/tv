import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, shallowRef } from 'vue'

interface RequestOptions {
  signal: AbortSignal;
}

const harness = vi.hoisted(() => {
  return {
    applyAbortedResults: false,
    fetch: vi.fn<(url: string, options: RequestOptions) => Promise<unknown>>()
  }
})

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Models Nuxt's cancellable async-data boundary in a Node unit test.
vi.mock('#app', () => {
  return {
    useRequestFetch: () => harness.fetch,

    // oxlint-disable-next-line typescript/promise-function-async -- Nuxt's promise exposes refs synchronously.
    useAsyncData: (_key: string, handler: (app: unknown, options: RequestOptions) => Promise<unknown>) => {
      const data = shallowRef<unknown>()
      const status = ref('idle')
      let controller = new globalThis.AbortController()

      const execute = async () => {
        controller.abort()

        controller = new globalThis.AbortController()

        const active = controller

        status.value = 'pending'

        try {
          const response = await handler({}, { signal: active.signal })

          if (!active.signal.aborted || harness.applyAbortedResults) {
            data.value = response
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

      const initialRequest = execute()

      return Object.assign(initialRequest, {
        clear,
        data,
        execute,
        status
      })
    }
  }
})

const { useCatalogWatchlist } = await import('../use-catalog-watchlist.ts')

const item = {
  id: '01991a00-0000-7000-8000-000000000001',
  originalTitle: 'A title',
  originalTitleLocale: 'en',
  posterUrl: '/posters/dune-2021.webp',
  releaseYear: 2021,
  title: 'A title',
  titleLocale: 'en',
  type: 'movie'
} as const

const response = { items: [item] }

const secondItem = {
  ...item,
  id: '01991a00-0000-7000-8000-000000000002',
  title: 'Another account title'
} as const

const secondResponse = { items: [secondItem] }
const scopes: ReturnType<typeof effectScope>[] = []

function setup(initialAccountId: string | null = 'user-one') {
  const scope = effectScope()
  const accountId = ref(initialAccountId)

  scopes.push(scope)

  const watchlist = scope.run(() => useCatalogWatchlist(accountId))

  if (watchlist === undefined) {
    throw new Error('The watchlist scope did not start')
  }

  return {
    accountId,
    scope,
    watchlist
  }
}

describe('catalog watchlist request lifecycle', () => {
  beforeEach(() => {
    harness.applyAbortedResults = false

    harness.fetch.mockReset()
  })

  afterEach(() => {
    for (const scope of scopes.splice(0)) {
      scope.stop()
    }

    vi.restoreAllMocks()
  })

  it('loads ordered private items and accepts an empty response', async () => {
    harness.fetch
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce({ items: [] })

    const { watchlist } = setup()

    expect(watchlist.isLoading.value).toBe(true)

    await watchlist.ready

    expect(watchlist.items.value).toStrictEqual(response.items)
    expect(watchlist.hasError.value).toBe(false)
    expect(harness.fetch).toHaveBeenCalledWith('/api/catalog/watchlist', expect.objectContaining({ retry: 0 }))
    await watchlist.reload()
    expect(watchlist.items.value).toStrictEqual([])
    expect(watchlist.isLoading.value).toBe(false)
  })

  it('does not request private items without a confirmed account', async () => {
    const { watchlist } = setup(null)

    await watchlist.ready

    expect(harness.fetch).not.toHaveBeenCalled()
    expect(watchlist.items.value).toStrictEqual([])
    expect(watchlist.isLoading.value).toBe(false)
    expect(watchlist.hasError.value).toBe(false)
    expect(watchlist.unauthorized.value).toBe(false)
  })

  it('distinguishes service, malformed, and unauthorized failures before retrying', async () => {
    const contractLog = vi.spyOn(globalThis.console, 'error').mockImplementation(() => {
      // Expected response validation failure is inspected below.
    })

    const requestLog = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {
      // Expected transport failure is inspected below.
    })

    harness.fetch
      .mockRejectedValueOnce({ statusCode: 503 })
      .mockResolvedValueOnce({ items: [{ id: item.id }] })
      .mockRejectedValueOnce({ statusCode: 401 })
      .mockResolvedValueOnce(response)

    const { watchlist } = setup()

    await watchlist.ready

    expect(watchlist.hasError.value).toBe(true)
    expect(requestLog).toHaveBeenCalledTimes(1)
    await watchlist.reload()
    expect(watchlist.hasError.value).toBe(true)
    expect(contractLog).toHaveBeenCalledTimes(1)
    await watchlist.reload()
    expect(watchlist.unauthorized.value).toBe(true)
    await watchlist.reload()
    expect(watchlist.items.value).toStrictEqual(response.items)
    expect(watchlist.unauthorized.value).toBe(false)
  })

  it('rejects a stale result while loading another account', async () => {
    const stalePending = Promise.withResolvers<unknown>()
    const currentPending = Promise.withResolvers<unknown>()

    harness.applyAbortedResults = true

    harness.fetch
      .mockReturnValueOnce(stalePending.promise)
      .mockReturnValueOnce(currentPending.promise)

    const { accountId, watchlist } = setup()
    const staleSignal = harness.fetch.mock.calls[0]?.[1].signal

    accountId.value = 'user-two'

    expect(staleSignal?.aborted).toBe(true)
    expect(harness.fetch).toHaveBeenCalledTimes(2)
    stalePending.resolve(response)

    await watchlist.ready

    expect(watchlist.items.value).toStrictEqual([])
    currentPending.resolve(secondResponse)

    await vi.waitFor(() => {
      expect(watchlist.items.value).toStrictEqual(secondResponse.items)
    })
  })

  it('keeps the current account after a late unauthorized failure', async () => {
    const stalePending = Promise.withResolvers<unknown>()

    harness.fetch
      .mockReturnValueOnce(stalePending.promise)
      .mockResolvedValueOnce(secondResponse)

    const { accountId, watchlist } = setup()
    const staleSignal = harness.fetch.mock.calls[0]?.[1].signal

    accountId.value = 'user-two'

    expect(staleSignal?.aborted).toBe(true)
    expect(harness.fetch).toHaveBeenCalledTimes(2)

    await vi.waitFor(() => {
      expect(watchlist.items.value).toStrictEqual(secondResponse.items)
    })

    stalePending.reject({ statusCode: 401 })

    await watchlist.ready

    expect(watchlist.items.value).toStrictEqual(secondResponse.items)
    expect(watchlist.unauthorized.value).toBe(false)
  })

  it('aborts replaced and disposed requests', async () => {
    const firstPending = Promise.withResolvers<unknown>()
    const finalPending = Promise.withResolvers<unknown>()

    harness.fetch
      .mockReturnValueOnce(firstPending.promise)
      .mockResolvedValueOnce(response)
      .mockReturnValueOnce(finalPending.promise)

    const { scope, watchlist } = setup()
    const firstSignal = harness.fetch.mock.calls[0]?.[1].signal
    const replaced = watchlist.reload()

    expect(firstSignal?.aborted).toBe(true)

    await replaced

    expect(watchlist.items.value).toStrictEqual(response.items)

    const pendingReload = watchlist.reload()
    const finalSignal = harness.fetch.mock.calls[2]?.[1].signal

    expect(finalSignal?.aborted).toBe(false)
    scope.stop()
    expect(finalSignal?.aborted).toBe(true)
    firstPending.resolve(response)
    finalPending.resolve(response)

    await pendingReload

    expect(watchlist.items.value).toStrictEqual([])
  })
})
