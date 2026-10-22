import { randomUUID } from 'node:crypto'
import { env } from 'node:process'
import assert from 'node:assert/strict'
import { createDatabase } from '@tv/database'
import type { CatalogRatingMutationResponse } from '@tv/shared/catalog-viewings'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'
import { setCurrentCatalogRating, type CurrentRatingChange } from '../../rating-mutations.ts'
import { deleteViewing, updateViewing } from '../../viewings-repository.ts'

const client = new Client({ connectionString: env.TEST_DATABASE_URL })
const database = createDatabase(client)
const userId = randomUUID()
const movieId = randomUUID()
const seriesId = randomUUID()
const episodeId = randomUUID()

type RatingTarget = 'movie' | 'series' | 'season' | 'episode'

function ratingTarget(target: RatingTarget) {
  return {
    seasonNumber: target === 'season' ? 1 : null,
    catalogEpisodeId: target === 'episode' ? episodeId : null
  }
}

async function ratingInput(catalogItemId: string, score: number | null): Promise<CurrentRatingChange> {
  const result = await client.query<{ current_viewing_id: string | null; context_version: number }>(`
    SELECT current_viewing_id, context_version FROM catalog_viewing_contexts WHERE user_id = $1 AND catalog_item_id = $2
  `, [userId, catalogItemId])

  const [context] = result.rows
  const requestId = randomUUID()

  return {
    requestId,
    currentViewingId: context?.current_viewing_id ?? null,
    contextVersion: context?.context_version ?? 0,
    timeZone: 'UTC',
    viewingDate: '2026-10-17',
    score
  }
}

async function changeRating(target: RatingTarget, score: number | null): Promise<CatalogRatingMutationResponse> {
  const catalogItemId = target === 'movie' ? movieId : seriesId

  const owner = {
    userId,
    catalogItemId
  }

  const input = await ratingInput(catalogItemId, score)
  const selectedTarget = ratingTarget(target)

  return setCurrentCatalogRating(database, owner, selectedTarget, input)
}

async function personalEvents() {
  const result = await client.query<{ id: string; kind: string; occurred_at: string }>(`
    SELECT id, kind, to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at
    FROM catalog_timeline_events WHERE user_id = $1 ORDER BY occurred_at, id
  `, [userId])

  return result.rows
}

async function saveConcurrentRating(input: CurrentRatingChange): Promise<CatalogRatingMutationResponse> {
  const connection = new Client({ connectionString: env.TEST_DATABASE_URL })

  try {
    await connection.connect()

    const concurrentDatabase = createDatabase(connection)
    const target = ratingTarget('series')

    return await setCurrentCatalogRating(concurrentDatabase, {
      userId,
      catalogItemId: seriesId
    }, target, input)
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
    await client.query('INSERT INTO catalog_episodes (id, catalog_item_id, season_number, episode_number, air_date) VALUES ($1, $2, 1, 1, \'2020-01-01\')', [episodeId, seriesId])
  })

  beforeEach(async () => {
    await client.query('DELETE FROM catalog_viewings WHERE user_id = $1', [userId])
    await client.query('DELETE FROM catalog_viewing_contexts WHERE user_id = $1', [userId])
    await client.query('DELETE FROM catalog_viewing_requests WHERE user_id = $1', [userId])
  })

  afterAll(async () => {
    await client.query('DELETE FROM users WHERE id = $1', [userId])
    await client.query('DELETE FROM catalog_items WHERE id = ANY($1::uuid[])', [[movieId, seriesId]])
    await client.end()
  })

  const targets = [
    {
      target: 'movie',
      catalogItemId: movieId,
      expectedKind: 'movie_viewing',
      markCount: 0
    },
    {
      target: 'series',
      catalogItemId: seriesId,
      expectedKind: 'series_started',
      markCount: 0
    },
    {
      target: 'season',
      catalogItemId: seriesId,
      expectedKind: 'series_started',
      markCount: 0
    },
    {
      target: 'episode',
      catalogItemId: seriesId,
      expectedKind: 'series_started',
      markCount: 1
    }
  ] as const

  it.each(targets)('creates diary events once for the first $target score and leaves them unchanged on edits, deletion and retry', async ({ target, catalogItemId, expectedKind, markCount }) => {
    // Arrange
    const owner = {
      userId,
      catalogItemId
    }

    const input = await ratingInput(catalogItemId, 6)
    const selectedTarget = ratingTarget(target)
    const created = await setCurrentCatalogRating(database, owner, selectedTarget, input)

    assert.ok(created.viewing !== null, 'First score must create a viewing')

    const initialEvents = await personalEvents()

    // Act
    const replayed = await setCurrentCatalogRating(database, owner, selectedTarget, input)
    const edited = await changeRating(target, 8)
    const cleared = await changeRating(target, null)
    const finalEvents = await personalEvents()
    const ratings = await client.query('SELECT id FROM catalog_item_ratings WHERE user_id = $1', [userId])
    const marks = await client.query('SELECT id FROM catalog_viewing_episode_watches WHERE user_id = $1', [userId])

    // Assert
    const initialEvent = initialEvents.find(event => event.kind === expectedKind)

    expect(initialEvent).toMatchObject({
      kind: expectedKind,
      occurred_at: created.viewing.recordedAt
    })

    expect(replayed.viewing?.id).toBe(created.viewing.id)
    expect(edited.viewing?.id).toBe(created.viewing.id)

    expect(cleared.viewing).toMatchObject({
      id: created.viewing.id,
      startedOn: created.viewing.startedOn,
      completedOn: created.viewing.completedOn,
      recordedAt: created.viewing.recordedAt
    })

    expect(finalEvents).toStrictEqual(initialEvents)
    expect(ratings.rows).toStrictEqual([])
    expect(marks.rows).toHaveLength(markCount)
  })

  it('accepts one concurrent current score revision and keeps the diary event identity', async () => {
    // Arrange
    await changeRating('series', 6)

    const before = await personalEvents()
    const firstInput = await ratingInput(seriesId, 3)
    const secondInput = await ratingInput(seriesId, 9)

    // Act
    const results = await Promise.allSettled([saveConcurrentRating(firstInput), saveConcurrentRating(secondInput)])
    const successful = results.filter(result => result.status === 'fulfilled')
    const rejected = results.filter(result => result.status === 'rejected')
    const ratings = await client.query<{ score: number }>('SELECT score FROM catalog_item_ratings WHERE user_id = $1', [userId])
    const events = await personalEvents()
    const savedScore = successful[0]?.value.score

    // Assert
    expect(successful).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    expect(rejected[0]?.reason).toMatchObject({
      code: 'CONFLICT',
      status: 409
    })

    expect(ratings.rows).toStrictEqual([{ score: savedScore }])
    expect(events).toStrictEqual(before)
  })

  it('keeps movie recording time on date edits and deletes its scores, votes and diary event with the viewing', async () => {
    // Arrange
    const created = await changeRating('movie', 8)

    assert.ok(created.viewing !== null, 'Movie viewing is missing')

    const owner = {
      userId,
      catalogItemId: movieId,
      viewingId: created.viewing.id
    }

    const initialEvents = await personalEvents()

    // Act
    const dateRequestId = randomUUID()

    const updated = await updateViewing(database, owner, {
      requestId: dateRequestId,
      currentViewingId: created.summary.currentViewingId,
      contextVersion: created.summary.contextVersion,
      revision: created.viewing.revision,
      status: 'completed',
      startedOn: null,
      completedOn: '2020-02-29'
    })

    const events = await personalEvents()
    const deletionRequestId = randomUUID()

    await deleteViewing(database, owner, {
      requestId: deletionRequestId,
      revision: updated.viewing.revision
    })

    const remaining = await personalEvents()
    const ratings = await client.query('SELECT id FROM catalog_item_ratings WHERE user_id = $1', [userId])
    const votes = await client.query('SELECT id FROM catalog_rating_votes WHERE user_id = $1', [userId])

    // Assert
    expect(events).toStrictEqual(initialEvents)
    expect(events[0]?.occurred_at).toBe(created.viewing.recordedAt)
    expect(remaining).toStrictEqual([])
    expect(ratings.rows).toStrictEqual([])
    expect(votes.rows).toStrictEqual([])
  })

  it('deletes an episode-rated viewing with all dependent watch events and request tombstones intact', async () => {
    // Arrange
    const created = await changeRating('episode', 8)

    assert.ok(created.viewing !== null, 'Episode viewing is missing')

    const owner = {
      userId,
      catalogItemId: seriesId,
      viewingId: created.viewing.id
    }

    // Act
    const deletionRequestId = randomUUID()

    await deleteViewing(database, owner, {
      requestId: deletionRequestId,
      revision: created.viewing.revision
    })

    const events = await personalEvents()
    const marks = await client.query('SELECT id FROM catalog_viewing_episode_watches WHERE user_id = $1', [userId])
    const requests = await client.query<{ tombstoned: boolean; viewing_id: string | null }>('SELECT tombstoned, viewing_id FROM catalog_viewing_requests WHERE user_id = $1 AND action LIKE \'rating:%\'', [userId])

    // Assert
    expect(events).toStrictEqual([])
    expect(marks.rows).toStrictEqual([])

    expect(requests.rows).toStrictEqual([{
      tombstoned: true,
      viewing_id: null
    }])
  })

  it('rolls back the first rating, viewing, vote and request when its diary event cannot be saved', async () => {
    // Arrange
    const rejectEventFunction = `CREATE FUNCTION test_reject_personal_event() RETURNS trigger AS $$
      BEGIN IF NEW.user_id = '${userId}'::uuid THEN RAISE EXCEPTION 'Rejected event'; END IF; RETURN NEW; END;
      $$ LANGUAGE plpgsql`

    await client.query(rejectEventFunction)
    await client.query('CREATE TRIGGER test_reject_personal_event BEFORE INSERT ON catalog_timeline_events FOR EACH ROW EXECUTE FUNCTION test_reject_personal_event()')

    try {
      // Act and assert
      await expect(changeRating('series', 9)).rejects.toMatchObject({ cause: { message: 'Rejected event' } })

      const effects = await client.query(`SELECT
        (SELECT count(*)::integer FROM catalog_viewings WHERE user_id = $1) AS viewings,
        (SELECT count(*)::integer FROM catalog_item_ratings WHERE user_id = $1) AS ratings,
        (SELECT count(*)::integer FROM catalog_rating_votes WHERE user_id = $1) AS votes,
        (SELECT count(*)::integer FROM catalog_viewing_requests WHERE user_id = $1) AS requests,
        (SELECT count(*)::integer FROM catalog_timeline_events WHERE user_id = $1) AS events`, [userId])

      expect(effects.rows).toStrictEqual([{
        viewings: 0,
        ratings: 0,
        votes: 0,
        requests: 0,
        events: 0
      }])
    } finally {
      await client.query('DROP TRIGGER test_reject_personal_event ON catalog_timeline_events')
      await client.query('DROP FUNCTION test_reject_personal_event()')
    }
  })
})
