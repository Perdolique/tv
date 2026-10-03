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

      return Object.assign(execute(), {
        clear,
        data,
        execute,
        status
      })
    }
  }
})

const { useCatalogRatingSummary } = await import('../use-catalog-rating-summary.ts')
const id = '01991a00-0000-7000-8000-000000000001'

const response = {
  averageScore: 8.75,
  ratingCount: 4
} as const

const scopes: ReturnType<typeof effectScope>[] = []

function setup() {
  const scope = effectScope()

  scopes.push(scope)

  const summary = scope.run(() => useCatalogRatingSummary(id))

  if (summary === undefined) {
    throw new Error('The summary scope did not start')
  }

  return {
    summary,
    scope
  }
}

describe('public rating summary lifecycle', () => {
  beforeEach(() => { harness.fetch.mockReset() })

  afterEach(() => {
    for (const scope of scopes.splice(0)) {
      scope.stop()
    }

    vi.restoreAllMocks()
  })

  it('loads public numeric averages with a stable initial loading state', async () => {
    harness.fetch.mockResolvedValue(response)

    const { summary } = setup()

    expect(summary.isLoading.value).toBe(true)
    expect(summary.summary.value).toBeUndefined()

    await summary.ready

    expect(summary.summary.value).toStrictEqual(response)
    expect(summary.hasError.value).toBe(false)

    const url = harness.fetch.mock.calls[0]?.[0]
    const options = harness.fetch.mock.calls[0]?.[1]

    expect(url).toBe(`/api/catalog/items/${id}/rating-summary`)
    expect(options).toMatchObject({ retry: 0 })
    expect(options?.signal).toBeInstanceOf(globalThis.AbortSignal)
  })

  it.each([
    {
      averageScore: null,
      ratingCount: 0
    },
    {
      averageScore: 1,
      ratingCount: 1
    },
    {
      averageScore: 10,
      ratingCount: 1234
    },
    {
      averageScore: 22 / 3,
      ratingCount: 3
    }
  ])('accepts valid summaries $averageScore / $ratingCount', async valid => {
    harness.fetch.mockResolvedValue(valid)

    const { summary } = setup()

    await summary.ready

    expect(summary.summary.value).toStrictEqual(valid)
    expect(summary.hasError.value).toBe(false)
  })

  it.each([
    {
      averageScore: 0,
      ratingCount: 0
    },
    {
      averageScore: null,
      ratingCount: 2
    },
    {
      averageScore: 8,
      ratingCount: 0
    },
    {
      averageScore: '8',
      ratingCount: 1
    },
    {
      averageScore: 8,
      ratingCount: '1'
    },
    {
      averageScore: 11,
      ratingCount: 1
    },
    {
      averageScore: 8,
      ratingCount: 1.5
    },
    {
      averageScore: 8,
      ratingCount: -1
    },
    {
      averageScore: Number.POSITIVE_INFINITY,
      ratingCount: 1
    },
    {
      averageScore: 8,
      ratingCount: Number.NaN
    },
    {
      averageScore: 8,
      ratingCount: 1,
      voters: []
    }
  ])('rejects malformed or inconsistent summary %#', async invalid => {
    const log = vi.spyOn(globalThis.console, 'error').mockReturnValue()

    harness.fetch.mockResolvedValue(invalid)

    const { summary } = setup()

    await summary.ready

    expect(summary.summary.value).toBeUndefined()
    expect(summary.hasError.value).toBe(true)
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('keeps the last confirmed data through refresh, failure and retry', async () => {
    const log = vi.spyOn(globalThis.console, 'warn').mockReturnValue()

    harness.fetch.mockResolvedValueOnce(response)

    const { summary } = setup()

    await summary.ready

    const pending = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(pending.promise)

    const refresh = summary.ready.execute()

    expect(summary.isLoading.value).toBe(true)
    expect(summary.summary.value).toStrictEqual(response)

    const failure = new Error('private database details')

    pending.reject(failure)

    await refresh

    expect(summary.hasError.value).toBe(true)
    expect(summary.summary.value).toStrictEqual(response)

    expect(log).toHaveBeenCalledWith({
      error: failure,
      message: 'Catalog rating summary request failed.'
    })

    harness.fetch.mockResolvedValueOnce({
      averageScore: null,
      ratingCount: 0
    })

    await summary.ready.execute()
    expect(summary.hasError.value).toBe(false)

    expect(summary.summary.value).toStrictEqual({
      averageScore: null,
      ratingCount: 0
    })
  })

  it('distinguishes initial failure from no votes and recovers on retry', async () => {
    vi.spyOn(globalThis.console, 'warn').mockReturnValue()
    harness.fetch.mockRejectedValueOnce(new Error('unavailable'))

    const { summary } = setup()

    await summary.ready

    expect(summary.hasError.value).toBe(true)
    expect(summary.summary.value).toBeUndefined()
    harness.fetch.mockResolvedValueOnce(response)
    await summary.ready.execute()
    expect(summary.summary.value).toStrictEqual(response)
    expect(summary.hasError.value).toBe(false)
  })

  it('aborts a superseded read and ignores its late malformed response', async () => {
    const log = vi.spyOn(globalThis.console, 'error').mockReturnValue()
    const pending = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response)

    const { summary } = setup()
    const signal = harness.fetch.mock.calls[0]?.[1].signal

    await summary.ready.execute()
    expect(signal?.aborted).toBe(true)
    pending.resolve({ averageScore: 'invalid' })

    await summary.ready

    expect(summary.summary.value).toStrictEqual(response)
    expect(summary.hasError.value).toBe(false)
    expect(log).not.toHaveBeenCalled()
  })

  it('aborts transport on disposal without allowing a late response to restore data', async () => {
    const pending = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(pending.promise)

    const { summary, scope } = setup()
    const signal = harness.fetch.mock.calls[0]?.[1].signal

    scope.stop()
    expect(signal?.aborted).toBe(true)
    pending.resolve(response)

    await summary.ready

    expect(summary.summary.value).toBeUndefined()
  })
})
