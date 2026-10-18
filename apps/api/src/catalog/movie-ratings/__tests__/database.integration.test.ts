import { randomUUID } from 'node:crypto'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { env } from 'node:process'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readRatingSnapshot, setCurrentCatalogRating, setHistoricalCatalogRating } from '../../rating-mutations.ts'
import { findCatalogItemRatingSummary } from '../../ratings-repository.ts'
import { createViewing, deleteViewing } from '../../viewings-repository.ts'

// oxlint-disable-next-line import/no-namespace -- Intercept the shared read boundary to control the concurrent snapshot correction.
import * as viewingRepository from '../../viewings-repository.ts'
import { ratingFixture, titleTarget, requireRatingViewing } from '../../../testing/rating-fixtures.ts'

const fixture = ratingFixture()

async function rewatch() {
  const first = await fixture.save(fixture.movieId, titleTarget, 7)
  const rewatchRequestId = randomUUID()

  const next = await createViewing(fixture.database, {
    userId: fixture.userId,
    catalogItemId: fixture.movieId
  }, {
    requestId: rewatchRequestId,
    mode: 'current',
    currentViewingId: first.summary.currentViewingId,
    contextVersion: first.summary.contextVersion,
    status: 'completed',
    startedOn: null,
    completedOn: '2026-02-15'
  })

  if (first.viewing === null) { throw new Error('First rated viewing is missing') }

  return {
    first: first.viewing,
    next
  }
}

describe('movie rating context and retries', () => {
  beforeAll(fixture.setup)
  beforeEach(fixture.reset)

  afterAll(async () => {
    await fixture.cleanup()
  })

  it('keeps an old public vote during an empty rewatch and isolates historical corrections and removal', async () => {
    const { first, next } = await rewatch()

    const owner = {
      userId: fixture.userId,
      catalogItemId: fixture.movieId,
      viewingId: first.id
    }

    const historicalRatingRequestId = randomUUID()

    const historical = await setHistoricalCatalogRating(fixture.database, owner, titleTarget, {
      requestId: historicalRatingRequestId,
      revision: first.revision,
      timeZone: 'UTC',
      score: 2
    })

    expect(next.viewing.score).toBeNull()
    expect(next.summary.currentVoteScore).toBe(7)
    expect(historical.score).toBe(2)
    expect(historical.summary.currentViewingId).toBe(next.viewing.id)
    expect(historical.summary.currentVoteScore).toBe(7)

    await expect(readRatingSnapshot(fixture.database, {
      userId: fixture.userId,
      catalogItemId: fixture.movieId
    }, titleTarget)).resolves.toMatchObject({ score: null })

    await expect(readRatingSnapshot(fixture.database, {
      userId: fixture.userId,
      catalogItemId: fixture.movieId
    }, titleTarget, first.id)).resolves.toMatchObject({ score: 2 })

    await expect(readRatingSnapshot(fixture.database, {
      userId: fixture.otherUserId,
      catalogItemId: fixture.movieId
    }, titleTarget, first.id)).rejects.toMatchObject({ status: 404 })

    const removalRequestId = randomUUID()

    const removed = await setHistoricalCatalogRating(fixture.database, owner, titleTarget, {
      requestId: removalRequestId,
      revision: requireRatingViewing(historical).revision,
      timeZone: 'UTC',
      score: null
    })

    expect(removed.score).toBeNull()
    expect(removed.summary.currentVoteScore).toBe(7)

    await expect(findCatalogItemRatingSummary(fixture.database, fixture.movieId)).resolves.toStrictEqual({
      averageScore: 7,
      ratingCount: 1
    })

    const rated = await fixture.save(fixture.movieId, titleTarget, 9)

    expect(rated.summary.currentVoteScore).toBe(9)

    await expect(findCatalogItemRatingSummary(fixture.database, fixture.movieId)).resolves.toStrictEqual({
      averageScore: 9,
      ratingCount: 1
    })
  })

  it('preserves the original date on exact replay and rejects payload changes and removed-viewing replays', async () => {
    const owner = {
      userId: fixture.userId,
      catalogItemId: fixture.movieId
    }

    const input = await fixture.input(fixture.movieId, 8)
    const first = await setCurrentCatalogRating(fixture.database, owner, titleTarget, input)
    const replay = await setCurrentCatalogRating(fixture.database, owner, titleTarget, input)

    expect(replay).toStrictEqual(first)
    expect(replay.viewing?.completedOn).toBe('2026-01-15')

    await expect(setCurrentCatalogRating(fixture.database, owner, titleTarget, {
      ...input,
      viewingDate: '2026-01-16'
    })).rejects.toMatchObject({ status: 409 })

    const firstViewing = requireRatingViewing(first)
    const deletionRequestId = randomUUID()

    await deleteViewing(fixture.database, {
      userId: fixture.userId,
      catalogItemId: fixture.movieId,
      viewingId: firstViewing.id
    }, {
      requestId: deletionRequestId,
      revision: firstViewing.revision
    })

    await expect(setCurrentCatalogRating(fixture.database, owner, titleTarget, input)).rejects.toMatchObject({ status: 409 })

    const viewings = await fixture.client.query('SELECT id FROM catalog_viewings WHERE user_id = $1', [fixture.userId])

    expect(viewings.rows).toStrictEqual([])

    await expect(findCatalogItemRatingSummary(fixture.database, fixture.movieId)).resolves.toStrictEqual({
      averageScore: null,
      ratingCount: 0
    })
  })

  it('recovers the committed score after the caller loses the transaction response', async () => {
    const owner = {
      userId: fixture.userId,
      catalogItemId: fixture.movieId
    }

    const input = await fixture.input(fixture.movieId, 6)
    const original = fixture.database.transaction.bind(fixture.database)
    const responseFailure = new Error('The response was lost after commit')

    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Intercept the database transaction completion to model a lost committed response.
    const transaction = vi.spyOn(fixture.database, 'transaction').mockImplementationOnce(async callback => {
      await original(callback)

      throw responseFailure
    })

    try {
      await expect(setCurrentCatalogRating(fixture.database, owner, titleTarget, input)).rejects.toBe(responseFailure)
    } finally {
      transaction.mockRestore()
    }

    const recovered = await setCurrentCatalogRating(fixture.database, owner, titleTarget, input)
    const counts = await fixture.client.query('SELECT (SELECT count(*)::integer FROM catalog_viewings WHERE user_id = $1) AS viewings, (SELECT count(*)::integer FROM catalog_rating_votes WHERE user_id = $1) AS votes', [fixture.userId])

    expect(recovered.score).toBe(6)
    expect(recovered.viewing?.completedOn).toBe('2026-01-15')

    expect(counts.rows).toStrictEqual([{
      viewings: 1,
      votes: 1
    }])
  })

  it('serializes identical concurrent first saves and conflicts independent stale first saves', async () => {
    const owner = {
      userId: fixture.userId,
      catalogItemId: fixture.movieId
    }

    const input = await fixture.input(fixture.movieId, 8)
    const connection = new Client({ connectionString: env.TEST_DATABASE_URL })

    await connection.connect()

    try {
      const concurrentDatabase = createDatabase(connection)

      const results = await Promise.all([
        setCurrentCatalogRating(fixture.database, owner, titleTarget, input),
        setCurrentCatalogRating(concurrentDatabase, owner, titleTarget, input)
      ])

      expect(results[0].viewing?.id).toBe(results[1].viewing?.id)

      const staleRequestId = randomUUID()

      await expect(setCurrentCatalogRating(concurrentDatabase, owner, titleTarget, {
        ...input,
        requestId: staleRequestId,
        score: 3
      })).rejects.toMatchObject({ status: 409 })
    } finally {
      await connection.end()
    }

    const counts = await fixture.client.query('SELECT (SELECT count(*)::integer FROM catalog_viewings WHERE user_id = $1) AS viewings, (SELECT count(*)::integer FROM catalog_item_ratings WHERE user_id = $1) AS ratings', [fixture.userId])

    expect(counts.rows).toStrictEqual([{
      viewings: 1,
      ratings: 1
    }])
  })

  it('requires the selected historical revision and never treats the current viewing as history', async () => {
    const { first, next } = await rewatch()
    const historicalRatingRequestId = randomUUID()

    const input = {
      requestId: historicalRatingRequestId,
      revision: first.revision + 1,
      timeZone: 'UTC',
      score: 3
    }

    await expect(setHistoricalCatalogRating(fixture.database, {
      userId: fixture.userId,
      catalogItemId: fixture.movieId,
      viewingId: first.id
    }, titleTarget, input)).rejects.toMatchObject({ status: 409 })

    await expect(setHistoricalCatalogRating(fixture.database, {
      userId: fixture.userId,
      catalogItemId: fixture.movieId,
      viewingId: next.viewing.id
    }, titleTarget, {
      ...input,
      revision: next.viewing.revision
    })).rejects.toMatchObject({ status: 409 })
  })

  it('returns the score, viewing and current context from one snapshot during a concurrent correction', async () => {
    const first = await fixture.save(fixture.movieId, titleTarget, 7)

    const owner = {
      userId: fixture.userId,
      catalogItemId: fixture.movieId
    }

    const connection = new Client({ connectionString: env.TEST_DATABASE_URL })
    const readSummary = viewingRepository.readViewingSummary

    await connection.connect()

    const concurrentDatabase = createDatabase(connection)

    const summaryRead = vi.spyOn(viewingRepository, 'readViewingSummary').mockImplementationOnce(async (reader, selectedOwner) => {
      const summary = await readSummary(reader, selectedOwner)
      const ratingRequestId = randomUUID()

      await setCurrentCatalogRating(concurrentDatabase, owner, titleTarget, {
        requestId: ratingRequestId,
        currentViewingId: first.summary.currentViewingId,
        contextVersion: first.summary.contextVersion,
        timeZone: 'UTC',
        score: 9
      })

      return summary
    })

    try {
      const snapshot = await readRatingSnapshot(fixture.database, owner, titleTarget)

      expect(snapshot.score).toBe(7)
      expect(snapshot.viewing?.score).toBe(7)
      expect(snapshot.summary).toStrictEqual(first.summary)
    } finally {
      summaryRead.mockRestore()
      await connection.end()
    }

    await expect(readRatingSnapshot(fixture.database, {
      userId: fixture.userId,
      catalogItemId: fixture.movieId
    }, titleTarget)).resolves.toMatchObject({ score: 9 })
  })

  it('rolls a current score correction back when writing its public vote fails', async () => {
    const first = await fixture.save(fixture.movieId, titleTarget, 7)

    const owner = {
      userId: fixture.userId,
      catalogItemId: fixture.movieId
    }

    await fixture.client.query('CREATE FUNCTION pg_temp.reject_vote_correction() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION \'public vote failed\'; END; $$')
    await fixture.client.query('CREATE TRIGGER reject_vote_correction BEFORE UPDATE ON catalog_rating_votes FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_vote_correction()')

    try {
      await expect(fixture.save(fixture.movieId, titleTarget, 9)).rejects.toThrow('Failed query:')
    } finally {
      await fixture.client.query('DROP TRIGGER reject_vote_correction ON catalog_rating_votes')
    }

    const current = await readRatingSnapshot(fixture.database, owner, titleTarget)

    expect(current).toStrictEqual(first)

    await expect(findCatalogItemRatingSummary(fixture.database, fixture.movieId)).resolves.toStrictEqual({
      averageScore: 7,
      ratingCount: 1
    })
  })


})
