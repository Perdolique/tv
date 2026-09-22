import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, shallowRef } from 'vue'

interface RequestOptions {
  retry: number;
  signal: AbortSignal;
}

interface EpisodesOutcome {
  catalogItemId?: string;
  items?: unknown[];
  status: 'idle' | 'loaded' | 'error';
}

const harness = vi.hoisted(() => {
  return {
    cachedOutcome: undefined as EpisodesOutcome | undefined,
    fetch: vi.fn<(url: string, options: RequestOptions) => Promise<unknown>>()
  }
})

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Models Nuxt hydration and cancellable async data in Node.
vi.mock('#app', () => {
  return {
    useRequestFetch: () => harness.fetch,

    // oxlint-disable-next-line typescript/promise-function-async -- Nuxt's promise exposes refs synchronously.
    useAsyncData: (_key: string, handler: (app: unknown, options: RequestOptions) => Promise<EpisodesOutcome>) => {
      const data = shallowRef<EpisodesOutcome | undefined>(harness.cachedOutcome)
      const status = ref(harness.cachedOutcome === undefined ? 'idle' : 'success')
      let controller = new globalThis.AbortController()

      const execute = async () => {
        controller.abort()

        controller = new globalThis.AbortController()

        const active = controller

        status.value = 'pending'

        try {
          const response = await handler({}, {
            retry: 0,
            signal: active.signal
          })

          if (!active.signal.aborted) {
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

      const initial = harness.cachedOutcome === undefined
        ? execute()
        : Promise.resolve()

      return Object.assign(initial, {
        clear,
        data,
        execute,
        status
      })
    }
  }
})

const { useCatalogEpisodes } = await import('../use-catalog-episodes.ts')
const catalogItemId = '01991a00-0000-7000-8000-000000000001'

const firstEpisode = {
  airDate: '2019-05-06',
  episodeNumber: 1,
  id: '30000000-0000-7000-8000-000000000001',
  seasonNumber: 1,
  sourceTitle: '1:23:45'
}

const secondEpisode = {
  airDate: null,
  episodeNumber: 2,
  id: '30000000-0000-7000-8000-000000000002',
  seasonNumber: 1,
  sourceTitle: null
}

const scopes: ReturnType<typeof effectScope>[] = []

function setup(itemId: string | null = catalogItemId) {
  const scope = effectScope()
  const item = ref<string | null>(itemId)
  const episodes = scope.run(() => useCatalogEpisodes(item, catalogItemId))

  scopes.push(scope)

  if (episodes === undefined) {
    throw new Error('The catalog episodes scope did not start')
  }

  return {
    episodes,
    item,
    scope
  }
}

describe('public catalog episodes lifecycle', () => {
  beforeEach(() => {
    harness.cachedOutcome = undefined

    harness.fetch.mockReset()
  })

  afterEach(() => {
    for (const scope of scopes.splice(0)) {
      scope.stop()
    }

    vi.restoreAllMocks()
  })

  it('loads public episodes independently and exposes loaded and empty states', async () => {
    harness.fetch.mockResolvedValue({ items: [firstEpisode, secondEpisode] })

    const { episodes } = setup()

    expect(episodes.isLoading.value).toBe(true)

    await episodes.ready

    expect(episodes.items.value).toStrictEqual([firstEpisode, secondEpisode])
    expect(episodes.isEmpty.value).toBe(false)

    expect(harness.fetch).toHaveBeenCalledExactlyOnceWith(
      `/api/catalog/items/${catalogItemId}/episodes`,
      expect.objectContaining({ retry: 0 })
    )
  })

  it('hydrates the SSR result without making another client request', async () => {
    harness.cachedOutcome = {
      catalogItemId,
      items: [firstEpisode],
      status: 'loaded'
    }

    const { episodes } = setup()

    await episodes.ready

    expect(episodes.items.value).toStrictEqual([firstEpisode])
    expect(episodes.isLoading.value).toBe(false)
    expect(harness.fetch).not.toHaveBeenCalled()
  })

  it('does not call the public endpoint until the title is confirmed as a series', async () => {
    harness.fetch.mockResolvedValue({ items: [firstEpisode] })

    const { episodes, item } = setup(null)

    await episodes.ready

    expect(episodes.items.value).toStrictEqual([])
    expect(harness.fetch).not.toHaveBeenCalled()

    item.value = catalogItemId

    await vi.waitFor(() => {
      expect(episodes.items.value).toStrictEqual([firstEpisode])
    })

    expect(harness.fetch).toHaveBeenCalledTimes(1)
  })

  it('shows a recoverable error and retries without a title request', async () => {
    const failure = new Error('controlled episode failure')

    const telemetry = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {
      // The raw failure is asserted below.
    })

    harness.fetch
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ items: [firstEpisode] })

    const { episodes } = setup()

    await episodes.ready

    expect(episodes.hasError.value).toBe(true)
    await episodes.reload()
    expect(episodes.items.value).toStrictEqual([firstEpisode])
    expect(episodes.hasError.value).toBe(false)

    expect(telemetry).toHaveBeenCalledWith({
      error: failure,
      message: 'Catalog episodes request failed.'
    })
  })

  it('cancels the stale retry and ignores its late result', async () => {
    const initial = Promise.withResolvers<unknown>()
    const newest = Promise.withResolvers<unknown>()

    harness.fetch
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(newest.promise)

    const { episodes } = setup()
    const initialSignal = harness.fetch.mock.calls[0]?.[1].signal
    const retry = episodes.reload()

    expect(initialSignal?.aborted).toBe(true)
    newest.resolve({ items: [secondEpisode] })

    await retry

    initial.resolve({ items: [firstEpisode] })

    await episodes.ready

    expect(episodes.items.value).toStrictEqual([secondEpisode])
  })

  it('aborts transport when the owning scope is disposed', async () => {
    const pending = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValue(pending.promise)

    const { episodes, scope } = setup()
    const signal = harness.fetch.mock.calls[0]?.[1].signal

    scope.stop()
    expect(signal?.aborted).toBe(true)
    pending.resolve({ items: [firstEpisode] })

    await episodes.ready

    expect(episodes.items.value).toStrictEqual([])
  })
})
