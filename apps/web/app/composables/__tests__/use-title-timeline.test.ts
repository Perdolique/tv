import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
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

const row: CatalogTimelineItem = {
  id: '01991a00-0000-7000-8000-000000000003',
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
  }],

  episodesCursor: 'group-snapshot'
}

const scopes: ReturnType<typeof effectScope>[] = []

function setup(automaticLoad = false) {
  const scope = effectScope()
  const item = ref(itemId)
  const account = ref<string | null>('account')
  const timeZone = ref<string | null>('Europe/Tallinn')
  const context = ref('none:0')

  const timeline = scope.run(() => useTitleTimeline(item, account, {
    automaticLoad,
    timeZone,
    viewingContext: context
  }))

  scopes.push(scope)

  if (timeline === undefined) { throw new Error('Scope did not start') }

  return {
    account,
    context,
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

  it('keeps one group when a next-page representative ID changes after deletion', async () => {
    const changedGroup: CatalogTimelineItem = {
      ...row,
      id: '01991a00-0000-7000-8000-000000000099',
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
    expect(timeline.items.value).toStrictEqual([row])
  })

  it('appends a distinct next-page entry in order and keeps its cursor', async () => {
    const olderRow: CatalogTimelineItem = {
      id: '01991a00-0000-7000-8000-000000000007',
      kind: 'series_started',
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

    current.context.value = 'new:1'

    expect(signal?.aborted).toBe(true)

    pending.resolve({
      items: [],
      nextCursor: null
    })

    await expect(load).resolves.toBe(false)
    expect(current.timeline.items.value).toStrictEqual([])
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
