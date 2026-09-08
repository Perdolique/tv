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

const { useCatalogDetails } = await import('../use-catalog-details.ts')
const id = '01991a00-0000-7000-8000-000000000001'

const response = { item: {
  id,
  title: 'A title',
  titleLocale: 'en',
  originalTitle: 'A title',
  originalTitleLocale: 'en',
  type: 'movie',
  releaseYear: null,
  description: null,
  descriptionLocale: null,
  posterUrl: null
} }

const scopes: ReturnType<typeof effectScope>[] = []

function setup(itemId = id, locale = 'en') {
  const scope = effectScope()

  scopes.push(scope)

  const details = scope.run(() => useCatalogDetails(itemId, locale))

  if (details === undefined) {
    throw new Error('The details scope did not start')
  }

  return {
    details,
    scope
  }
}

describe('public title request lifecycle', () => {
  beforeEach(() => { harness.fetch.mockReset() })

  afterEach(() => {
    for (const scope of scopes.splice(0)) {
      scope.stop()
    }

    vi.restoreAllMocks()
  })

  it('loads public metadata with the requested locale and no session dependency', async () => {
    harness.fetch.mockResolvedValue(response)

    const { details } = setup(id, 'ru-RU')

    expect(details.isLoading.value).toBe(true)

    await details.ready

    expect(details.item.value).toStrictEqual(response.item)
    expect(details.hasError.value).toBe(false)

    const options = harness.fetch.mock.calls[0]?.[1]

    expect(options).toMatchObject({
      query: { titleLocale: 'ru-RU' },
      retry: 0
    })
  })

  it('distinguishes invalid and missing IDs from a recoverable service error', async () => {
    const invalid = setup('not-an-id')

    await invalid.details.ready

    expect(invalid.details.isNotFound.value).toBe(true)
    expect(harness.fetch).not.toHaveBeenCalled()
    harness.fetch.mockRejectedValue({ statusCode: 404 })

    const missing = setup()

    await missing.details.ready

    expect(missing.details.isNotFound.value).toBe(true)
    expect(missing.details.hasError.value).toBe(false)
    harness.fetch.mockRejectedValue({ statusCode: 503 })

    const unavailable = setup()

    await unavailable.details.ready

    expect(unavailable.details.hasError.value).toBe(true)
    expect(unavailable.details.isNotFound.value).toBe(false)
    harness.fetch.mockResolvedValue(response)
    await unavailable.details.ready.execute()
    expect(unavailable.details.item.value).toStrictEqual(response.item)
    expect(unavailable.details.hasError.value).toBe(false)
  })

  it('logs a malformed response and displays a safe failure state', async () => {
    const log = vi.spyOn(globalThis.console, 'error').mockImplementation(() => {
      // Inspect the expected contract error below.
    })

    harness.fetch.mockResolvedValue({ item: { title: 42 } })

    const { details } = setup()

    await details.ready

    expect(details.hasError.value).toBe(true)
    expect(details.item.value).toBeUndefined()
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('aborts transport on disposal and cannot apply the late response', async () => {
    const pending = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValue(pending.promise)

    const { details, scope } = setup()
    const signal = harness.fetch.mock.calls[0]?.[1].signal

    expect(signal?.aborted).toBe(false)
    scope.stop()
    expect(signal?.aborted).toBe(true)
    pending.resolve(response)

    await details.ready

    expect(details.item.value).toBeUndefined()
  })
})
