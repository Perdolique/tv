import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, shallowRef } from 'vue'

interface RequestOptions {
  signal: AbortSignal;
}

const harness = vi.hoisted(() => {
  return { fetch: vi.fn<(url: string, options: RequestOptions) => Promise<unknown>>() }
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

      const request = execute()

      const ready = Object.assign(request, {
        clear,
        data,
        execute,
        status
      })

      return ready
    }
  }
})

const { useCatalogEpisodeRatingSummaries } = await import('../use-catalog-episode-rating-summaries.ts')
const firstId = '30000000-0000-7000-8000-000000000001'
const secondId = '30000000-0000-7000-8000-000000000002'

const season = {
  catalogItemId: '01991a00-0000-7000-8000-000000000006',
  seasonNumber: 1
} as const

const initial = { items: [
  {
    episodeId: firstId,
    averageScore: 6,
    ratingCount: 2
  },
  {
    episodeId: secondId,
    averageScore: null,
    ratingCount: 0
  }
] } as const

const scopes: ReturnType<typeof effectScope>[] = []

function setup() {
  const scope = effectScope()
  const summaries = scope.run(() => useCatalogEpisodeRatingSummaries(season, [firstId, secondId]))

  scopes.push(scope)

  if (summaries === undefined) {
    throw new Error('The episode summaries scope did not start')
  }

  return {
    scope,
    summaries
  }
}

describe('public episode rating summaries', () => {
  beforeEach(() => { harness.fetch.mockReset() })

  afterEach(() => {
    for (const scope of scopes.splice(0)) {
      scope.stop()
    }

    vi.restoreAllMocks()
  })

  it('loads one public batch and refreshes only the changed episode', async () => {
    harness.fetch.mockResolvedValueOnce(initial).mockResolvedValueOnce({
      averageScore: 8,
      ratingCount: 3
    })

    const { summaries } = setup()

    await summaries.ready

    expect(summaries.summaryFor(firstId).summary).toStrictEqual({
      averageScore: 6,
      ratingCount: 2
    })

    expect(summaries.summaryFor(secondId).summary).toStrictEqual({
      averageScore: null,
      ratingCount: 0
    })

    await summaries.reload(firstId)

    expect(summaries.summaryFor(firstId).summary).toStrictEqual({
      averageScore: 8,
      ratingCount: 3
    })

    expect(summaries.summaryFor(secondId).summary).toStrictEqual({
      averageScore: null,
      ratingCount: 0
    })

    expect(harness.fetch).toHaveBeenCalledTimes(2)
    expect(harness.fetch).toHaveBeenLastCalledWith(`/api/catalog/episodes/${firstId}/rating-summary`, expect.objectContaining({ retry: 0 }))
  })

  it('keeps a fresh point summary when an older batch arrives later', async () => {
    const pending = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({
      averageScore: 9,
      ratingCount: 1
    })

    const { summaries } = setup()

    await summaries.reload(firstId)
    pending.resolve(initial)

    await summaries.ready

    expect(summaries.summaryFor(firstId).summary).toStrictEqual({
      averageScore: 9,
      ratingCount: 1
    })

    expect(summaries.summaryFor(secondId).summary).toStrictEqual({
      averageScore: null,
      ratingCount: 0
    })
  })

  it('retains the last summary on local failure without failing other episodes', async () => {
    const error = new Error('private summary failure')
    const log = vi.spyOn(globalThis.console, 'warn').mockReturnValue()

    harness.fetch.mockResolvedValueOnce(initial).mockRejectedValueOnce(error).mockResolvedValueOnce({
      averageScore: null,
      ratingCount: 0
    })

    const { summaries } = setup()

    await summaries.ready

    await summaries.reload(firstId)

    expect(summaries.summaryFor(firstId)).toMatchObject({
      hasError: true,
      isLoading: false,

      summary: {
        averageScore: 6,
        ratingCount: 2
      }
    })

    expect(summaries.summaryFor(secondId).hasError).toBe(false)
    expect(summaries.batchError.value).toBe(false)

    expect(log).toHaveBeenCalledWith({
      error,
      message: 'Catalog episode rating summary request failed.'
    })

    await summaries.reload(firstId)

    expect(summaries.summaryFor(firstId)).toMatchObject({
      hasError: false,

      summary: {
        averageScore: null,
        ratingCount: 0
      }
    })
  })

  it('does not invent zero votes when a batch is incomplete', async () => {
    vi.spyOn(globalThis.console, 'warn').mockReturnValue()
    harness.fetch.mockResolvedValueOnce({ items: [initial.items[0]] }).mockResolvedValueOnce(initial)

    const { summaries } = setup()

    await summaries.ready

    expect(summaries.batchError.value).toBe(true)

    expect(summaries.summaryFor(secondId)).toMatchObject({
      summary: undefined,
      isLoading: false
    })

    await summaries.ready.execute()
    expect(summaries.batchError.value).toBe(false)

    expect(summaries.summaryFor(secondId).summary).toStrictEqual({
      averageScore: null,
      ratingCount: 0
    })
  })

  it('aborts batch and point requests when their season is unmounted', async () => {
    const pending = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValue(pending.promise)

    const { summaries, scope } = setup()
    const point = summaries.reload(firstId)

    scope.stop()
    expect(harness.fetch.mock.calls[0]?.[1].signal.aborted).toBe(true)
    expect(harness.fetch.mock.calls[1]?.[1].signal.aborted).toBe(true)
    pending.resolve(initial)

    await summaries.ready
    await point

    expect(summaries.summaryFor(firstId).summary).toBeUndefined()
  })
})
