import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readRatingSnapshot, setCurrentCatalogRating } from '../../rating-mutations.ts'
import { findCatalogItemRatingSummary } from '../../ratings-repository.ts'
import { createViewing, deleteViewing, findViewing } from '../../viewings-repository.ts'
import { ratingFixture, titleTarget, requireRatingViewing } from '../../../testing/rating-fixtures.ts'

const fixture = ratingFixture()

async function rewatch() {
  const rated = await fixture.save(fixture.movieId, titleTarget, 7)
  const first = requireRatingViewing(rated)
  const rewatchRequestId = randomUUID()

  const next = await createViewing(fixture.database, {
    userId: fixture.userId,
    catalogItemId: fixture.movieId
  }, {
    requestId: rewatchRequestId,
    mode: 'current',
    currentViewingId: first.id,
    contextVersion: rated.summary.contextVersion,
    status: 'completed',
    startedOn: null,
    completedOn: '2026-02-15'
  })

  return {
    first,
    next
  }
}

describe('retained public vote removal', () => {
  beforeAll(fixture.setup)
  beforeEach(fixture.reset)

  afterAll(async () => {
    await fixture.cleanup()
  })

  it('removes a retained public vote from an unrated current rewatch without changing the source score', async () => {
    const { first, next } = await rewatch()

    const owner = {
      userId: fixture.userId,
      catalogItemId: fixture.movieId
    }

    const input = await fixture.input(fixture.movieId, null)
    const removed = await setCurrentCatalogRating(fixture.database, owner, titleTarget, input)
    const replay = await setCurrentCatalogRating(fixture.database, owner, titleTarget, input)
    const historical = await findViewing(fixture.database, owner, first.id)

    expect(removed.score).toBeNull()
    expect(removed.viewing).toStrictEqual(next.viewing)
    expect(removed.summary.currentVoteScore).toBeNull()
    expect(removed.summary.contextVersion).toBe(input.contextVersion + 1)
    expect(replay).toStrictEqual(removed)
    expect(historical).toStrictEqual(first)

    await expect(findCatalogItemRatingSummary(fixture.database, fixture.movieId)).resolves.toStrictEqual({
      averageScore: null,
      ratingCount: 0
    })

    const staleRequestId = randomUUID()

    await expect(setCurrentCatalogRating(fixture.database, owner, titleTarget, {
      ...input,
      requestId: staleRequestId
    })).rejects.toMatchObject({ status: 409 })

    const rated = await fixture.save(fixture.movieId, titleTarget, 9)
    const lateReplay = await setCurrentCatalogRating(fixture.database, owner, titleTarget, input)

    expect(lateReplay.score).toBe(9)
    expect(lateReplay.summary).toStrictEqual(rated.summary)
    await expect(findViewing(fixture.database, owner, first.id)).resolves.toStrictEqual(first)

    await expect(findCatalogItemRatingSummary(fixture.database, fixture.movieId)).resolves.toStrictEqual({
      averageScore: 9,
      ratingCount: 1
    })
  })

  it('removes a retained public vote with no current viewing and safely replays after a later first rating', async () => {
    const { first, next } = await rewatch()

    const owner = {
      userId: fixture.userId,
      catalogItemId: fixture.movieId
    }

    const stale = await fixture.input(fixture.movieId, null)
    const deletionRequestId = randomUUID()

    const deleted = await deleteViewing(fixture.database, {
      userId: fixture.userId,
      catalogItemId: fixture.movieId,
      viewingId: next.viewing.id
    }, {
      requestId: deletionRequestId,
      revision: next.viewing.revision
    })

    expect(deleted.currentViewingId).toBeNull()
    expect(deleted.currentVoteScore).toBe(7)
    await expect(setCurrentCatalogRating(fixture.database, owner, titleTarget, stale)).rejects.toMatchObject({ status: 409 })

    const input = await fixture.input(fixture.movieId, null)
    const removed = await setCurrentCatalogRating(fixture.database, owner, titleTarget, input)
    const replay = await setCurrentCatalogRating(fixture.database, owner, titleTarget, input)
    const viewings = await fixture.client.query('SELECT id FROM catalog_viewings WHERE user_id = $1', [fixture.userId])
    const ratings = await fixture.client.query('SELECT viewing_id, score FROM catalog_item_ratings WHERE user_id = $1', [fixture.userId])

    expect(removed.score).toBeNull()
    expect(removed.viewing).toBeNull()
    expect(removed.summary.currentVoteScore).toBeNull()
    expect(removed.summary.contextVersion).toBe(input.contextVersion + 1)
    expect(replay).toStrictEqual(removed)
    expect(viewings.rows).toStrictEqual([{ id: first.id }])

    expect(ratings.rows).toStrictEqual([{
      viewing_id: first.id,
      score: 7
    }])

    await expect(findCatalogItemRatingSummary(fixture.database, fixture.movieId)).resolves.toStrictEqual({
      averageScore: null,
      ratingCount: 0
    })

    const staleRequestId = randomUUID()

    await expect(setCurrentCatalogRating(fixture.database, owner, titleTarget, {
      ...input,
      requestId: staleRequestId
    })).rejects.toMatchObject({ status: 409 })

    const rated = await fixture.save(fixture.movieId, titleTarget, 9)
    const lateReplay = await setCurrentCatalogRating(fixture.database, owner, titleTarget, input)
    const current = await readRatingSnapshot(fixture.database, owner, titleTarget)

    expect(lateReplay.score).toBeNull()
    expect(lateReplay.viewing).toBeNull()
    expect(lateReplay.summary).toStrictEqual(rated.summary)
    expect(current).toStrictEqual(rated)
    await expect(findViewing(fixture.database, owner, first.id)).resolves.toStrictEqual(first)
  })

})
