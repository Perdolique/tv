import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, shallowRef } from 'vue'
import type { CalendarReleaseRange } from '~/utils/calendar-date.ts'

interface RequestOptions {
  query: CalendarReleaseRange;
  retry: number;
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
    useAsyncData: (_key: string, handler: (app: unknown, options: Pick<RequestOptions, 'signal'>) => Promise<unknown>) => {
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

const { useCatalogReleases } = await import('../use-catalog-releases.ts')

const currentRange = {
  from: '2026-09-12',
  to: '2026-09-30'
} as const satisfies CalendarReleaseRange

const futureRange = {
  from: '2026-10-01',
  to: '2026-10-31'
} as const satisfies CalendarReleaseRange

const item = {
  episodeNumber: null,
  id: '01991a00-0000-7000-8000-000000000001',
  originalTitle: 'Arrival',
  originalTitleLocale: 'en',
  posterUrl: '/posters/arrival-2016.webp',
  releaseDate: '2026-09-18',
  releaseId: '01991a00-0000-7000-8000-000000000002',
  releaseYear: 2016,
  seasonNumber: null,
  title: 'Arrival',
  titleLocale: 'en',
  type: 'movie'
} as const

const response = { items: [item] }
const scopes: ReturnType<typeof effectScope>[] = []

function setup(
  initialAccountId: string | null = 'user-one',
  initialRange: CalendarReleaseRange | null = currentRange
) {
  const scope = effectScope()
  const accountId = ref(initialAccountId)
  const range = ref(initialRange)

  scopes.push(scope)

  const releases = scope.run(() => useCatalogReleases(accountId, range))

  if (releases === undefined) {
    throw new Error('The releases scope did not start')
  }

  return {
    accountId,
    range,
    releases,
    scope
  }
}

describe('catalog releases request lifecycle', () => {
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

  it('requests the exact range with no retry and accepts empty results', async () => {
    harness.fetch
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce({ items: [] })

    const { releases } = setup()

    expect(releases.isLoading.value).toBe(true)

    await releases.ready

    expect(releases.items.value).toStrictEqual(response.items)

    const requestOptions = harness.fetch.mock.calls[0]?.[1]

    expect(harness.fetch).toHaveBeenCalledTimes(1)
    expect(requestOptions?.query).toStrictEqual(currentRange)
    expect(requestOptions?.retry).toBe(0)
    expect(requestOptions?.signal.aborted).toBe(false)
    await releases.reload()
    expect(releases.items.value).toStrictEqual([])
  })

  it('reuses loaded month data when only the selected day changes', async () => {
    harness.fetch.mockResolvedValue(response)

    const { range, releases } = setup()

    await releases.ready

    range.value = {
      from: currentRange.from,
      to: currentRange.to
    }

    expect(harness.fetch).toHaveBeenCalledTimes(1)
    expect(releases.items.value).toStrictEqual(response.items)
  })

  it.each([
    ['account', null, currentRange],
    ['range', 'user-one', null]
  ])('does not request without a confirmed %s', async (_missing, accountId, range) => {
    const { releases } = setup(accountId, range)

    await releases.ready

    expect(harness.fetch).not.toHaveBeenCalled()
    expect(releases.isLoading.value).toBe(false)
    expect(releases.items.value).toStrictEqual([])
  })

  it('distinguishes transport, malformed, and unauthorized failures before retrying', async () => {
    const contractLog = vi.spyOn(globalThis.console, 'error').mockImplementation(() => {
      // The validation failure is asserted below.
    })

    const requestLog = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {
      // The technical transport failure is asserted below.
    })

    const serviceError = {
      statusCode: 503,
      data: { error: 'database details' }
    }

    harness.fetch
      .mockRejectedValueOnce(serviceError)
      .mockResolvedValueOnce({ items: [{ id: item.id }] })
      .mockRejectedValueOnce({ statusCode: 401 })
      .mockResolvedValueOnce(response)

    const { releases } = setup()

    await releases.ready

    expect(releases.hasError.value).toBe(true)

    expect(requestLog).toHaveBeenCalledWith({
      error: serviceError,
      message: 'Catalog releases request failed.'
    })

    await releases.reload()
    expect(releases.hasError.value).toBe(true)

    expect(contractLog).toHaveBeenCalledWith(
      'Catalog releases response validation failed.',
      expect.any(Array)
    )

    expect(contractLog.mock.calls[0]?.[1]).toStrictEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'schema' })
    ]))

    await releases.reload()
    expect(releases.unauthorized.value).toBe(true)
    expect(releases.items.value).toStrictEqual([])
    await releases.reload()
    expect(releases.items.value).toStrictEqual(response.items)
  })

  it('cancels a stale range and rejects its late result', async () => {
    const contractLog = vi.spyOn(globalThis.console, 'error').mockImplementation(() => {
      // A canceled payload must not reach validation telemetry.
    })

    const stalePending = Promise.withResolvers<unknown>()
    const currentPending = Promise.withResolvers<unknown>()

    harness.applyAbortedResults = true

    harness.fetch
      .mockReturnValueOnce(stalePending.promise)
      .mockReturnValueOnce(currentPending.promise)

    const { range, releases } = setup()
    const staleSignal = harness.fetch.mock.calls[0]?.[1].signal

    range.value = futureRange

    expect(staleSignal?.aborted).toBe(true)
    stalePending.resolve({ items: [{ id: item.id }] })

    await releases.ready

    expect(releases.items.value).toStrictEqual([])
    expect(contractLog).not.toHaveBeenCalled()

    const futureItem = {
      ...item,
      releaseDate: '2026-10-10',
      releaseId: '01991a00-0000-7000-8000-000000000003'
    }

    currentPending.resolve({ items: [futureItem] })

    await vi.waitFor(() => {
      expect(releases.items.value).toStrictEqual([futureItem])
    })
  })

  it('keeps the current account after a stale unauthorized failure', async () => {
    const stalePending = Promise.withResolvers<unknown>()

    harness.applyAbortedResults = true

    harness.fetch
      .mockReturnValueOnce(stalePending.promise)
      .mockResolvedValueOnce(response)

    const { accountId, releases } = setup()

    accountId.value = 'user-two'

    await vi.waitFor(() => {
      expect(releases.items.value).toStrictEqual(response.items)
    })

    stalePending.reject({ statusCode: 401 })

    await releases.ready

    expect(releases.unauthorized.value).toBe(false)
  })

  it('aborts replaced and disposed requests', async () => {
    const firstPending = Promise.withResolvers<unknown>()
    const finalPending = Promise.withResolvers<unknown>()

    harness.fetch
      .mockReturnValueOnce(firstPending.promise)
      .mockResolvedValueOnce(response)
      .mockReturnValueOnce(finalPending.promise)

    const { releases, scope } = setup()
    const firstSignal = harness.fetch.mock.calls[0]?.[1].signal
    const replaced = releases.reload()

    expect(firstSignal?.aborted).toBe(true)

    await replaced

    const pendingReload = releases.reload()
    const finalSignal = harness.fetch.mock.calls[2]?.[1].signal

    scope.stop()
    expect(finalSignal?.aborted).toBe(true)
    firstPending.resolve(response)
    finalPending.resolve(response)

    await pendingReload

    expect(releases.items.value).toStrictEqual([])
  })
})
