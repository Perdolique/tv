import { randomUUID } from 'node:crypto'
import { env } from 'node:process'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'
import { setCatalogEpisodeRating } from '../../episode-ratings-repository.ts'
import { createMovieViewing, deleteMovieViewing, updateMovieViewing } from '../../movie-viewings-repository.ts'
import { setCatalogItemRating } from '../../ratings-repository.ts'

const client = new Client({ connectionString: env.TEST_DATABASE_URL })
const database = createDatabase(client)
const userId = randomUUID()
const movieId = randomUUID()
const seriesId = randomUUID()
const episodeId = randomUUID()

async function changeRating(target: 'title' | 'season' | 'episode', score: number | null): Promise<boolean> {
  if (target === 'episode') {
    const savedRating = setCatalogEpisodeRating(database, userId, {
      episodeId,
      score
    })

    return savedRating
  }

  const catalogItemId = target === 'title' ? movieId : seriesId
  const seasonNumber = target === 'season' ? 1 : null

  const savedRating = setCatalogItemRating(database, userId, {
    catalogItemId,
    seasonNumber,
    score
  })

  return savedRating
}

async function ratingEvents() {
  const result = await client.query<{
    catalog_item_id: string;
    catalog_episode_id: string | null;
    season_number: number | null;
    previous_score: number | null;
    score: number | null;
  }>(`SELECT catalog_item_id, catalog_episode_id, season_number, previous_score, score
    FROM catalog_timeline_events WHERE user_id = $1 AND kind = 'rating_changed' ORDER BY occurred_at, id`, [userId])

  return result.rows
}

async function saveConcurrentRating(score: number): Promise<void> {
  const connection = new Client({ connectionString: env.TEST_DATABASE_URL })

  try {
    await connection.connect()

    const concurrentDatabase = createDatabase(connection)

    await setCatalogItemRating(concurrentDatabase, userId, {
      catalogItemId: movieId,
      score
    })
  } finally {
    await connection.end()
  }
}

describe('atomic personal events', () => {
  beforeAll(async () => {
    await client.connect()
    await assertDisposableTestDatabase(client)

    const email = `${userId}@example.com`

    await client.query('INSERT INTO users (id, email) VALUES ($1, $2)', [userId, email])
    await client.query('INSERT INTO catalog_items (id, type) VALUES ($1, \'movie\'), ($2, \'series\')', [movieId, seriesId])
    await client.query('INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original) VALUES ($1, \'en\', \'Event movie\', true), ($2, \'en\', \'Event series\', true)', [movieId, seriesId])
    await client.query('INSERT INTO catalog_episodes (id, catalog_item_id, season_number, episode_number) VALUES ($1, $2, 1, 1)', [episodeId, seriesId])
  })

  beforeEach(async () => {
    await client.query('DELETE FROM catalog_timeline_events WHERE user_id = $1', [userId])
    await client.query('DELETE FROM catalog_item_ratings WHERE user_id = $1', [userId])
    await client.query('DELETE FROM catalog_viewings WHERE user_id = $1', [userId])
    await client.query('DELETE FROM catalog_viewing_contexts WHERE user_id = $1', [userId])
  })

  afterAll(async () => {
    await client.query('DELETE FROM users WHERE id = $1', [userId])
    await client.query('DELETE FROM catalog_items WHERE id = ANY($1::uuid[])', [[movieId, seriesId]])
    await client.end()
  })

  it.each([
    {
      target: 'title',
      itemId: movieId,
      targetEpisodeId: null,
      seasonNumber: null
    },
    {
      target: 'season',
      itemId: seriesId,
      targetEpisodeId: null,
      seasonNumber: 1
    },
    {
      target: 'episode',
      itemId: seriesId,
      targetEpisodeId: episodeId,
      seasonNumber: null
    }
  ] as const)('records real $target rating changes and ignores retries', async ({ target, itemId, targetEpisodeId, seasonNumber }) => {
    await changeRating(target, null)
    await changeRating(target, 6)

    const first = await client.query<{ id: string }>('SELECT id FROM catalog_item_ratings WHERE user_id = $1', [userId])

    await changeRating(target, 8)
    await changeRating(target, 8)

    const corrected = await client.query<{ id: string }>('SELECT id FROM catalog_item_ratings WHERE user_id = $1', [userId])

    expect(corrected.rows).toStrictEqual(first.rows)
    await changeRating(target, null)
    await changeRating(target, null)

    const events = await ratingEvents()
    const expectedScores = [[null, 6], [6, 8], [8, null]]

    const expected = expectedScores.map(([previous_score, score]) => {
      return {
      catalog_item_id: itemId,
      catalog_episode_id: targetEpisodeId,
      season_number: seasonNumber,
      previous_score,
      score
      }
    })

    expect(events).toStrictEqual(expected)
  })

  it('uses a pre-existing score as the previous value without inventing older history', async () => {
    await client.query('INSERT INTO catalog_item_ratings (user_id, catalog_item_id, score) VALUES ($1, $2, 7)', [userId, movieId])
    await expect(ratingEvents()).resolves.toStrictEqual([])
    await changeRating('title', 9)

    const events = await ratingEvents()

    expect(events).toHaveLength(1)
    expect(events[0]?.previous_score).toBe(7)
    expect(events[0]?.score).toBe(9)
  })

  it('serializes concurrent rating changes into one chronological score chain', async () => {
    await changeRating('title', 6)

    const firstChange = saveConcurrentRating(3)
    const secondChange = saveConcurrentRating(9)

    await Promise.all([firstChange, secondChange])

    const events = await ratingEvents()
    const ratings = await client.query<{ score: number }>('SELECT score FROM catalog_item_ratings WHERE user_id = $1', [userId])

    expect(events).toHaveLength(3)
    expect(events[0]?.previous_score).toBeNull()
    expect(events[0]?.score).toBe(6)
    expect(events[1]?.previous_score).toBe(6)
    expect(events[2]?.previous_score).toBe(events[1]?.score)
    expect(ratings.rows).toStrictEqual([{ score: events[2]?.score }])
  })

  it('keeps movie recording time, adds no date-edit event, and removes only the deleted viewing event', async () => {
    const owner = {
      userId,
      catalogItemId: movieId
    }

    const requestId = randomUUID()

    const input = {
      requestId,
      mode: 'current',
      contextVersion: 0,
      startedOn: null,
      completedOn: null
    } as const

    const created = await createMovieViewing(database, owner, input)
    const replayed = await createMovieViewing(database, owner, input)

    expect(replayed.viewing.id).toBe(created.viewing.id)
    await changeRating('title', 8)

    const target = {
      userId,
      catalogItemId: movieId,
      viewingId: created.viewing.id
    }

    const updated = await updateMovieViewing(database, target, {
      revision: 1,
      startedOn: null,
      completedOn: '2020-02-29'
    })

    const events = await client.query<{ time: string }>(`SELECT to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS time
      FROM catalog_timeline_events WHERE user_id = $1 AND kind = 'movie_viewing'`, [userId])

    expect(events.rows).toStrictEqual([{ time: created.viewing.recordedAt }])
    await deleteMovieViewing(database, target, updated.viewing.revision)

    const remaining = await client.query<{ kind: string }>('SELECT kind FROM catalog_timeline_events WHERE user_id = $1', [userId])

    expect(remaining.rows).toStrictEqual([{ kind: 'rating_changed' }])
  })

  it('rolls back a rating change when its event cannot be saved', async () => {
    await changeRating('title', 6)

    const rejectEventFunction = `CREATE FUNCTION test_reject_personal_event() RETURNS trigger AS $$
      BEGIN IF NEW.user_id = '${userId}'::uuid THEN RAISE EXCEPTION 'Rejected event'; END IF; RETURN NEW; END;
      $$ LANGUAGE plpgsql`

    await client.query(rejectEventFunction)
    await client.query('CREATE TRIGGER test_reject_personal_event BEFORE INSERT ON catalog_timeline_events FOR EACH ROW EXECUTE FUNCTION test_reject_personal_event()')

    try {
      await expect(changeRating('title', 9)).rejects.toMatchObject({ cause: { message: 'Rejected event' } })

      const ratings = await client.query<{ score: number }>('SELECT score FROM catalog_item_ratings WHERE user_id = $1', [userId])

      expect(ratings.rows).toStrictEqual([{ score: 6 }])

      const events = await ratingEvents()

      expect(events).toHaveLength(1)
      expect(events[0]?.score).toBe(6)
    } finally {
      await client.query('DROP TRIGGER test_reject_personal_event ON catalog_timeline_events')
      await client.query('DROP FUNCTION test_reject_personal_event()')
    }
  })
})
