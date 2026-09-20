import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'

interface RequestOptions {
  query: {
    cursor?: string;
    from: string;
  };
  retry: number;
  signal: AbortSignal;
}

const harness = vi.hoisted(() => {
  return {
    fetch: vi.fn<(url: string, options: RequestOptions) => Promise<unknown>>()
  }
})

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Nuxt's virtual #app module is unavailable to TypeScript outside the generated app context.
vi.mock('#app', () => {
  return {
    useRequestFetch: () => harness.fetch
  }
})

const { useUpcomingReleases } = await import('../use-upcoming-releases.ts')

function createItem(index: number) {
  const suffix = String(index).padStart(12, '0')

  return {
    episodeNumber: index,
    id: `01991a00-0000-7000-8000-${suffix}`,
    originalTitle: `Series ${index}`,
    originalTitleLocale: 'en',
    posterUrl: null,
    releaseDate: '2026-09-18',
    releaseId: `02991a00-0000-7000-8000-${suffix}`,
    releaseYear: 2026,
    seasonNumber: 1,
    title: `Series ${index}`,
    titleLocale: 'en',
    type: 'series'
  } as const
}

const firstItem = createItem(1)
const secondItem = createItem(2)
const scopes: ReturnType<typeof effectScope>[] = []

function setup() {
  const scope = effectScope()
  const accountId = ref<string | null>('user-one')
  const from = ref<string | null>('2026-09-16')
  const active = ref(true)
  const releases = scope.run(() => useUpcomingReleases(accountId, from, active))

  scopes.push(scope)

  if (releases === undefined) {
    throw new Error('The upcoming releases scope did not start')
  }

  return {
    accountId,
    active,
    from,
    releases,
    scope
  }
}

async function expectPendingRequestCleared(
  changeInput: (fixture: ReturnType<typeof setup>) => void,
  expectedRequestCount: number
): Promise<void> {
  const pending = Promise.withResolvers<unknown>()

  harness.fetch
    .mockResolvedValueOnce({
      items: [firstItem],
      nextCursor: 'cursor-one'
    })
    .mockReturnValueOnce(pending.promise)

  const fixture = setup()

  await vi.waitFor(() => {
    expect(fixture.releases.items.value).toStrictEqual([firstItem])
  })

  void fixture.releases.loadMore()

  const pendingSignal = harness.fetch.mock.calls[1]?.[1].signal

  changeInput(fixture)
  expect(pendingSignal?.aborted).toBe(true)
  expect(fixture.releases.items.value).toStrictEqual([])

  pending.resolve({
    items: [secondItem],
    nextCursor: null
  })

  await vi.waitFor(() => {
    expect(harness.fetch).toHaveBeenCalledTimes(expectedRequestCount)
  })

  expect(fixture.releases.items.value).toStrictEqual([])
}

describe('upcoming releases request lifecycle', () => {
  beforeEach(() => {
    harness.fetch.mockReset()
  })

  afterEach(() => {
    for (const scope of scopes.splice(0)) {
      scope.stop()
    }

    vi.restoreAllMocks()
  })

  it('accumulates cursor pages in order without duplicate releases', async () => {
    harness.fetch
      .mockResolvedValueOnce({
        items: [firstItem],
        nextCursor: 'cursor-one'
      })
      .mockResolvedValueOnce({
        items: [firstItem, secondItem],
        nextCursor: null
      })

    const { releases } = setup()

    await vi.waitFor(() => {
      expect(releases.items.value).toStrictEqual([firstItem])
    })

    const result = await releases.loadMore()

    expect(result).toStrictEqual({
      addedItems: [secondItem],
      status: 'loaded'
    })

    expect(releases.items.value).toStrictEqual([firstItem, secondItem])
    expect(releases.hasMore.value).toBe(false)
    expect(harness.fetch.mock.calls[0]?.[1].query).toStrictEqual({ from: '2026-09-16' })

    expect(harness.fetch.mock.calls[1]?.[1].query).toStrictEqual({
      cursor: 'cursor-one',
      from: '2026-09-16'
    })
  })

  it('shares one active load-more request between parallel callers', async () => {
    const pending = Promise.withResolvers<unknown>()

    harness.fetch
      .mockResolvedValueOnce({
        items: [firstItem],
        nextCursor: 'cursor-one'
      })
      .mockReturnValueOnce(pending.promise)

    const { releases } = setup()

    await vi.waitFor(() => {
      expect(releases.items.value).toHaveLength(1)
    })

    const firstLoad = releases.loadMore()
    const secondLoad = releases.loadMore()

    expect(harness.fetch).toHaveBeenCalledTimes(2)

    pending.resolve({
      items: [secondItem],
      nextCursor: null
    })

    await expect(Promise.all([firstLoad, secondLoad])).resolves.toStrictEqual([
      {
        addedItems: [secondItem],
        status: 'loaded'
      },
      {
        addedItems: [secondItem],
        status: 'loaded'
      }
    ])
  })

  it('keeps loaded items and retries a failed page with the same cursor', async () => {
    const requestLog = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {
      // The expected transport failure is asserted through state below.
    })

    harness.fetch
      .mockResolvedValueOnce({
        items: [firstItem],
        nextCursor: 'cursor-one'
      })
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({
        items: [secondItem],
        nextCursor: null
      })

    const { releases } = setup()

    await vi.waitFor(() => {
      expect(releases.items.value).toStrictEqual([firstItem])
    })

    await releases.loadMore()
    expect(releases.hasLoadMoreError.value).toBe(true)
    expect(releases.items.value).toStrictEqual([firstItem])
    await releases.loadMore()
    expect(harness.fetch.mock.calls[1]?.[1].query.cursor).toBe('cursor-one')
    expect(harness.fetch.mock.calls[2]?.[1].query.cursor).toBe('cursor-one')
    expect(releases.items.value).toStrictEqual([firstItem, secondItem])
    expect(requestLog).toHaveBeenCalledTimes(1)
  })

  it('aborts and clears private items when the account changes', async () => {
    expect.hasAssertions()

    await expectPendingRequestCleared((fixture) => {
      fixture.accountId.value = null
    }, 2)
  })

  it('aborts and clears private items when the mode changes', async () => {
    expect.hasAssertions()

    await expectPendingRequestCleared((fixture) => {
      fixture.active.value = false
    }, 2)
  })

  it('aborts and clears private items when the local date changes', async () => {
    expect.hasAssertions()

    await expectPendingRequestCleared((fixture) => {
      fixture.from.value = '2026-09-17'
    }, 3)
  })

  it('ignores a late unauthorized result from the previous account', async () => {
    const stale = Promise.withResolvers<unknown>()

    harness.fetch
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce({
        items: [secondItem],
        nextCursor: null
      })

    const { accountId, releases } = setup()

    accountId.value = 'user-two'

    await vi.waitFor(() => {
      expect(releases.items.value).toStrictEqual([secondItem])
    })

    stale.reject({ statusCode: 401 })
    await expect(stale.promise).rejects.toMatchObject({ statusCode: 401 })
    expect(releases.unauthorized.value).toBe(false)
  })
})
