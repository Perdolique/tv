import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef, toRef } from 'vue'
import type { CatalogTimelineItem } from '@tv/shared/catalog-timeline'

interface RequestOptions {
  query: unknown;
  retry: number;
  signal: AbortSignal;
}

const harness = vi.hoisted(() => { return { fetch: vi.fn<(url: string, options: RequestOptions) => Promise<unknown>>() } })

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Nuxt's virtual module is not available in Node.
vi.mock('#app', () => { return { useRequestFetch: () => harness.fetch } })

const { useTitleTimeline } = await import('../use-title-timeline.ts')
const itemId = '01991a00-0000-7000-8000-000000000001'
const viewingId = '01991a00-0000-7000-8000-000000000002'

const row = {
  id: `episode_group:${viewingId}:2026-10-08`,
  kind: 'episode_group',
  viewingId,
  occurredAt: '2026-10-08T10:00:00.000000Z',
  localDate: '2026-10-08',
  totalCount: 25,

  seasons: [{
    seasonNumber: 1,

    ranges: [{
      firstEpisodeNumber: 1,
      lastEpisodeNumber: 25
    }]
  }]
} satisfies CatalogTimelineItem

const scopes: ReturnType<typeof effectScope>[] = []

function setup(automaticLoad = false) {
  const scope = effectScope()
  const item = shallowRef<string | null>(itemId)
  const account = shallowRef<string | null>('account')
  const timeZone = shallowRef<string | null>('Europe/Tallinn')
  const contextSource = shallowRef({ key: 'none:0' })
  const context = toRef(() => contextSource.value.key)
  const mutationVersion = shallowRef(0)

  const timeline = scope.run(() => useTitleTimeline(item, account, {
    automaticLoad,
    timeZone,
    viewingContext: context,
    mutationVersion
  }))

  scopes.push(scope)

  if (timeline === undefined) { throw new Error('Scope did not start') }

  return {
    account,
    context: contextSource,
    item,
    mutationVersion,
    timeline,
    timeZone
  }
}

describe('title timeline pagination and cancellation', () => {
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

  it('recovers an expired cursor with a confirmed first page while keeping old entries visible', async () => {
    const replacement = Promise.withResolvers<unknown>()

    harness.fetch.mockResolvedValueOnce({
      items: [row],
      nextCursor: 'legacy'
    })
      .mockRejectedValueOnce({ statusCode: 400 })
      .mockReturnValueOnce(replacement.promise)

    const { timeline } = setup()

    await timeline.load()

    const loading = timeline.load(true)

    await vi.waitFor(() => { expect(harness.fetch).toHaveBeenCalledTimes(3) })
    expect(timeline.items.value).toStrictEqual([row])
    expect(timeline.isLoadingMore.value).toBe(true)
    expect(harness.fetch.mock.calls[2]?.[1].query).toStrictEqual({ timeZone: 'Europe/Tallinn' })

    replacement.resolve({
      items: [],
      nextCursor: null
    })

    await expect(loading).resolves.toBe(true)
    expect(timeline.items.value).toStrictEqual([])
    expect(timeline.nextCursor.value).toBeNull()
    expect(timeline.didRecoverCursor.value).toBe(true)
    expect(timeline.isLoadingMore.value).toBe(false)
  })

  it('preserves loaded history and the next cursor when the next page fails', async () => {
    const failure = new Error('page failed')

    harness.fetch.mockResolvedValueOnce({
      items: [row],
      nextCursor: 'next'
    }).mockRejectedValueOnce(failure).mockResolvedValueOnce({
      items: [],
      nextCursor: null
    })

    const { timeline } = setup()

    await timeline.load()
    await expect(timeline.load(true)).resolves.toBe(false)
    expect(timeline.items.value).toStrictEqual([row])
    expect(timeline.nextCursor.value).toBe('next')
    expect(timeline.status.value).toBe('loaded')
    expect(timeline.failedPage.value).toBe('more')
    await timeline.load(true)

    expect(harness.fetch.mock.calls[2]?.[1].query).toStrictEqual({
      timeZone: 'Europe/Tallinn',
      cursor: 'next'
    })

    expect(timeline.nextCursor.value).toBeNull()
  })

  it('merges the updated count for one stable calendar group after deletion', async () => {
    const changedGroup: CatalogTimelineItem = {
      ...row,
      id: `episode_group:${viewingId}:2026-10-08`,
      totalCount: 24
    }

    harness.fetch.mockResolvedValueOnce({
      items: [row],
      nextCursor: 'next'
    }).mockResolvedValueOnce({
      items: [changedGroup],
      nextCursor: null
    })

    const { timeline } = setup()

    await timeline.load()
    await timeline.load(true)
    expect(timeline.items.value).toStrictEqual([changedGroup])
  })

  it('appends a distinct next-page entry in order and keeps its cursor', async () => {
    const olderRow: CatalogTimelineItem = {
      id: '01991a00-0000-7000-8000-000000000007',
      kind: 'series_started',
      startedOn: '2026-10-01',
      score: null,
      viewingId,
      occurredAt: '2026-10-01T10:00:00.000000Z'
    }

    harness.fetch.mockResolvedValueOnce({
      items: [row],
      nextCursor: 'next'
    }).mockResolvedValueOnce({
      items: [olderRow],
      nextCursor: 'older'
    })

    const { timeline } = setup()

    await timeline.load()
    await expect(timeline.load(true)).resolves.toBe(true)
    expect(timeline.items.value).toStrictEqual([row, olderRow])
    expect(timeline.nextCursor.value).toBe('older')
  })

  it('aborts and ignores a history page after current viewing changes', async () => {
    const pending = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(pending.promise)

    const current = setup()
    const load = current.timeline.load()
    const signal = harness.fetch.mock.calls[0]?.[1].signal

    current.context.value = { key: 'new:1' }

    expect(signal?.aborted).toBe(true)

    pending.resolve({
      items: [],
      nextCursor: null
    })

    await expect(load).resolves.toBe(false)
    expect(current.timeline.items.value).toStrictEqual([])
  })

  it.each([
    {
      name: 'current mutation',
      nextItem: itemId,
      nextContext: 'new:1',
      nextVersion: 1
    },
    {
      name: 'historical mutation',
      nextItem: itemId,
      nextContext: 'none:0',
      nextVersion: 1
    },
    {
      name: 'external context',
      nextItem: itemId,
      nextContext: 'new:1',
      nextVersion: 0
    },
    {
      name: 'identity change',
      nextItem: viewingId,
      nextContext: 'new:1',
      nextVersion: 1
    }
  ])('loads one page after $name invalidation', async ({ nextItem, nextContext, nextVersion }) => {
    harness.fetch.mockResolvedValue({
      items: [],
      nextCursor: null
    })

    const current = setup(true)

    await vi.waitFor(() => { expect(current.timeline.status.value).toBe('loaded') })
    harness.fetch.mockClear()

    current.item.value = nextItem
    current.context.value = { key: nextContext }
    current.mutationVersion.value = nextVersion

    await nextTick()
    await vi.waitFor(() => { expect(current.timeline.status.value).toBe('loaded') })
    expect(harness.fetch).toHaveBeenCalledTimes(1)
    expect(harness.fetch.mock.calls[0]?.[1].signal.aborted).toBe(false)
  })

  it('keeps loaded history when a replacement summary has the same context key', async () => {
    harness.fetch.mockResolvedValue({
      items: [row],
      nextCursor: 'next'
    })

    const current = setup(true)

    await vi.waitFor(() => { expect(current.timeline.status.value).toBe('loaded') })
    harness.fetch.mockClear()

    current.context.value = { key: 'none:0' }

    await nextTick()
    expect(harness.fetch).not.toHaveBeenCalled()
    expect(current.timeline.items.value).toStrictEqual([row])
    expect(current.timeline.nextCursor.value).toBe('next')
  })

  it('clears private history and ignores a late page after sign-out', async () => {
    const pending = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(pending.promise)

    const current = setup()
    const load = current.timeline.load()
    const signal = harness.fetch.mock.calls[0]?.[1].signal

    current.account.value = null

    expect(signal?.aborted).toBe(true)

    pending.resolve({
      items: [row],
      nextCursor: 'next'
    })

    await expect(load).resolves.toBe(false)
    expect(current.timeline.items.value).toStrictEqual([])
  })
})
