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

const { useCatalogEpisodeWatches } = await import('../use-catalog-episode-watches.ts')
const firstItemId = '01991a00-0000-7000-8000-000000000001'
const secondItemId = '01991a00-0000-7000-8000-000000000002'
const firstAccountId = '01991a00-0000-7000-8000-000000000003'
const secondAccountId = '01991a00-0000-7000-8000-000000000004'
const firstEpisodeId = '30000000-0000-7000-8000-000000000001'
const secondEpisodeId = '30000000-0000-7000-8000-000000000002'
const scopes: ReturnType<typeof effectScope>[] = []

function setup({
  automaticLoad = false,
  initialAccountId = firstAccountId,
  initialItemId = firstItemId
}: SetupOptions = {}) {
  const scope = effectScope()
  const item = ref<string | null>(initialItemId)
  const account = ref<string | null>(initialAccountId)

  const watches = scope.run(() => useCatalogEpisodeWatches(item, account, {
    automaticLoad
  }))

  scopes.push(scope)

  if (watches === undefined) {
    throw new Error('The catalog episode watches scope did not start')
  }

  return {
    account,
    item,
    watches
  }
}

describe('private catalog episode watches lifecycle', () => {
  beforeEach(() => { harness.fetch.mockReset() })

  afterEach(() => {
    for (const scope of scopes.splice(0)) {
      scope.stop()
    }

    vi.restoreAllMocks()
  })

  it('loads all watched episode IDs in one request', async () => {
    harness.fetch.mockResolvedValue({ watchedEpisodeIds: [firstEpisodeId, secondEpisodeId] })

    const { watches } = setup()

    await watches.load()
    expect(watches.status.value).toBe('loaded')
    expect(watches.watchedEpisodeIds.value).toStrictEqual([firstEpisodeId, secondEpisodeId])
    expect(watches.watchedCount.value).toBe(2)

    expect(harness.fetch).toHaveBeenCalledExactlyOnceWith(
      `/api/catalog/items/${firstItemId}/episodes/watched`,
      expect.objectContaining({ retry: 0 })
    )
  })

  it('marks optimistically, updates the total and blocks every repeated mutation', async () => {
    const pending = Promise.withResolvers<unknown>()

    harness.fetch
      .mockResolvedValueOnce({ watchedEpisodeIds: [] })
      .mockReturnValueOnce(pending.promise)

    const { watches } = setup()

    await watches.load()

    const firstMutation = watches.toggle(firstEpisodeId)
    const repeatedMutation = watches.toggle(secondEpisodeId)

    expect(watches.watchedEpisodeIds.value).toContain(firstEpisodeId)
    expect(watches.watchedCount.value).toBe(1)
    expect(watches.isSaving.value).toBe(true)
    expect(watches.savingEpisodeId.value).toBe(firstEpisodeId)
    expect(harness.fetch).toHaveBeenCalledTimes(2)
    pending.resolve({ watched: true })
    await Promise.all([firstMutation, repeatedMutation])
    expect(watches.watchedEpisodeIds.value).toContain(firstEpisodeId)
    expect(watches.watchedEpisodeIds.value).not.toContain(secondEpisodeId)
    expect(watches.isSaving.value).toBe(false)
  })

  it('unmarks a loaded episode with DELETE and preserves other watched episodes', async () => {
    const pending = Promise.withResolvers<unknown>()

    harness.fetch
      .mockResolvedValueOnce({ watchedEpisodeIds: [firstEpisodeId, secondEpisodeId] })
      .mockReturnValueOnce(pending.promise)

    const { watches } = setup()

    await watches.load()

    const mutation = watches.toggle(firstEpisodeId)

    expect(watches.watchedEpisodeIds.value).toStrictEqual([secondEpisodeId])
    expect(watches.watchedCount.value).toBe(1)
    expect(watches.isSaving.value).toBe(true)

    expect(harness.fetch).toHaveBeenLastCalledWith(
      `/api/catalog/episodes/${firstEpisodeId}/watched`,
      expect.objectContaining({
        method: 'DELETE',
        retry: 0
      })
    )

    pending.resolve({ watched: false })

    await mutation

    expect(watches.watchedEpisodeIds.value).toStrictEqual([secondEpisodeId])
    expect(watches.watchedCount.value).toBe(1)
    expect(watches.isSaving.value).toBe(false)
    expect(watches.saveErrorFor(firstEpisodeId)).toBe('')
  })

  it('restores a loaded mark after a failed DELETE and allows retry', async () => {
    const failure = new Error('controlled unmark failure')

    vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {
      // This test checks rollback and retry after the failed request.
    })

    harness.fetch
      .mockResolvedValueOnce({ watchedEpisodeIds: [firstEpisodeId] })
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ watched: false })

    const { watches } = setup()

    await watches.load()
    await watches.toggle(firstEpisodeId)
    expect(watches.watchedEpisodeIds.value).toStrictEqual([firstEpisodeId])
    expect(watches.watchedCount.value).toBe(1)
    expect(watches.saveErrorFor(firstEpisodeId)).toBe('We couldn’t update this episode. Try again.')
    await watches.toggle(firstEpisodeId)

    expect(harness.fetch).toHaveBeenLastCalledWith(
      `/api/catalog/episodes/${firstEpisodeId}/watched`,
      expect.objectContaining({ method: 'DELETE' })
    )

    expect(watches.watchedEpisodeIds.value).toStrictEqual([])
    expect(watches.watchedCount.value).toBe(0)
    expect(watches.saveErrorFor(firstEpisodeId)).toBe('')
  })

  it('rolls back a transport failure and retries the same episode', async () => {
    const failure = new Error('controlled watched failure')

    const telemetry = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {
      // The raw failure is asserted below.
    })

    harness.fetch
      .mockResolvedValueOnce({ watchedEpisodeIds: [] })
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ watched: true })

    const { watches } = setup()

    await watches.load()
    await watches.toggle(firstEpisodeId)
    expect(watches.watchedEpisodeIds.value).not.toContain(firstEpisodeId)
    expect(watches.watchedCount.value).toBe(0)
    expect(watches.saveErrorFor(firstEpisodeId)).toBe('We couldn’t update this episode. Try again.')
    await watches.toggle(firstEpisodeId)
    expect(watches.watchedEpisodeIds.value).toContain(firstEpisodeId)
    expect(watches.saveErrorFor(firstEpisodeId)).toBe('')

    expect(telemetry).toHaveBeenCalledWith({
      error: failure,
      message: 'Catalog episode watched update request failed.'
    })
  })

  it('rolls back an unexpected mutation response', async () => {
    const telemetry = vi.spyOn(globalThis.console, 'error').mockImplementation(() => {
      // The mismatch is asserted below.
    })

    harness.fetch
      .mockResolvedValueOnce({ watchedEpisodeIds: [] })
      .mockResolvedValueOnce({ watched: false })

    const { watches } = setup()

    await watches.load()
    await watches.toggle(firstEpisodeId)
    expect(watches.watchedEpisodeIds.value).not.toContain(firstEpisodeId)
    expect(watches.saveErrorFor(firstEpisodeId)).not.toBe('')
    expect(telemetry).toHaveBeenCalledWith('Catalog episode watched response did not match the requested state.')
  })

  it('rolls back a mutation 401 and exposes the redirect reason', async () => {
    harness.fetch
      .mockResolvedValueOnce({ watchedEpisodeIds: [] })
      .mockRejectedValueOnce({ statusCode: 401 })

    const { watches } = setup()

    await watches.load()
    await watches.toggle(firstEpisodeId)
    expect(watches.watchedEpisodeIds.value).not.toContain(firstEpisodeId)
    expect(watches.unauthorized.value).toBe('mutation')
    expect(watches.saveErrorFor(firstEpisodeId)).toBe('')
    watches.clearUnauthorized()
    expect(watches.unauthorized.value).toBeNull()
  })

  it('clears private state immediately and ignores stale results after account switch', async () => {
    const firstResponse = Promise.withResolvers<unknown>()
    const secondResponse = Promise.withResolvers<unknown>()

    harness.fetch
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise)

    const current = setup({ automaticLoad: true })
    const firstSignal = harness.fetch.mock.calls[0]?.[1].signal

    current.account.value = secondAccountId

    expect(firstSignal?.aborted).toBe(true)
    expect(current.watches.watchedEpisodeIds.value).toStrictEqual([])
    expect(harness.fetch).toHaveBeenCalledTimes(2)
    firstResponse.resolve({ watchedEpisodeIds: [firstEpisodeId] })
    secondResponse.resolve({ watchedEpisodeIds: [secondEpisodeId] })

    await vi.waitFor(() => {
      expect(current.watches.status.value).toBe('loaded')
    })

    expect(current.watches.watchedEpisodeIds.value).toStrictEqual([secondEpisodeId])
  })

  it('clears private state on sign-out and never clears public episode data', async () => {
    const publicEpisodes = [firstEpisodeId, secondEpisodeId]

    harness.fetch.mockResolvedValue({ watchedEpisodeIds: [firstEpisodeId] })

    const current = setup()

    await current.watches.load()

    current.account.value = null

    expect(current.watches.status.value).toBe('idle')
    expect(current.watches.watchedEpisodeIds.value).toStrictEqual([])
    expect(publicEpisodes).toStrictEqual([firstEpisodeId, secondEpisodeId])
  })

  it('converts a bulk 401 to guest state without an episode mutation', async () => {
    harness.fetch.mockRejectedValue({ statusCode: 401 })

    const { watches } = setup()

    await watches.load()
    expect(watches.status.value).toBe('idle')
    expect(watches.unauthorized.value).toBe('load')
    expect(harness.fetch).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending mutation when the series changes', async () => {
    const pending = Promise.withResolvers<unknown>()

    harness.fetch
      .mockResolvedValueOnce({ watchedEpisodeIds: [] })
      .mockReturnValueOnce(pending.promise)

    const telemetry = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {
      // A stale rejection must not reach telemetry.
    })

    const current = setup()

    await current.watches.load()

    const mutation = current.watches.toggle(firstEpisodeId)
    const signal = harness.fetch.mock.calls[1]?.[1].signal

    current.item.value = secondItemId

    expect(signal?.aborted).toBe(true)
    expect(current.watches.watchedEpisodeIds.value).not.toContain(firstEpisodeId)
    pending.reject(new Error('late mutation failure'))

    await mutation

    expect(telemetry).not.toHaveBeenCalled()
  })
})
