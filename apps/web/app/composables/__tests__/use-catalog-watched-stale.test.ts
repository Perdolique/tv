import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'

interface RequestOptions {
  method?: string;
  retry: number;
  signal: AbortSignal;
}

interface SetupOptions {
  automaticLoad?: boolean;
  initialAccountId?: string | null;
  initialItemId?: string | null;
}

const harness = vi.hoisted(() => {
  return { fetch: vi.fn<(url: string, options: RequestOptions) => Promise<unknown>>() }
})

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Nuxt's virtual alias has no runtime module in this Node unit test.
vi.mock('#app', () => {
  return { useRequestFetch: () => harness.fetch }
})

const { useCatalogWatched } = await import('../use-catalog-watched.ts')
const firstItemId = '01991a00-0000-7000-8000-000000000001'
const secondItemId = '01991a00-0000-7000-8000-000000000003'
const firstAccountId = '01991a00-0000-7000-8000-000000000002'
const secondAccountId = '01991a00-0000-7000-8000-000000000004'
const scopes: ReturnType<typeof effectScope>[] = []

function setup({
  automaticLoad = false,
  initialAccountId = firstAccountId,
  initialItemId = firstItemId
}: SetupOptions = {}) {
  const scope = effectScope()
  const item = ref<string | null>(initialItemId)
  const account = ref<string | null>(initialAccountId)

  const catalogWatched = scope.run(() => useCatalogWatched(item, account, {
    automaticLoad
  }))

  scopes.push(scope)

  if (catalogWatched === undefined) {
    throw new Error('The catalog watched scope did not start')
  }

  return {
    account,
    catalogWatched,
    item
  }
}

describe('catalog watched authorization and stale requests', () => {
  beforeEach(() => { harness.fetch.mockReset() })

  afterEach(() => {
    for (const scope of scopes.splice(0)) {
      scope.stop()
    }

    vi.restoreAllMocks()
  })

  it('keeps a raw load transport failure in client telemetry', async () => {
    const failure = new Error('controlled browser transport failure')

    const telemetry = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {
      // The raw transport failure is asserted below.
    })

    harness.fetch.mockRejectedValueOnce(failure)

    const { catalogWatched } = setup()

    await catalogWatched.load()
    expect(catalogWatched.status.value).toBe('error')

    expect(telemetry).toHaveBeenCalledWith({
      error: failure,
      message: 'Catalog watched status request failed.'
    })
  })

  it('clears a load 401 and can retry on the same instance', async () => {
    harness.fetch
      .mockRejectedValueOnce({ statusCode: 401 })
      .mockResolvedValueOnce({ watched: true })

    const { catalogWatched } = setup()

    await catalogWatched.load()
    expect(catalogWatched.status.value).toBe('idle')
    expect(catalogWatched.unauthorized.value).toBe('load')
    catalogWatched.clearUnauthorized()
    expect(catalogWatched.unauthorized.value).toBeNull()
    await catalogWatched.load()
    expect(catalogWatched.status.value).toBe('loaded')
    expect(catalogWatched.watched.value).toBe(true)
    expect(catalogWatched.unauthorized.value).toBeNull()
  })

  it('clears a mutation 401 and can retry on the same instance', async () => {
    harness.fetch
      .mockResolvedValueOnce({ watched: false })
      .mockRejectedValueOnce({ statusCode: 401 })
      .mockResolvedValueOnce({ watched: true })

    const { catalogWatched } = setup()

    await catalogWatched.load()
    await catalogWatched.toggle()
    expect(catalogWatched.watched.value).toBe(false)
    expect(catalogWatched.unauthorized.value).toBe('mutation')
    expect(catalogWatched.saveError.value).toBe('')
    catalogWatched.clearUnauthorized()
    expect(catalogWatched.unauthorized.value).toBeNull()
    await catalogWatched.toggle()
    expect(catalogWatched.watched.value).toBe(true)
    expect(catalogWatched.unauthorized.value).toBeNull()
  })

  it('ignores a rejected load after sign-out', async () => {
    const pending = Promise.withResolvers<unknown>()

    const telemetry = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {
      // A stale failure must not reach telemetry or state.
    })

    harness.fetch.mockReturnValueOnce(pending.promise)

    const signedOut = setup()
    const load = signedOut.catalogWatched.load()
    const signal = harness.fetch.mock.calls[0]?.[1].signal

    signedOut.account.value = null

    expect(signal?.aborted).toBe(true)
    expect(signedOut.catalogWatched.status.value).toBe('idle')
    pending.reject(new Error('late rejected load'))

    await load

    expect(signedOut.catalogWatched.watched.value).toBe(false)
    expect(signedOut.catalogWatched.unauthorized.value).toBeNull()
    expect(telemetry).not.toHaveBeenCalled()
  })

  it('cancels a movie response, loads the next movie and resets for a series or missing item', async () => {
    const firstResponse = Promise.withResolvers<unknown>()
    const secondResponse = Promise.withResolvers<unknown>()

    harness.fetch
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise)

    const switched = setup({ automaticLoad: true })
    const firstSignal = harness.fetch.mock.calls[0]?.[1].signal

    switched.item.value = secondItemId

    expect(firstSignal?.aborted).toBe(true)
    expect(harness.fetch).toHaveBeenCalledTimes(2)
    firstResponse.resolve({ watched: true })
    secondResponse.resolve({ watched: false })

    await vi.waitFor(() => {
      expect(switched.catalogWatched.status.value).toBe('loaded')
    })

    expect(switched.catalogWatched.watched.value).toBe(false)

    switched.item.value = null

    expect(switched.catalogWatched.status.value).toBe('idle')
    expect(switched.catalogWatched.watched.value).toBe(false)
    expect(harness.fetch).toHaveBeenCalledTimes(2)
  })

  it('cancels the old account response and loads the new account state', async () => {
    const oldAccountResponse = Promise.withResolvers<unknown>()
    const newAccountResponse = Promise.withResolvers<unknown>()

    harness.fetch
      .mockReturnValueOnce(oldAccountResponse.promise)
      .mockReturnValueOnce(newAccountResponse.promise)

    const switched = setup({
      automaticLoad: true,
      initialAccountId: null
    })

    switched.account.value = firstAccountId

    const oldSignal = harness.fetch.mock.calls[0]?.[1].signal

    switched.account.value = secondAccountId

    expect(oldSignal?.aborted).toBe(true)
    expect(harness.fetch).toHaveBeenCalledTimes(2)
    oldAccountResponse.resolve({ watched: false })
    newAccountResponse.resolve({ watched: true })

    await vi.waitFor(() => {
      expect(switched.catalogWatched.status.value).toBe('loaded')
    })

    expect(switched.catalogWatched.watched.value).toBe(true)
  })

  it.each([
    {
      change: 'sign-out',
      update: ({ account }: ReturnType<typeof setup>) => { account.value = null }
    },
    {
      change: 'account switch',
      update: ({ account }: ReturnType<typeof setup>) => { account.value = secondAccountId }
    },
    {
      change: 'item switch',
      update: ({ item }: ReturnType<typeof setup>) => { item.value = secondItemId }
    }
  ])('ignores a rejected pending mutation after $change', async ({ update }) => {
    const pending = Promise.withResolvers<unknown>()

    const telemetry = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {
      // A stale mutation failure must not reach telemetry or state.
    })

    harness.fetch
      .mockResolvedValueOnce({ watched: false })
      .mockReturnValueOnce(pending.promise)

    const current = setup()

    await current.catalogWatched.load()

    const mutation = current.catalogWatched.toggle()
    const signal = harness.fetch.mock.calls[1]?.[1].signal

    expect(current.catalogWatched.watched.value).toBe(true)
    update(current)
    expect(signal?.aborted).toBe(true)
    expect(current.catalogWatched.status.value).toBe('idle')
    expect(current.catalogWatched.watched.value).toBe(false)
    pending.reject(new Error('late rejected mutation'))

    await mutation

    expect(current.catalogWatched.saveError.value).toBe('')
    expect(current.catalogWatched.unauthorized.value).toBeNull()
    expect(telemetry).not.toHaveBeenCalled()
  })
})
