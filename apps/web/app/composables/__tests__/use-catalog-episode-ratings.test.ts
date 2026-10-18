import { describe, expect, it } from 'vitest'
import type { CatalogViewing } from '@tv/shared/catalog-viewings'
import { empty, emptySummary, harness, id, setup, summary, viewing } from '../../testing/catalog-viewings-harness.ts'

const requestIdPattern: unknown = expect.any(String)
const { useCatalogEpisodeRatings } = await import('../use-catalog-episode-ratings.ts')
const firstId = '30000000-0000-7000-8000-000000000001'
const secondId = '30000000-0000-7000-8000-000000000002'

const series: CatalogViewing = {
  ...viewing,
  status: 'watching',
  startedOn: '2026-10-17',
  completedOn: null
}

const page = {
  items: [series],
  summary,
  nextCursor: null
}

const initial = {
  items: [{
    episodeId: firstId,
    score: 4
  }, {
    episodeId: secondId,
    score: null
  }],

  viewing: series,
  summary
}

const mark = {
  id: '30000000-0000-7000-8000-000000000003',
  catalogEpisodeId: firstId,
  viewingId: series.id,
  markedAt: '2026-10-17T12:00:00.000000Z'
}

function response(score: number | null) {
  return {
    score,
    viewing: series,
    summary,
    watches: [mark]
  }
}
function setupRatings() {
  const current = setup()

  const season = {
    catalogItemId: id,
    seasonNumber: 1
  }

  const ratings = current.scope.run(() => useCatalogEpisodeRatings({
    season,
    episodeIds: [firstId, secondId],
    accountId: current.account,
    viewings: current.state
  }))

  if (ratings === undefined) { throw new Error('Episode ratings scope did not start') }

  return {
    ...current,
    ratings
  }
}

describe('viewing-aware private episode ratings', () => {
  it('applies confirmed score and mark together while serializing other title writes', async () => {
    const pending = Promise.withResolvers<unknown>()

    harness.fetch.mockResolvedValueOnce(page).mockResolvedValueOnce(initial).mockReturnValueOnce(pending.promise)

    const { state, ratings } = setupRatings()

    await state.load()
    await ratings.loadBatch()

    const saved = ratings.save(firstId, 9)

    expect(ratings.ratingFor(firstId).score).toBe(4)
    expect(ratings.hasUnconfirmedMutation(firstId)).toBe(false)
    expect(ratings.isBlocked(secondId)).toBe(true)
    await expect(ratings.save(secondId, 7)).resolves.toBe(false)
    await expect(state.create('current')).resolves.toBe(false)
    pending.resolve(response(9))
    await expect(saved).resolves.toBe(true)
    expect(ratings.ratingFor(firstId).score).toBe(9)
    expect(state.confirmedWatches.value).toStrictEqual([mark])

    expect(harness.fetch.mock.calls[2]?.[1].body).toMatchObject({
      requestId: requestIdPattern,
      currentViewingId: series.id,
      contextVersion: 1,
      score: 9,
      timeZone: 'Europe/Tallinn'
    })
  })

  it('reads historical scores with their viewing context and uses the selected revision for saves', async () => {
    harness.fetch.mockResolvedValueOnce(page)

    const { state, ratings } = setupRatings()

    await state.load()

    const past = {
      ...series,
      id: '01991a00-0000-7000-8000-000000000099',
      revision: 4
    }

    state.select(past)

    harness.fetch.mockResolvedValueOnce({
      ...initial,
      viewing: past
    }).mockResolvedValueOnce({
      ...response(8),

      viewing: {
        ...past,
        revision: 5
      }
    })

    await ratings.loadBatch()
    await expect(ratings.save(firstId, 8)).resolves.toBe(true)
    expect(harness.fetch.mock.calls[1]?.[1]).toMatchObject({ query: { viewingId: past.id } })
    expect(harness.fetch.mock.calls[2]?.[0]).toBe(`/api/catalog/items/${id}/viewings/${past.id}/episodes/${firstId}/rating`)

    expect(harness.fetch.mock.calls[2]?.[1].body).toMatchObject({
      revision: 4,
      requestId: requestIdPattern,
      score: 8
    })

    expect(state.summary.value.currentViewingId).toBe(series.id)
  })

  it('keeps a point recovery newer than an unfinished batch', async () => {
    const batch = Promise.withResolvers<unknown>()

    harness.fetch.mockResolvedValueOnce(page).mockReturnValueOnce(batch.promise).mockResolvedValueOnce(response(8))

    const { state, ratings } = setupRatings()

    await state.load()

    const loading = ratings.loadBatch()

    await ratings.load(firstId)
    batch.resolve(initial)

    await loading

    expect(ratings.ratingFor(firstId).score).toBe(8)
    expect(ratings.ratingFor(secondId).status).toBe('loaded')
  })

  it('preserves confirmed scores and the immutable request after a lost response', async () => {
    const error = new Error('private transport details')

    harness.fetch.mockResolvedValueOnce(page).mockResolvedValueOnce(initial).mockRejectedValueOnce(error).mockResolvedValueOnce(response(8))

    const { state, ratings } = setupRatings()

    await state.load()
    await ratings.loadBatch()
    await expect(ratings.save(firstId, 8)).resolves.toBe(false)

    const original = harness.fetch.mock.calls[2]?.[1].body

    expect(ratings.ratingFor(firstId).score).toBe(4)
    expect(ratings.ratingFor(firstId).saveError).not.toContain('private transport details')
    expect(ratings.hasUnconfirmedMutation(firstId)).toBe(true)
    expect(ratings.isBlocked(firstId)).toBe(false)
    expect(ratings.isBlocked(secondId)).toBe(true)
    await expect(ratings.save(firstId, 8)).resolves.toBe(true)
    expect(harness.fetch.mock.calls[3]?.[1].body).toStrictEqual(original)
    expect(ratings.ratingFor(firstId).score).toBe(8)
  })

  it.each([
    {
      statusCode: 409,
      message: 'Your viewing changed. Refresh your viewings and try again.'
    },
    {
      statusCode: 404,
      message: 'We couldn’t save this change. Check the details and try again.'
    }
  ])('replaces uncertainty with the definitive $statusCode retry error for the affected episode', async ({ statusCode, message }) => {
    harness.fetch.mockResolvedValueOnce(page).mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error('Lost rating answer')).mockRejectedValueOnce({ statusCode })

    const { state, ratings } = setupRatings()

    await state.load()
    await ratings.loadBatch()
    await expect(ratings.save(firstId, 8)).resolves.toBe(false)

    const original = harness.fetch.mock.calls[2]?.[1].body

    expect(ratings.ratingFor(firstId).saveError).toContain('confirm')
    await expect(ratings.retryMutation()).resolves.toBe(false)
    expect(harness.fetch.mock.calls[3]?.[1].body).toStrictEqual(original)
    expect(ratings.ratingFor(firstId).saveError).toBe(message)
    expect(ratings.ratingFor(secondId).saveError).toBe('')
    expect(ratings.ratingFor(firstId).score).toBe(4)
    expect(ratings.hasUnconfirmedMutation(firstId)).toBe(false)
    expect(state.pendingMutation.value).toBeNull()
  })

  it('clears uncertainty after a confirmed retry and refreshes the confirmed episode scores', async () => {
    const confirmed = {
      ...initial,

      items: [{
        episodeId: firstId,
        score: 8
      }, {
        episodeId: secondId,
        score: null
      }]
    }

    harness.fetch.mockResolvedValueOnce(page).mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error('Lost rating answer')).mockResolvedValueOnce(response(8)).mockResolvedValueOnce(confirmed)

    const { state, ratings } = setupRatings()

    await state.load()
    await ratings.loadBatch()
    await expect(ratings.save(firstId, 8)).resolves.toBe(false)
    await expect(ratings.retryMutation()).resolves.toBe(true)
    expect(ratings.ratingFor(firstId).score).toBe(8)
    expect(ratings.ratingFor(firstId).saveError).toBe('')
    expect(ratings.hasUnconfirmedMutation(firstId)).toBe(false)
  })

  it('confirms a first episode rating retry when its own response creates the current viewing', async () => {
    const noViewing = {
      items: [{
        episodeId: firstId,
        score: null
      }, {
        episodeId: secondId,
        score: null
      }],

      viewing: null,
      summary: emptySummary
    }

    const confirmed = {
      ...initial,

      items: [{
        episodeId: firstId,
        score: 8
      }, {
        episodeId: secondId,
        score: null
      }]
    }

    harness.fetch.mockResolvedValueOnce(empty).mockResolvedValueOnce(noViewing).mockRejectedValueOnce(new Error('Lost first rating answer')).mockResolvedValueOnce(response(8)).mockResolvedValueOnce(page).mockResolvedValueOnce(confirmed)

    const { state, ratings } = setupRatings()

    await state.load()
    await ratings.loadBatch()
    await expect(ratings.save(firstId, 8, '2026-10-17')).resolves.toBe(false)

    const original = harness.fetch.mock.calls[2]?.[1].body

    await expect(ratings.retryMutation()).resolves.toBe(true)
    expect(harness.fetch.mock.calls[3]?.[1].body).toStrictEqual(original)

    expect(original).toMatchObject({
      currentViewingId: null,
      contextVersion: 0,
      viewingDate: '2026-10-17'
    })

    expect(state.summary.value.currentViewingId).toBe(series.id)
    expect(ratings.ratingFor(firstId).score).toBe(8)
    expect(ratings.ratingFor(firstId).saveError).toBe('')
  })

  it('ignores a definitive retry error after the account changes', async () => {
    const pending = Promise.withResolvers<unknown>()

    harness.fetch.mockResolvedValueOnce(page).mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error('Lost rating answer')).mockReturnValueOnce(pending.promise)

    const { state, ratings, account } = setupRatings()

    await state.load()
    await ratings.loadBatch()
    await ratings.save(firstId, 8)

    const retried = ratings.retryMutation()

    account.value = 'another-account'

    pending.reject({ statusCode: 409 })
    await expect(retried).resolves.toBe(false)
    expect(ratings.ratingFor(firstId).saveError).toBe('')
    expect(ratings.ratingFor(firstId).score).toBeNull()
    expect(ratings.unauthorized.value).toBeNull()
  })

  it.each([
    { items: [] },
    { items: [{
      episodeId: firstId,
      score: 5
    }, {
      episodeId: firstId,
      score: 5
    }] },
    { items: [{
      episodeId: firstId,
      score: 11
    }, {
      episodeId: secondId,
      score: null
    }] }
  ])('rejects incomplete or malformed batches while preserving point recovery: %j', async malformed => {
    harness.fetch.mockResolvedValueOnce(page).mockResolvedValueOnce({
      ...malformed,
      viewing: series,
      summary
    }).mockResolvedValueOnce(response(6))

    const { state, ratings } = setupRatings()

    await state.load()
    await ratings.loadBatch()
    expect(ratings.batchError.value).toBe(true)
    expect(ratings.ratingFor(firstId).status).toBe('error')
    await ratings.load(firstId)
    expect(ratings.ratingFor(firstId).score).toBe(6)
    expect(ratings.ratingFor(secondId).status).toBe('error')
  })

  it('aborts old-account operations and does not apply their late scores', async () => {
    const old = Promise.withResolvers<unknown>()

    harness.fetch.mockResolvedValueOnce(page).mockResolvedValueOnce(initial).mockReturnValueOnce(old.promise)

    const { state, account, ratings } = setupRatings()

    await state.load()
    await ratings.loadBatch()

    const saved = ratings.save(firstId, 9)
    const signal = harness.fetch.mock.calls[2]?.[1].signal

    account.value = 'another-account'

    old.resolve(response(9))
    await expect(saved).resolves.toBe(false)
    expect(signal?.aborted).toBe(true)
    expect(ratings.ratingFor(firstId).score).toBeNull()
    expect(ratings.ratingFor(firstId).status).toBe('idle')
    expect(ratings.ratingFor(firstId).saveError).toBe('')
  })
})
