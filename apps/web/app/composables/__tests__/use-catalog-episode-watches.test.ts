import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import type { CatalogViewing } from '@tv/shared/catalog-viewings'
import { empty, harness, id, setup, summary, viewing } from '../../testing/catalog-viewings-harness.ts'

const requestIdPattern: unknown = expect.any(String)
const { useCatalogEpisodeWatches } = await import('../use-catalog-episode-watches.ts')
const episodeId = '30000000-0000-7000-8000-000000000001'

const series: CatalogViewing = {
  ...viewing,
  status: 'watching',
  startedOn: '2026-10-17',
  completedOn: null
}

const mark = {
  id: '30000000-0000-7000-8000-000000000002',
  catalogEpisodeId: episodeId,
  viewingId: series.id,
  markedAt: '2026-10-17T12:00:00.000000Z'
}

const page = {
  items: [series],
  summary,
  nextCursor: null
}

function response(watched = false) {
  return {
    watches: watched ? [mark] : [],
    viewing: series,
    summary
  }
}
function setupWatches(current = setup(), automaticLoad = false) {
  const watches = current.scope.run(() => useCatalogEpisodeWatches(current.item, current.account, {
    viewings: current.state,
    timeZone: shallowRef('Europe/Tallinn'),
    automaticLoad
  }))

  if (watches === undefined) { throw new Error('Watches scope did not start') }

  return {
    ...current,
    watches
  }
}

describe('viewing-aware episode marks', () => {
  it('keeps counters unchanged until confirmation and shares the title write lock', async () => {
    const pending = Promise.withResolvers<unknown>()

    harness.fetch.mockResolvedValueOnce(page).mockResolvedValueOnce(response()).mockReturnValueOnce(pending.promise)

    const { state, watches } = setupWatches()

    await state.load()
    await watches.load()

    const saved = watches.toggle(episodeId)

    expect(watches.watchedCount.value).toBe(0)
    await expect(watches.markReleased(null)).resolves.toBe(false)
    await expect(state.saveCurrentScore(8)).resolves.toBe(false)
    pending.resolve(response(true))
    await expect(saved).resolves.toBe(true)
    expect(watches.watchedEpisodeIds.value).toStrictEqual([episodeId])
  })

  it('blocks private refreshes while retrying the original uncertain PUT', async () => {
    harness.fetch.mockResolvedValueOnce(page).mockResolvedValueOnce(response()).mockRejectedValueOnce(new Error('Lost mark response')).mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response(true))

    const { state, watches } = setupWatches()

    await state.load()
    await watches.load()
    await expect(watches.toggle(episodeId)).resolves.toBe(false)

    const original = harness.fetch.mock.calls[2]?.[1].body

    await expect(watches.load()).resolves.toBe(false)
    expect(harness.fetch).toHaveBeenCalledTimes(3)
    await expect(watches.toggle(episodeId)).resolves.toBe(true)

    expect(harness.fetch.mock.calls[3]?.[1]).toMatchObject({
      method: 'PUT',
      body: original
    })

    expect(watches.watchedCount.value).toBe(1)
  })

  it('requires confirmation before removing a rated episode and sends the exact watch identity', async () => {
    harness.fetch.mockResolvedValueOnce(page).mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response())

    const { state, watches } = setupWatches()

    await state.load()
    await watches.load()
    await expect(watches.toggle(episodeId, true)).resolves.toBe(false)
    expect(watches.confirmationEpisodeId.value).toBe(episodeId)
    expect(harness.fetch).toHaveBeenCalledTimes(2)
    await expect(watches.confirmUnwatch()).resolves.toBe(true)

    expect(harness.fetch.mock.calls[2]?.[1]).toMatchObject({
      method: 'DELETE',

      body: {
        requestId: requestIdPattern,
        watchId: mark.id,
        currentViewingId: series.id,
        contextVersion: 1,
        confirmRatingRemoval: true
      }
    })

    expect(watches.watchedCount.value).toBe(0)
    expect(watches.confirmationEpisodeId.value).toBeNull()
  })

  it('keeps marks when confirmation is canceled and makes historical mark controls read-only', async () => {
    harness.fetch.mockResolvedValueOnce(page).mockResolvedValueOnce(response(true))

    const { state, watches } = setupWatches()

    await state.load()
    await watches.load()
    await watches.toggle(episodeId, true)
    watches.cancelUnwatch()
    expect(watches.watchedCount.value).toBe(1)

    const past = {
      ...series,
      id: '01991a00-0000-7000-8000-000000000099'
    }

    state.select(past)

    harness.fetch.mockResolvedValueOnce({
      ...response(true),
      viewing: past
    })

    await watches.load()
    await expect(watches.toggle(episodeId)).resolves.toBe(false)
    await expect(watches.markReleased(1)).resolves.toBe(false)
    expect(harness.fetch).toHaveBeenCalledTimes(3)
    expect(harness.fetch.mock.calls[2]?.[1]).toMatchObject({ query: { viewingId: past.id } })
  })

  it('keeps confirmation and avoids another read when an equal summary is confirmed with a shallow time zone', async () => {
    harness.fetch.mockResolvedValueOnce(page).mockResolvedValueOnce(response(true))

    const current = setup(false, 'series')

    await current.state.load()

    const { watches } = setupWatches(current, true)

    await vi.waitFor(() => { expect(watches.status.value).toBe('loaded') })
    await expect(watches.toggle(episodeId, true)).resolves.toBe(false)
    expect(watches.confirmationEpisodeId.value).toBe(episodeId)

    const repeated = response(true)

    current.state.applyConfirmed(repeated)
    expect(harness.fetch).toHaveBeenCalledTimes(2)
    expect(watches.confirmationEpisodeId.value).toBe(episodeId)
    expect(watches.watchedCount.value).toBe(1)

    const past = {
      ...series,
      id: '01991a00-0000-7000-8000-000000000099'
    }

    const historicalResponse = {
      ...repeated,
      viewing: past
    }

    harness.fetch.mockResolvedValueOnce(historicalResponse).mockResolvedValueOnce(historicalResponse)
    current.state.select(past)
    expect(watches.confirmationEpisodeId.value).toBeNull()
    expect(watches.watchedCount.value).toBe(0)
    await vi.waitFor(() => { expect(watches.status.value).toBe('loaded') })
    expect(harness.fetch.mock.lastCall?.[1]).toMatchObject({ query: { viewingId: past.id } })
  })

  it('uses local calendar date and confirmed context for a first bulk mark', async () => {
    const noViewing = {
      watches: [],
      viewing: null,
      summary: empty.summary
    }

    harness.fetch.mockResolvedValueOnce(empty).mockResolvedValueOnce(noViewing).mockResolvedValueOnce(response(true))

    const { state, watches } = setupWatches()

    await state.load()
    await watches.load()
    await expect(watches.markReleased(1)).resolves.toBe(true)
    expect(harness.fetch.mock.calls[2]?.[0]).toBe(`/api/catalog/items/${id}/seasons/1/watched`)

    expect(harness.fetch.mock.calls[2]?.[1].body).toMatchObject({
      requestId: requestIdPattern,
      viewingDate: '2026-10-17',
      timeZone: 'Europe/Tallinn',
      currentViewingId: null,
      contextVersion: 0
    })

    expect(state.summary.value.currentViewingId).toBe(series.id)
  })

  it('clears private marks and ignores an old account response', async () => {
    const old = Promise.withResolvers<unknown>()

    harness.fetch.mockResolvedValueOnce(page).mockResolvedValueOnce(response(true)).mockReturnValueOnce(old.promise)

    const { state, watches, account } = setupWatches()

    await state.load()
    await watches.load()
    await expect(watches.toggle(episodeId, true)).resolves.toBe(false)
    expect(watches.confirmationEpisodeId.value).toBe(episodeId)

    const saving = watches.toggle(episodeId)
    const signal = harness.fetch.mock.calls[2]?.[1].signal

    account.value = 'another-account'

    old.resolve(response())
    await expect(saving).resolves.toBe(false)
    expect(signal?.aborted).toBe(true)
    expect(watches.watchedCount.value).toBe(0)
    expect(watches.saveErrorFor(episodeId)).toBe('')
    expect(watches.confirmationEpisodeId.value).toBeNull()
  })
})
