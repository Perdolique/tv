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

describe('catalog watched request lifecycle', () => {
  beforeEach(() => { harness.fetch.mockReset() })

  afterEach(() => {
    for (const scope of scopes.splice(0)) {
      scope.stop()
    }

    vi.restoreAllMocks()
  })

  it('does not load automatically when automaticLoad is false', async () => {
    harness.fetch.mockResolvedValue({ watched: false })

    const { account, catalogWatched, item } = setup({ automaticLoad: false })

    expect(harness.fetch).not.toHaveBeenCalled()

    account.value = secondAccountId
    item.value = secondItemId

    expect(harness.fetch).not.toHaveBeenCalled()
    await catalogWatched.load()
    expect(catalogWatched.status.value).toBe('loaded')

    expect(harness.fetch).toHaveBeenCalledExactlyOnceWith(
      `/api/catalog/items/${secondItemId}/watched`,
      expect.objectContaining({ retry: 0 })
    )
  })

  it('loads immediately when automaticLoad starts with an item and account', async () => {
    harness.fetch.mockResolvedValue({ watched: true })

    const { catalogWatched } = setup({ automaticLoad: true })

    await vi.waitFor(() => {
      expect(catalogWatched.status.value).toBe('loaded')
    })

    expect(catalogWatched.watched.value).toBe(true)
    expect(harness.fetch).toHaveBeenCalledTimes(1)
  })

  it('loads manually only when an item and authenticated account are available', async () => {
    harness.fetch.mockResolvedValue({ watched: false })

    const anonymous = setup({ initialAccountId: null })

    await anonymous.catalogWatched.load()
    expect(harness.fetch).not.toHaveBeenCalled()

    anonymous.account.value = firstAccountId

    await anonymous.catalogWatched.load()
    expect(anonymous.catalogWatched.status.value).toBe('loaded')
    expect(anonymous.catalogWatched.watched.value).toBe(false)
  })

  it('updates optimistically and preserves the response state after success', async () => {
    harness.fetch
      .mockResolvedValueOnce({ watched: false })
      .mockResolvedValueOnce({ watched: true })

    const { catalogWatched } = setup()

    await catalogWatched.load()

    const saved = catalogWatched.toggle()

    expect(catalogWatched.watched.value).toBe(true)
    expect(catalogWatched.isSaving.value).toBe(true)

    expect(harness.fetch).toHaveBeenLastCalledWith(
      `/api/catalog/items/${firstItemId}/watched`,
      expect.objectContaining({
        method: 'PUT',
        retry: 0
      })
    )

    await saved

    expect(catalogWatched.watched.value).toBe(true)
    expect(catalogWatched.isSaving.value).toBe(false)
    expect(catalogWatched.saveError.value).toBe('')
  })

  it('rolls back a failed mark and can retry the same action', async () => {
    const failure = { statusCode: 503 }

    const telemetry = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {
      // The raw transport failure is asserted below.
    })

    harness.fetch
      .mockResolvedValueOnce({ watched: false })
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ watched: true })

    const { catalogWatched } = setup()

    await catalogWatched.load()
    await catalogWatched.toggle()
    expect(catalogWatched.watched.value).toBe(false)
    expect(catalogWatched.isSaving.value).toBe(false)
    expect(catalogWatched.saveError.value).toBe('We couldn’t update your watched status. Try again.')
    await catalogWatched.toggle()
    expect(catalogWatched.watched.value).toBe(true)
    expect(catalogWatched.saveError.value).toBe('')

    expect(telemetry).toHaveBeenCalledWith({
      error: failure,
      message: 'Catalog watched update request failed.'
    })
  })

  it('blocks repeated mutations while a save is pending', async () => {
    const pending = Promise.withResolvers<unknown>()

    harness.fetch
      .mockResolvedValueOnce({ watched: false })
      .mockReturnValueOnce(pending.promise)

    const { catalogWatched } = setup()

    await catalogWatched.load()

    const firstSave = catalogWatched.toggle()
    const repeatedSave = catalogWatched.toggle()

    expect(catalogWatched.watched.value).toBe(true)
    expect(catalogWatched.isSaving.value).toBe(true)
    expect(harness.fetch).toHaveBeenCalledTimes(2)
    pending.resolve({ watched: true })
    await Promise.all([firstSave, repeatedSave])
    expect(catalogWatched.watched.value).toBe(true)
    expect(catalogWatched.isSaving.value).toBe(false)
  })

  it('shows optimistic unmark state, rolls back failure and retries without transport retry', async () => {
    const pending = Promise.withResolvers<unknown>()
    const failure = { statusCode: 503 }

    vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {
      // The transport failure is expected in this rollback scenario.
    })

    harness.fetch
      .mockResolvedValueOnce({ watched: true })
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ watched: false })

    const { catalogWatched } = setup()

    await catalogWatched.load()

    const failedSave = catalogWatched.toggle()

    expect(catalogWatched.watched.value).toBe(false)
    expect(catalogWatched.isSaving.value).toBe(true)

    expect(harness.fetch).toHaveBeenNthCalledWith(
      2,
      `/api/catalog/items/${firstItemId}/watched`,
      expect.objectContaining({
        method: 'DELETE',
        retry: 0
      })
    )

    pending.reject(failure)

    await failedSave

    expect(catalogWatched.watched.value).toBe(true)
    expect(catalogWatched.isSaving.value).toBe(false)
    expect(catalogWatched.saveError.value).toBe('We couldn’t update your watched status. Try again.')
    await catalogWatched.toggle()
    expect(catalogWatched.watched.value).toBe(false)
    expect(catalogWatched.saveError.value).toBe('')

    expect(harness.fetch).toHaveBeenNthCalledWith(
      3,
      `/api/catalog/items/${firstItemId}/watched`,
      expect.objectContaining({
        method: 'DELETE',
        retry: 0
      })
    )
  })

  it('rejects extra response fields and keeps raw validation issues in telemetry', async () => {
    const log = vi.spyOn(globalThis.console, 'error').mockImplementation(() => {
      // The raw validation issues are asserted below.
    })

    harness.fetch.mockResolvedValueOnce({
      unexpected: 'load detail',
      watched: false
    })

    const { catalogWatched } = setup()

    await catalogWatched.load()
    expect(catalogWatched.status.value).toBe('error')
    expect(log.mock.calls[0]?.[0]).toBe('Catalog watched response validation failed.')
    expect(log.mock.calls[0]?.[1]).toStrictEqual(expect.any(Array))
    expect(JSON.stringify(log.mock.calls[0]?.[1])).toContain('unexpected')
    harness.fetch.mockResolvedValueOnce({ watched: false })
    await catalogWatched.load()

    harness.fetch.mockResolvedValueOnce({
      unexpected: 'mutation detail',
      watched: true
    })

    await catalogWatched.toggle()
    expect(catalogWatched.watched.value).toBe(false)
    expect(catalogWatched.saveError.value).toBe('We couldn’t update your watched status. Try again.')
    expect(log.mock.calls[1]?.[0]).toBe('Catalog watched response validation failed.')
    expect(log.mock.calls[1]?.[1]).toStrictEqual(expect.any(Array))
    expect(JSON.stringify(log.mock.calls[1]?.[1])).toContain('unexpected')
  })

})
