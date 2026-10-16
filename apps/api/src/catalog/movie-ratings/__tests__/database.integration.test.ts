/* oxlint-disable eslint/max-lines -- The fixture covers linked scores, current votes and their atomic concurrency contract together. */
import { randomUUID } from 'node:crypto'
import { env } from 'node:process'
import { createDatabase, type Database } from '@tv/database'
import { Client } from 'pg'
import { afterAll, assert, beforeEach, describe, expect, it } from 'vitest'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'
import { setCurrentMovieRating, setHistoricalMovieRating } from '../../movie-ratings-repository.ts'

import {
  createMovieViewing,
  deleteMovieViewing,
  findMovieViewings,
  readMovieViewingSummary
} from '../../movie-viewings-repository.ts'

import { findCatalogItemRating, findCatalogItemRatingSummary, setCatalogItemRating } from '../../ratings-repository.ts'

const client = new Client({ connectionString: env.TEST_DATABASE_URL })

await client.connect()

const database = createDatabase(client)
const userId = randomUUID()
const otherUserId = randomUUID()
const catalogItemId = randomUUID()
const otherMovieId = randomUUID()

const owner = {
  userId,
  catalogItemId
}

async function create(score?: number) {
  const summary = await readMovieViewingSummary(database, owner)

  const input = {
    mode: 'current',
    requestId: randomUUID(),
    contextVersion: summary.contextVersion,
    startedOn: null,
    completedOn: null,
    score
  } as const

  return createMovieViewing(database, owner, input)
}

async function rate(score: number | null) {
  const summary = await readMovieViewingSummary(database, owner)

  return setCurrentMovieRating(database, owner, {
    score,
    currentViewingId: summary.currentViewingId,
    contextVersion: summary.contextVersion
  })
}

async function ratings() {
  const result = await client.query<{ id: string; viewing_id: string | null; score: number }>(
    'SELECT id, viewing_id, score FROM catalog_item_ratings WHERE user_id = $1 AND catalog_item_id = $2 ORDER BY viewing_id NULLS FIRST', [userId, catalogItemId]
  )

  return result.rows
}

async function concurrent<Result>(run: (db: Database) => Promise<Result>): Promise<Result> {
  const connection = new Client({ connectionString: env.TEST_DATABASE_URL })

  try {
    await connection.connect()

    const db = createDatabase(connection)

    return await run(db)
  } finally {
    await connection.end()
  }
}

describe('movie viewing ratings', () => {
  beforeEach(async () => {
    await assertDisposableTestDatabase(client)
    await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId, otherUserId]])
    await client.query('DELETE FROM catalog_items WHERE id = ANY($1::uuid[])', [[catalogItemId, otherMovieId]])
    await client.query('INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)', [userId, `${userId}@example.com`, otherUserId, `${otherUserId}@example.com`])
    await client.query('INSERT INTO catalog_items (id, type) VALUES ($1, \'movie\'), ($2, \'movie\')', [catalogItemId, otherMovieId])
    await client.query('INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original) VALUES ($1, \'en\', \'Movie rating fixture\', true), ($2, \'en\', \'Other movie rating fixture\', true)', [catalogItemId, otherMovieId])
  })

  afterAll(async () => {
    await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId, otherUserId]])
    await client.query('DELETE FROM catalog_items WHERE id = ANY($1::uuid[])', [[catalogItemId, otherMovieId]])
    await client.end()
  })

  it('keeps existing votes unlinked and creates a viewing score even when the vote already matches', async () => {
    await setCatalogItemRating(database, userId, {
      catalogItemId,
      score: 8
    })

    const original = await ratings()
    const first = await create()

    expect(first.viewing.score).toBeNull()
    expect(first.summary.currentVoteScore).toBe(8)
    await rate(8)

    const saved = await ratings()

    expect(saved).toHaveLength(2)
    expect(saved[0]).toStrictEqual(original[0])

    expect(saved[1]).toMatchObject({
      viewing_id: first.viewing.id,
      score: 8
    })

    await rate(6)

    const corrected = await ratings()

    expect(corrected.map(row => row.id)).toStrictEqual(saved.map(row => row.id))
    expect(corrected.map(row => row.score)).toStrictEqual([6, 6])

    const history = await findMovieViewings(database, owner, null)

    expect(history.items).toHaveLength(1)

    expect(history.items[0]).toMatchObject({
      id: first.viewing.id,
      score: 6,
      revision: 3
    })
  })

  it('retains separate viewing scores with one current public vote across rewatches', async () => {
    const first = await create(8)
    const second = await create()

    expect(second.viewing.score).toBeNull()

    expect(second.summary).toMatchObject({
      currentViewingScore: null,
      currentVoteScore: 8
    })

    await rate(6)

    await expect(findCatalogItemRating(database, userId, {
      catalogItemId,
      seasonNumber: null
    })).resolves.toStrictEqual({ score: 6 })

    await expect(findCatalogItemRatingSummary(database, catalogItemId)).resolves.toStrictEqual({
      averageScore: 6,
      ratingCount: 1
    })

    const saved = await ratings()

    expect(saved).toHaveLength(3)
    expect(saved.find(row => row.viewing_id === first.viewing.id)?.score).toBe(8)
    expect(saved.find(row => row.viewing_id === second.viewing.id)?.score).toBe(6)
    await rate(8)

    await expect(findCatalogItemRatingSummary(database, catalogItemId)).resolves.toStrictEqual({
      averageScore: 8,
      ratingCount: 1
    })

    const events = await client.query('SELECT previous_score, score, viewing_id FROM catalog_timeline_events WHERE user_id = $1 AND kind = \'rating_changed\' ORDER BY occurred_at, id', [userId])

    expect(events.rows).toStrictEqual([
      {
        previous_score: null,
        score: 8,
        viewing_id: first.viewing.id
      },
      {
        previous_score: null,
        score: 6,
        viewing_id: second.viewing.id
      },
      {
        previous_score: 6,
        score: 8,
        viewing_id: second.viewing.id
      }
    ])
  })

  it('adds and edits historical ratings without taking over the normal editor or vote', async () => {
    const first = await create(6)

    const history = await createMovieViewing(database, owner, {
      mode: 'history',
      requestId: randomUUID(),
      startedOn: '2000-01-01',
      completedOn: null,
      score: 8
    })

    const edited = await setHistoricalMovieRating(database, {
      ...owner,
      viewingId: history.viewing.id
    }, {
      revision: history.viewing.revision,
      score: 9
    })

    expect(edited.summary).toStrictEqual({
      ...first.summary,
      completedCount: 2
    })

    expect(edited.viewing).toMatchObject({
      score: 9,
      revision: 2
    })

    await expect(setHistoricalMovieRating(database, {
      ...owner,
      viewingId: history.viewing.id
    }, {
      revision: 1,
      score: 7
    })).rejects.toMatchObject({ status: 409 })

    await expect(setHistoricalMovieRating(database, {
      ...owner,
      viewingId: first.viewing.id
    }, {
      revision: 1,
      score: 7
    })).rejects.toMatchObject({ status: 409 })

    await deleteMovieViewing(database, {
      ...owner,
      viewingId: edited.viewing.id
    }, edited.viewing.revision)

    await expect(findCatalogItemRatingSummary(database, catalogItemId)).resolves.toStrictEqual({
      averageScore: 6,
      ratingCount: 1
    })

    await expect(ratings()).resolves.toHaveLength(2)
  })

  it('removes the current vote without reviving a past score and preserves it when a viewing is deleted', async () => {
    await create(8)

    const second = await create(6)

    await rate(null)

    await expect(findCatalogItemRatingSummary(database, catalogItemId)).resolves.toStrictEqual({
      averageScore: null,
      ratingCount: 0
    })

    await expect(ratings()).resolves.toHaveLength(1)

    const saved = await rate(7)

    expect(saved.viewing?.id).toBe(second.viewing.id)
    expect(saved.viewing?.score).toBe(7)
    assert(saved.viewing !== null)

    await deleteMovieViewing(database, {
      ...owner,
      viewingId: second.viewing.id
    }, saved.viewing.revision)

    await expect(findCatalogItemRatingSummary(database, catalogItemId)).resolves.toStrictEqual({
      averageScore: 7,
      ratingCount: 1
    })

    await expect(ratings()).resolves.toHaveLength(2)
  })

  it('keeps no-viewing ratings independent and can explicitly remove a retained vote from an unrated rewatch', async () => {
    const independent = await rate(8)

    expect(independent.viewing).toBeNull()
    expect(independent.summary.completedCount).toBe(0)
    await create()
    await rate(null)
    await expect(ratings()).resolves.toStrictEqual([])
  })

  it('rejects late writes after a viewing change, including an old no-viewing context', async () => {
    const empty = await readMovieViewingSummary(database, owner)
    const first = await create(8)

    await create()

    await expect(setCurrentMovieRating(database, owner, {
      currentViewingId: first.viewing.id,
      contextVersion: first.summary.contextVersion,
      score: 3
    })).rejects.toMatchObject({ status: 409 })

    await expect(setCurrentMovieRating(database, owner, {
      currentViewingId: null,
      contextVersion: empty.contextVersion,
      score: 3
    })).rejects.toMatchObject({ status: 409 })

    await expect(findCatalogItemRatingSummary(database, catalogItemId)).resolves.toStrictEqual({
      averageScore: 8,
      ratingCount: 1
    })
  })

  it('replays a combined creation without restoring an old score or switching the current viewing', async () => {
    const input = {
      mode: 'current',
      requestId: randomUUID(),
      contextVersion: 0,
      startedOn: null,
      completedOn: null,
      score: 8
    } as const

    const first = await createMovieViewing(database, owner, input)
    const next = await create(6)
    const replay = await createMovieViewing(database, owner, input)

    expect(replay.viewing.id).toBe(first.viewing.id)
    expect(replay.summary).toStrictEqual(next.summary)
    await expect(ratings()).resolves.toHaveLength(3)

    await expect(createMovieViewing(database, owner, {
      ...input,
      score: 9
    })).rejects.toMatchObject({ status: 409 })
  })

  it('serializes competing rating writes and identical combined creation retries', async () => {
    const input = {
      mode: 'current',
      requestId: randomUUID(),
      contextVersion: 0,
      startedOn: null,
      completedOn: null,
      score: 8
    } as const

    const creations = await Promise.all([concurrent(async db => createMovieViewing(db, owner, input)), concurrent(async db => createMovieViewing(db, owner, input))])

    expect(creations[0].viewing.id).toBe(creations[1].viewing.id)

    const summary = await readMovieViewingSummary(database, owner)

    const results = await Promise.allSettled([6, 7].map(async score => concurrent(async db => setCurrentMovieRating(db, owner, {
      currentViewingId: summary.currentViewingId,
      contextVersion: summary.contextVersion,
      score
    }))))

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    await expect(ratings()).resolves.toHaveLength(2)

    const average = await findCatalogItemRatingSummary(database, catalogItemId)

    expect(average?.ratingCount).toBe(1)
  })

  it('rolls back a viewing, its rating, timeline and replay key when the current vote fails', async () => {
    await client.query(`CREATE FUNCTION fail_movie_rating_vote() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.user_id = '${userId}'::uuid AND NEW.viewing_id IS NULL THEN RAISE EXCEPTION 'private movie rating failure'; END IF;
      RETURN NEW; END $$`)

    await client.query('CREATE TRIGGER fail_movie_rating_vote BEFORE INSERT OR UPDATE ON catalog_item_ratings FOR EACH ROW EXECUTE FUNCTION fail_movie_rating_vote()')

    try {
      await expect(create(8)).rejects.toMatchObject({ cause: { message: 'private movie rating failure' } })
      await expect(ratings()).resolves.toStrictEqual([])

      const history = await findMovieViewings(database, owner, null)

      expect(history.items).toStrictEqual([])
      expect(history.summary.contextVersion).toBe(0)

      const events = await client.query('SELECT id FROM catalog_timeline_events WHERE user_id = $1', [userId])
      const keys = await client.query('SELECT request_id FROM catalog_viewing_creations WHERE user_id = $1', [userId])

      expect(events.rows).toStrictEqual([])
      expect(keys.rows).toStrictEqual([])
    } finally {
      await client.query('DROP TRIGGER fail_movie_rating_vote ON catalog_item_ratings')
      await client.query('DROP FUNCTION fail_movie_rating_vote()')
    }
  })

  it('enforces account and movie ownership, bounds and per-viewing uniqueness', async () => {
    const first = await create(8)
    const insert = 'INSERT INTO catalog_item_ratings (user_id, catalog_item_id, viewing_id, score) VALUES ($1, $2, $3, $4)'

    await expect(client.query(insert, [otherUserId, catalogItemId, first.viewing.id, 8])).rejects.toMatchObject({ code: '23503' })
    await expect(client.query(insert, [userId, otherMovieId, first.viewing.id, 8])).rejects.toMatchObject({ code: '23503' })
    await expect(client.query(insert, [userId, catalogItemId, first.viewing.id, 8])).rejects.toMatchObject({ code: '23505' })
    await expect(client.query(insert, [userId, catalogItemId, null, 11])).rejects.toMatchObject({ code: '23514' })

    await expect(setHistoricalMovieRating(database, {
      userId: otherUserId,
      catalogItemId,
      viewingId: first.viewing.id
    }, {
      revision: 1,
      score: 9
    })).rejects.toMatchObject({ status: 404 })

    await expect(setHistoricalMovieRating(database, {
      userId,
      catalogItemId: otherMovieId,
      viewingId: first.viewing.id
    }, {
      revision: 1,
      score: 9
    })).rejects.toMatchObject({ status: 404 })
  })
})
