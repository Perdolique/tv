import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import type { CatalogSeriesWatchesResponse } from '@tv/shared/catalog-series'
import { isRecord } from '@tv/shared/type-guards'

interface RequestOptions {
  body?: unknown;
  method?: string;
  retry: number;
  signal: AbortSignal;
}

const harness = vi.hoisted(() => { return { fetch: vi.fn<(url: string, options: RequestOptions) => Promise<unknown>>() } })

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Nuxt's virtual module is not available in Node.
vi.mock('#app', () => { return { useRequestFetch: () => harness.fetch } })

const { useCatalogEpisodeWatches } = await import('../use-catalog-episode-watches.ts')
const itemId = '01991a00-0000-7000-8000-000000000001'
const accountId = '01991a00-0000-7000-8000-000000000002'
const episodeId = '01991a00-0000-7000-8000-000000000003'
const viewingId = '01991a00-0000-7000-8000-000000000004'
const watchId = '01991a00-0000-7000-8000-000000000005'
const scopes: ReturnType<typeof effectScope>[] = []

function response(watched = false, currentId: string | null = watched ? viewingId : null, version = watched ? 1 : 0): CatalogSeriesWatchesResponse {
  const watchedEpisodeIds = watched ? [episodeId] : []

  const watches = watched ? [{
    id: watchId,
    catalogEpisodeId: episodeId,
    viewingId,
    markedAt: '2026-10-08T10:00:00.000000Z'
  }] : []

  const currentViewing: CatalogSeriesWatchesResponse['currentViewing'] = currentId === null ? null : {
    id: currentId,
    catalogItemId: itemId,
    status: 'watching',
    isRewatch: false,
    recordedAt: '2026-10-08T10:00:00.000000Z',
    revision: 1
  }

  return {
    watchedEpisodeIds,
    watches,
    currentViewing,
    contextVersion: version
  }
}

function setup(automaticLoad = false, initialTimeZone: string | null = 'Europe/Tallinn') {
  const scope = effectScope()
  const item = ref<string | null>(itemId)
  const account = ref<string | null>(accountId)
  const timeZone = ref<string | null>(initialTimeZone)

  const watches = scope.run(() => useCatalogEpisodeWatches(item, account, {
    automaticLoad,
    timeZone
  }))

  scopes.push(scope)

  if (watches === undefined) { throw new Error('Scope did not start') }

  return {
    account,
    item,
    timeZone,
    watches
  }
}

describe('current series viewing requests', () => {
  beforeEach(() => {
    harness.fetch.mockReset()

    const warn = vi.spyOn(globalThis.console, 'warn')

    warn.mockImplementation(() => {
      // Expected failures retain raw telemetry.
    })
  })

  afterEach(() => {
    const finishedScopes = scopes.splice(0)

    for (const scope of finishedScopes) { scope.stop() }

    vi.restoreAllMocks()
  })

  it('waits for account and browser time zone before loading private data', async () => {
    const empty = response()

    harness.fetch.mockResolvedValue(empty)

    const current = setup(true, null)

    expect(harness.fetch).not.toHaveBeenCalled()

    current.timeZone.value = 'Europe/Tallinn'

    await vi.waitFor(() => { expect(current.watches.status.value).toBe('loaded') })
    expect(harness.fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps counters unchanged until confirmation and blocks repeated writes', async () => {
    const pending = Promise.withResolvers<unknown>()
    const empty = response()
    const watched = response(true)

    harness.fetch.mockResolvedValueOnce(empty).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(watched)

    const { watches } = setup()

    await watches.load()

    const mutation = watches.toggle(episodeId)

    await watches.markReleased(null)
    expect(watches.watchedCount.value).toBe(0)
    expect(watches.isSaving.value).toBe(true)
    expect(harness.fetch).toHaveBeenCalledTimes(2)
    pending.resolve(watched)
    await expect(mutation).resolves.toBe(true)
    expect(watches.watchedCount.value).toBe(1)
    expect(watches.mutationVersion.value).toBe(1)
  })

  it('retries a lost answer with the same request key and expected context', async () => {
    const failure = new Error('lost answer containing private transport details')
    const empty = response()
    const watched = response(true)

    harness.fetch.mockResolvedValueOnce(empty).mockRejectedValueOnce(failure).mockResolvedValueOnce(watched).mockResolvedValueOnce(watched)

    const { watches } = setup()

    await watches.load()
    await expect(watches.toggle(episodeId)).resolves.toBe(false)
    expect(watches.saveErrorFor(episodeId)).toBe('We couldn’t save this change. Try again.')

    const warning: unknown = vi.mocked(globalThis.console.warn).mock.calls[0]?.[0]

    assert(isRecord(warning))
    expect(warning.error).toBe(failure)

    const firstBody = harness.fetch.mock.calls[1]?.[1].body

    await expect(watches.toggle(episodeId)).resolves.toBe(true)
    expect(harness.fetch.mock.calls[2]?.[1].body).toStrictEqual(firstBody)

    expect(firstBody).toMatchObject({
      currentViewingId: null,
      contextVersion: 0,
      timeZone: 'Europe/Tallinn'
    })
  })

  it('keeps the original PUT when a refresh discovers the mark after a lost answer', async () => {
    const failure = new Error('lost answer')
    const empty = response()
    const watched = response(true)

    harness.fetch.mockResolvedValueOnce(empty).mockRejectedValueOnce(failure).mockResolvedValueOnce(watched).mockResolvedValueOnce(watched).mockResolvedValueOnce(watched)

    const { watches } = setup()

    await watches.load()
    await watches.toggle(episodeId)

    const firstBody = harness.fetch.mock.calls[1]?.[1].body

    await watches.load()
    await watches.toggle(episodeId)

    expect(harness.fetch.mock.calls[3]?.[1]).toMatchObject({
      method: 'PUT',
      body: firstBody
    })

    expect(watches.watchedCount.value).toBe(1)
  })

  it('deletes the exact loaded mark and keeps the mark visible until confirmation', async () => {
    const pending = Promise.withResolvers<unknown>()
    const watched = response(true)
    const empty = response(false, viewingId, 1)

    harness.fetch.mockResolvedValueOnce(watched).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(empty)

    const { watches } = setup()

    await watches.load()

    const mutation = watches.toggle(episodeId)

    expect(watches.watchedCount.value).toBe(1)

    expect(harness.fetch.mock.calls[1]?.[1]).toMatchObject({
      method: 'DELETE',

      body: {
        currentViewingId: viewingId,
        contextVersion: 1,
        watchId
      }
    })

    pending.resolve(empty)

    await mutation

    expect(watches.watchedCount.value).toBe(0)
  })

  it('keeps a confirmed bulk write successful if its refresh fails', async () => {
    const empty = response()
    const watched = response(true)
    const failure = new Error('refresh failed')

    harness.fetch.mockResolvedValueOnce(empty).mockResolvedValueOnce(watched).mockRejectedValueOnce(failure)

    const { watches } = setup()

    await watches.load()
    await expect(watches.markReleased(2)).resolves.toBe(true)
    expect(harness.fetch.mock.calls[1]?.[0]).toBe(`/api/catalog/items/${itemId}/seasons/2/watched`)
    expect(watches.watchedCount.value).toBe(1)
    expect(watches.status.value).toBe('loaded')
    expect(watches.actionError.value).toBe('')
    expect(watches.readError.value).not.toBe('')
  })

  it('refreshes a conflict and uses a fresh context for the next attempt', async () => {
    const empty = response()
    const refreshed = response(false, viewingId, 4)
    const watched = response(true, viewingId, 4)

    harness.fetch.mockResolvedValueOnce(empty).mockRejectedValueOnce({ statusCode: 409 }).mockResolvedValueOnce(refreshed).mockResolvedValueOnce(watched).mockResolvedValueOnce(watched)

    const { watches } = setup()

    await watches.load()
    await watches.toggle(episodeId)
    expect(watches.saveErrorFor(episodeId)).toContain('current viewing changed')
    await watches.toggle(episodeId)

    expect(harness.fetch.mock.calls[3]?.[1].body).toMatchObject({
      currentViewingId: viewingId,
      contextVersion: 4
    })
  })

  it('starts one empty rewatch without a pause or completion and blocks a repeated start', async () => {
    const nextViewingId = '01991a00-0000-7000-8000-000000000006'
    const watched = response(true)
    const rewatch = response(false, nextViewingId, 2)

    assert(rewatch.currentViewing !== null)

    rewatch.currentViewing.isRewatch = true

    harness.fetch.mockResolvedValueOnce(watched).mockResolvedValue(rewatch)

    const { watches } = setup()

    await watches.load()
    await expect(watches.startRewatch()).resolves.toBe(true)

    expect(harness.fetch.mock.calls[1]?.[1].body).toMatchObject({
      currentViewingId: viewingId,
      contextVersion: 1
    })

    expect(harness.fetch.mock.calls[1]?.[1].body).not.toHaveProperty('closeStatus')
    await expect(watches.startRewatch()).resolves.toBe(false)
    expect(harness.fetch).toHaveBeenCalledTimes(3)
    expect(watches.canCancelRewatch.value).toBe(true)
    expect(watches.currentViewingId.value).toBe(nextViewingId)
    expect(watches.watchedCount.value).toBe(0)
  })

  it('retries cancellation with the same context and restores earlier marks after confirmation', async () => {
    const nextViewingId = '01991a00-0000-7000-8000-000000000006'
    const empty = response(false, nextViewingId, 2)
    const restored = response(true, viewingId, 3)
    const pending = Promise.withResolvers<unknown>()

    assert(empty.currentViewing !== null)

    empty.currentViewing.isRewatch = true

    harness.fetch.mockResolvedValueOnce(empty).mockRejectedValueOnce(new Error('lost cancellation answer')).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(restored)

    const { watches } = setup()

    await watches.load()
    await expect(watches.cancelRewatch()).resolves.toBe(false)

    const body = harness.fetch.mock.calls[1]?.[1].body
    const cancellation = watches.cancelRewatch()

    expect(watches.watchedCount.value).toBe(0)

    expect(harness.fetch.mock.calls[2]?.[1]).toMatchObject({
      method: 'DELETE',
      body
    })

    expect(body).toStrictEqual({
      currentViewingId: nextViewingId,
      contextVersion: 2
    })

    pending.resolve(restored)
    await expect(cancellation).resolves.toBe(true)
    expect(watches.currentViewingId.value).toBe(viewingId)
    expect(watches.watchedCount.value).toBe(1)
    expect(watches.canCancelRewatch.value).toBe(false)
    await expect(watches.cancelRewatch()).resolves.toBe(false)
    expect(harness.fetch).toHaveBeenCalledTimes(4)
  })

  it.each([
    {
      operation: 'read',
      context: 'account'
    },
    {
      operation: 'write',
      context: 'account'
    },
    {
      operation: 'read',
      context: 'item'
    },
    {
      operation: 'write',
      context: 'item'
    }
  ] as const)('aborts a pending $operation and ignores its answer after $context changes', async ({ operation, context }) => {
    const pending = Promise.withResolvers<unknown>()
    const nextId = '01991a00-0000-7000-8000-000000000007'
    const nextViewingId = '01991a00-0000-7000-8000-000000000008'
    const watched = response(true)

    harness.fetch.mockResolvedValueOnce(watched).mockReturnValueOnce(pending.promise)

    const current = setup()

    await current.watches.load()

    const requestMethods = {
      read: async () => current.watches.load(),
      write: async () => current.watches.toggle(episodeId)
    }

    const oldRequest = requestMethods[operation]()
    const signal = harness.fetch.mock.calls[1]?.[1].signal

    current[context].value = nextId

    expect(signal?.aborted).toBe(true)

    const catalogItemIds = {
      account: itemId,
      item: nextId
    }

    const nextState: CatalogSeriesWatchesResponse = {
      watchedEpisodeIds: [],
      watches: [],

      currentViewing: {
        id: nextViewingId,
        catalogItemId: catalogItemIds[context],
        status: 'watching',
        isRewatch: false,
        recordedAt: '2026-10-08T12:00:00.000000Z',
        revision: 1
      },

      contextVersion: 7
    }

    harness.fetch.mockResolvedValueOnce(nextState)
    await expect(current.watches.load()).resolves.toBe(true)
    expect(current.watches.currentViewing.value).toStrictEqual(nextState.currentViewing)
    pending.resolve(watched)
    await expect(oldRequest).resolves.toBe(false)
    expect(current.watches.watchedEpisodeIds.value).toStrictEqual([])
    expect(current.watches.currentViewing.value).toStrictEqual(nextState.currentViewing)
    expect(current.watches.contextVersion.value).toBe(7)
    expect(current.watches.status.value).toBe('loaded')
  })
})
