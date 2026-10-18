import { describe, expect, it } from 'vitest'
import { shallowRef } from 'vue'
import type { CatalogViewing } from '@tv/shared/catalog-viewings'
import { harness, id, setup, summary, viewing } from '../../testing/catalog-viewings-harness.ts'

const { useCatalogEpisodeWatches } = await import('../use-catalog-episode-watches.ts')
const { useCatalogEpisodeRatings } = await import('../use-catalog-episode-ratings.ts')
const { useCatalogRating } = await import('../use-catalog-rating.ts')
const episodeId = '30000000-0000-7000-8000-000000000001'

const current: CatalogViewing = {
  ...viewing,
  status: 'watching',
  startedOn: '2026-10-17',
  completedOn: null
}

const past: CatalogViewing = {
  ...current,
  id: '01991a00-0000-7000-8000-000000000099',
  status: 'completed',
  startedOn: '2026-10-01',
  completedOn: '2026-10-10'
}

const page = {
  items: [current, past],
  summary,
  nextCursor: null
}

function setupChildren() {
  const owner = setup(false, 'series')

  const target = shallowRef({
    catalogItemId: id,
    seasonNumber: 1
  })

  const children = owner.scope.run(() => {
    const watches = useCatalogEpisodeWatches(owner.item, owner.account, {
      automaticLoad: false,
      timeZone: shallowRef('Europe/Tallinn'),
      viewings: owner.state
    })

    const rating = useCatalogRating(target, owner.account, owner.state)

    const episodes = useCatalogEpisodeRatings({
      season: target.value,
      episodeIds: [episodeId],
      accountId: owner.account,
      viewings: owner.state
    })

    return {
      watches,
      rating,
      episodes
    }
  })

  if (children === undefined) { throw new Error('Missing child scope') }

  return {
    ...owner,
    ...children
  }
}

function childResponses(selected: CatalogViewing) {
  const mark = {
    id: '30000000-0000-7000-8000-000000000002',
    catalogEpisodeId: episodeId,
    viewingId: selected.id,
    markedAt: '2026-10-17T12:00:00.000000Z'
  }

  return [{
    watches: [mark],
    viewing: selected,
    summary
  }, {
    score: 7,
    viewing: selected,
    summary
  }, {
    items: [{
      episodeId,
      score: 8
    }],

    viewing: selected,
    summary
  }]
}

describe('shared viewing recovery for child controls', () => {
  it('blocks watched, season and episode actions until failed viewing history is recovered', async () => {
    const [marks, seasonRating, episodeRatings] = childResponses(current)

    harness.fetch.mockRejectedValueOnce({ statusCode: 500 }).mockResolvedValueOnce(marks).mockResolvedValueOnce(seasonRating).mockResolvedValueOnce(episodeRatings)

    const { account, state, watches, rating, episodes } = setupChildren()

    await state.load()
    await watches.load()
    await rating.load()
    await episodes.loadBatch()
    expect(watches.status.value).toBe('loaded')
    expect(rating.status.value).toBe('loaded')
    expect(episodes.ratingFor(episodeId).status).toBe('loaded')
    expect(state.isMutationBlocked(`episode:${episodeId}`)).toBe(true)
    expect(state.isMutationBlocked('all')).toBe(true)
    expect(state.isMutationBlocked('season:1')).toBe(true)
    expect(rating.isBlocked.value).toBe(true)
    expect(episodes.isBlocked(episodeId)).toBe(true)
    expect(state.readError.value).toContain('Try again')
    harness.fetch.mockResolvedValueOnce(page)
    await expect(state.load()).resolves.toBe(true)
    expect(state.isMutationBlocked(`episode:${episodeId}`)).toBe(false)
    expect(rating.isBlocked.value).toBe(false)
    expect(episodes.isBlocked(episodeId)).toBe(false)
    expect(state.readError.value).toBe('')

    account.value = null

    expect(state.status.value).toBe('idle')
    expect(state.isMutationBlocked(`episode:${episodeId}`)).toBe(false)
    expect(rating.isBlocked.value).toBe(false)
    expect(episodes.isBlocked(episodeId)).toBe(false)
  })

  it('clears historical marks and scores after an exact deletion retry confirms absence', async () => {
    const [marks, seasonRating, episodeRatings] = childResponses(past)

    const recoveredSummary = {
      ...summary,
      completedCount: 0,
      contextVersion: 2
    }

    harness.fetch.mockResolvedValueOnce(page).mockResolvedValueOnce(marks).mockResolvedValueOnce(seasonRating).mockResolvedValueOnce(episodeRatings).mockRejectedValueOnce(new Error('Lost deletion answer')).mockRejectedValueOnce({ statusCode: 409 }).mockResolvedValueOnce({
      items: [current],
      summary: recoveredSummary,
      nextCursor: null
    }).mockRejectedValueOnce({ statusCode: 404 })

    const { state, watches, rating, episodes } = setupChildren()

    await state.load()
    state.select(past)
    await watches.load()
    await rating.load()
    await episodes.loadBatch()
    expect(watches.watchedCount.value).toBe(1)
    expect(rating.score.value).toBe(7)
    expect(episodes.ratingFor(episodeId).score).toBe(8)
    await expect(state.remove(past)).resolves.toBe(false)

    const original = harness.fetch.mock.calls[4]?.[1].body

    await expect(state.retryMutation()).resolves.toBe(false)
    expect(harness.fetch.mock.calls[5]?.[1].body).toStrictEqual(original)
    expect(state.selectedViewingId.value).toBeNull()
    expect(watches.watchedCount.value).toBe(0)
    expect(rating.score.value).toBeNull()
    expect(episodes.ratingFor(episodeId).score).toBeNull()
    expect(state.pendingMutation.value).toBeNull()
  })
})
