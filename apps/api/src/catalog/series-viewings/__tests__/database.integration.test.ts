/* oxlint-disable eslint/max-lines -- One disposable fixture verifies the series transaction and its independent PostgreSQL constraints. */
import { randomUUID } from 'node:crypto'
import { env } from 'node:process'
import { createDatabase } from '@tv/database'
import type { CatalogSeriesWatchInput } from '@tv/shared/catalog-series'
import { Client } from 'pg'
import { afterAll, afterEach, assert, beforeEach, describe, expect, it } from 'vitest'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'

import {
  findSeriesWatches,
  markSeriesEpisodeWatched,
  markSeriesEpisodesWatched,
  startSeriesRewatch,
  unmarkSeriesEpisodeWatched
} from '../../series-viewings-repository.ts'

const databaseUrl = env.TEST_DATABASE_URL
const client = new Client({ connectionString: databaseUrl })

await client.connect()

const database = createDatabase(client)
const userId = randomUUID()
const catalogItemId = randomUUID()
const firstEpisodeId = randomUUID()
const secondEpisodeId = randomUUID()
const futureEpisodeId = randomUUID()
const unknownDateEpisodeId = randomUUID()
const episodeIds: [string, string, string, string] = [firstEpisodeId, secondEpisodeId, futureEpisodeId, unknownDateEpisodeId]

const owner = {
  userId,
  catalogItemId
}

function initialInput(): CatalogSeriesWatchInput {
  const requestId = randomUUID()

  return {
    requestId,
    currentViewingId: null,
    contextVersion: 0,
    timeZone: 'Pacific/Kiritimati'
  }
}

async function concurrent<Result>(run: (db: ReturnType<typeof createDatabase>) => Promise<Result>): Promise<Result> {
  const connection = new Client({ connectionString: databaseUrl })

  try {
    await connection.connect()

    const concurrentDatabase = createDatabase(connection)
    const result = await run(concurrentDatabase)

    return result
  } finally {
    await connection.end()
  }
}

async function events(): Promise<string[]> {
  const result = await client.query<{ kind: string }>('SELECT kind FROM catalog_timeline_events WHERE user_id = $1 ORDER BY occurred_at, id', [userId])
  const eventKinds = result.rows.map(row => row.kind)

  return eventKinds
}

interface ExpectedDatabaseConstraint {
  code: string;
  constraint?: string;
}

async function expectDatabaseConstraint(query: string, parameters: string[], expected: ExpectedDatabaseConstraint): Promise<void> {
  await client.query('SAVEPOINT negative_constraint')

  try {
    const invalidWrite = client.query(query, parameters)

    await expect(invalidWrite).rejects.toMatchObject(expected)
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT negative_constraint')
    await client.query('RELEASE SAVEPOINT negative_constraint')
  }
}

describe('series viewing persistence', () => {
  beforeEach(async () => {
    await assertDisposableTestDatabase(client)

    const email = `${userId}@example.com`

    await client.query('INSERT INTO users (id, email) VALUES ($1, $2)', [userId, email])
    await client.query('INSERT INTO catalog_items (id, type) VALUES ($1, \'series\')', [catalogItemId])
    await client.query('INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original) VALUES ($1, \'en\', \'Series persistence fixture\', true)', [catalogItemId])

    await client.query(`INSERT INTO catalog_episodes (id, catalog_item_id, season_number, episode_number, air_date)
      VALUES ($2, $1, 1, 1, '2000-01-01'), ($3, $1, 1, 2, (CURRENT_TIMESTAMP AT TIME ZONE 'Pacific/Kiritimati')::date),
        ($4, $1, 1, 3, '9999-01-01'), ($5, $1, 1, 4, NULL)`, [catalogItemId, ...episodeIds])
  })

  afterEach(async () => {
    await client.query('DROP TRIGGER IF EXISTS fail_series_request ON catalog_series_requests')
    await client.query('DROP FUNCTION IF EXISTS fail_series_request()')
    await client.query('DELETE FROM users WHERE id = $1', [userId])
    await client.query('DELETE FROM catalog_items WHERE id = $1', [catalogItemId])
  })

  afterAll(async () => { await client.end() })

  it('creates only one first viewing, rejects stale context and replays the same request', async () => {
    const [episodeId] = episodeIds
    const input = initialInput()

    const firstRequest = concurrent(async db => {
      const watchRequest = markSeriesEpisodeWatched(db, userId, episodeId, input)

      return watchRequest
    })

    const secondRequest = concurrent(async db => {
      const concurrentInput = initialInput()
      const watchRequest = markSeriesEpisodeWatched(db, userId, episodeId, concurrentInput)

      return watchRequest
    })

    const results = await Promise.allSettled([firstRequest, secondRequest])
    const winner = results.find(result => result.status === 'fulfilled')
    const loser = results.find(result => result.status === 'rejected')

    assert(winner?.status === 'fulfilled')
    expect(loser).toMatchObject({ reason: { status: 409 } })
    expect(winner.value.contextVersion).toBe(1)
    expect(winner.value.watches).toHaveLength(1)

    const request = await client.query<{ input: CatalogSeriesWatchInput }>('SELECT input FROM catalog_series_requests WHERE user_id = $1', [userId])
    const successfulInput = request.rows[0]?.input

    assert(successfulInput !== undefined)

    const replay = await markSeriesEpisodeWatched(database, userId, episodeId, successfulInput)

    expect(replay).toStrictEqual(winner.value)
    await expect(events()).resolves.toStrictEqual(['series_started', 'episode_watched'])
    await expect(markSeriesEpisodeWatched(database, userId, episodeIds[1], successfulInput)).rejects.toMatchObject({ status: 409 })
  })

  it('bulk marks server-today episodes, leaves unknown and future dates, and creates exact milestone dependencies', async () => {
    const input = initialInput()
    const result = await markSeriesEpisodesWatched(database, owner, input, 1)
    const availableEpisodeIds = episodeIds.slice(0, 2)

    expect(result.watchedEpisodeIds).toStrictEqual(availableEpisodeIds)
    await expect(events()).resolves.toStrictEqual(['series_started', 'episode_watched', 'episode_watched', 'available_completed'])

    const before = await events()
    const viewingId = result.currentViewing?.id

    assert(viewingId !== undefined)

    const replay = await markSeriesEpisodesWatched(database, owner, input, 1)

    expect(replay).toStrictEqual(result)
    await expect(events()).resolves.toStrictEqual(before)

    await expect(markSeriesEpisodesWatched(database, owner, {
      ...input,
      timeZone: 'UTC'
    }, 1)).rejects.toMatchObject({ status: 409 })

    const futureRequestId = randomUUID()

    const futureInput = {
      requestId: futureRequestId,
      currentViewingId: viewingId,
      contextVersion: 1,
      timeZone: 'UTC'
    }

    const future = await markSeriesEpisodeWatched(database, userId, episodeIds[2], futureInput)
    const unknownDateRequestId = randomUUID()

    const unknownDateInput = {
      requestId: unknownDateRequestId,
      currentViewingId: viewingId,
      contextVersion: 1,
      timeZone: 'UTC'
    }

    const all = await markSeriesEpisodeWatched(database, userId, episodeIds[3], unknownDateInput)

    expect(future.watches).toHaveLength(3)
    expect(all.watches).toHaveLength(4)
    await expect(events()).resolves.toContain('season_completed')

    const milestone = await client.query<{ episode_ids: string[]; watches: number }>(`SELECT episode_ids, (SELECT count(*)::integer FROM catalog_timeline_event_watches WHERE event_id = events.id) AS watches FROM catalog_timeline_events events WHERE user_id = $1 AND kind = 'season_completed'`, [userId])

    expect(milestone.rows[0]?.episode_ids).toHaveLength(4)
    expect(milestone.rows[0]?.watches).toBe(4)

    const additionalId = randomUUID()

    await client.query('INSERT INTO catalog_episodes (id, catalog_item_id, season_number, episode_number, air_date) VALUES ($1, $2, 1, 5, \'9999-01-01\')', [additionalId, catalogItemId])
    await expect(events()).resolves.toContain('season_completed')

    const watch = all.watches.find(row => row.catalogEpisodeId === episodeIds[0])

    assert(watch !== undefined)

    await unmarkSeriesEpisodeWatched(database, userId, episodeIds[0], {
      watchId: watch.id,
      currentViewingId: viewingId,
      contextVersion: 1
    })

    await expect(events()).resolves.not.toContain('available_completed')
    await expect(events()).resolves.not.toContain('season_completed')
    await expect(markSeriesEpisodesWatched(database, owner, input, 1)).rejects.toMatchObject({ status: 409 })

    const remarkRequestId = randomUUID()

    const remarkInput = {
      requestId: remarkRequestId,
      currentViewingId: viewingId,
      contextVersion: 1,
      timeZone: 'UTC'
    }

    const remark = await markSeriesEpisodeWatched(database, userId, episodeIds[0], remarkInput)
    const replacementWatch = remark.watches.find(row => row.catalogEpisodeId === episodeIds[0])

    expect(replacementWatch?.id).not.toBe(watch.id)

    const lateDelete = await unmarkSeriesEpisodeWatched(database, userId, episodeIds[0], {
      watchId: watch.id,
      currentViewingId: viewingId,
      contextVersion: 1
    })

    expect(lateDelete).toStrictEqual(remark)
  })

  it('keeps rewatch retries on the latest context and leaves all former marks in history', async () => {
    const markInput = initialInput()
    const first = await markSeriesEpisodeWatched(database, userId, episodeIds[0], markInput)
    const firstId = first.currentViewing?.id

    assert(firstId !== undefined)

    const rewatchRequestId = randomUUID()

    const rewatchInput = {
      requestId: rewatchRequestId,
      currentViewingId: firstId,
      contextVersion: 1,
      timeZone: 'UTC',
      closeStatus: 'paused' as const
    }

    const second = await startSeriesRewatch(database, owner, rewatchInput)
    const secondId = second.currentViewing?.id

    assert(secondId !== undefined)
    expect(second.watches).toStrictEqual([])
    expect(second.contextVersion).toBe(2)

    const completedRewatchRequestId = randomUUID()

    const completedRewatchInput = {
      requestId: completedRewatchRequestId,
      currentViewingId: secondId,
      contextVersion: 2,
      timeZone: 'UTC',
      closeStatus: 'completed' as const
    }

    const third = await startSeriesRewatch(database, owner, completedRewatchInput)
    const markReplay = await markSeriesEpisodeWatched(database, userId, episodeIds[0], markInput)
    const rewatchReplay = await startSeriesRewatch(database, owner, rewatchInput)

    expect(markReplay).toStrictEqual(third)
    expect(rewatchReplay).toStrictEqual(third)

    const watches = await client.query('SELECT id FROM catalog_viewing_episode_watches WHERE user_id = $1', [userId])

    expect(watches.rows).toHaveLength(1)

    const active = await client.query('SELECT id FROM catalog_viewings WHERE user_id = $1 AND status = \'watching\'', [userId])

    expect(active.rows).toHaveLength(1)
    await expect(events()).resolves.toStrictEqual(['series_started', 'episode_watched', 'series_paused', 'rewatch_started', 'series_completed', 'rewatch_started'])

    const staleRequestId = randomUUID()

    const staleInput = {
      requestId: staleRequestId,
      currentViewingId: firstId,
      contextVersion: 1,
      timeZone: 'UTC'
    }

    await expect(markSeriesEpisodeWatched(database, userId, episodeIds[1], staleInput)).rejects.toMatchObject({ status: 409 })
  })

  it('does not create milestone events on a no-op after the catalog set changes', async () => {
    const input = initialInput()
    const first = await markSeriesEpisodesWatched(database, owner, input, null)
    const viewingId = first.currentViewing?.id

    assert(viewingId !== undefined)
    await client.query('DELETE FROM catalog_episodes WHERE id = $1', [episodeIds[1]])

    const before = await events()
    const repeatRequestId = randomUUID()

    const repeatInput = {
      requestId: repeatRequestId,
      currentViewingId: viewingId,
      contextVersion: 1,
      timeZone: 'UTC'
    }

    await markSeriesEpisodesWatched(database, owner, repeatInput, null)
    await expect(events()).resolves.toStrictEqual(before)
  })

  it('does not create a viewing for an empty bulk action and rolls everything back when request persistence fails', async () => {
    const bulkInput = initialInput()

    await expect(markSeriesEpisodesWatched(database, owner, bulkInput, 2)).rejects.toMatchObject({ status: 400 })

    await expect(findSeriesWatches(database, owner)).resolves.toStrictEqual({
      watchedEpisodeIds: [],
      watches: [],
      currentViewing: null,
      contextVersion: 0
    })

    await client.query(`CREATE FUNCTION fail_series_request() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced series ledger failure'; END; $$ LANGUAGE plpgsql`)
    await client.query('CREATE TRIGGER fail_series_request BEFORE INSERT ON catalog_series_requests FOR EACH ROW EXECUTE FUNCTION fail_series_request()')

    const watchInput = initialInput()

    await expect(markSeriesEpisodeWatched(database, userId, episodeIds[0], watchInput)).rejects.toThrow('Failed query')

    await expect(findSeriesWatches(database, owner)).resolves.toStrictEqual({
      watchedEpisodeIds: [],
      watches: [],
      currentViewing: null,
      contextVersion: 0
    })

    await expect(events()).resolves.toStrictEqual([])
  })

  it('records action time after a lock wait and uses the same precise time for watch events', async () => {
    const writer = new Client({
      connectionString: databaseUrl,
      application_name: 'series-action-time-writer'
    })

    try {
      await writer.connect()
      await client.query('BEGIN')
      await client.query('SELECT id FROM catalog_items WHERE id = $1 FOR NO KEY UPDATE', [catalogItemId])

      const writerDatabase = createDatabase(writer)
      const input = initialInput()
      const pending = markSeriesEpisodeWatched(writerDatabase, userId, episodeIds[0], input)

      await expect.poll(async () => {
        const blocked = await client.query<{ blocked: boolean }>('SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = \'series-action-time-writer\' AND wait_event_type = \'Lock\') AS blocked')

        return blocked.rows[0]?.blocked
      }).toBe(true)

      const barrier = await client.query<{ at: string }>('SELECT to_char(clock_timestamp() AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS at')

      await client.query('COMMIT')

      const result = await pending
      const actionAt = result.watches[0]?.markedAt

      assert(actionAt !== undefined)

      const lockedUntil = barrier.rows[0]?.at

      assert(lockedUntil !== undefined)

      const actionOrder = actionAt.localeCompare(lockedUntil)

      expect(actionOrder).toBeGreaterThanOrEqual(0)

      const recorded = await client.query<{ time: string }>(`SELECT to_char(events.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS time
        FROM catalog_timeline_events events WHERE user_id = $1`, [userId])

      const eventTimes = recorded.rows.map(row => row.time)

      expect(eventTimes).toStrictEqual([actionAt, actionAt])
    } finally {
      await client.query('ROLLBACK')
      await writer.end()
    }
  })

  it('enforces owner, episode item, series status and the single active viewing in PostgreSQL', async () => {
    const input = initialInput()
    const first = await markSeriesEpisodeWatched(database, userId, episodeIds[0], input)
    const viewingId = first.currentViewing?.id

    assert(viewingId !== undefined)

    const otherUserId = randomUUID()
    const otherSeriesId = randomUUID()
    const otherEpisodeId = randomUUID()
    const movieId = randomUUID()

    await client.query('BEGIN')

    try {
      const otherEmail = `${otherUserId}@example.com`

      await client.query('INSERT INTO users (id, email) VALUES ($1, $2)', [otherUserId, otherEmail])
      await client.query('INSERT INTO catalog_items (id, type) VALUES ($1, \'series\'), ($2, \'movie\')', [otherSeriesId, movieId])
      await client.query('INSERT INTO catalog_episodes (id, catalog_item_id, season_number, episode_number) VALUES ($1, $2, 1, 1)', [otherEpisodeId, otherSeriesId])

      await expectDatabaseConstraint('INSERT INTO catalog_viewings (user_id, catalog_item_id, status) VALUES ($1, $2, \'watching\')', [userId, catalogItemId], {
        code: '23505',
        constraint: 'catalog_viewings_one_watching_unique'
      })

      await expectDatabaseConstraint('INSERT INTO catalog_viewing_episode_watches (user_id, catalog_item_id, viewing_id, catalog_episode_id) VALUES ($1, $2, $3, $4)', [otherUserId, catalogItemId, viewingId, episodeIds[1]], {
        code: '23503',
        constraint: 'catalog_viewing_episode_watches_viewing_fk'
      })

      await expectDatabaseConstraint('INSERT INTO catalog_viewing_episode_watches (user_id, catalog_item_id, viewing_id, catalog_episode_id) VALUES ($1, $2, $3, $4)', [userId, catalogItemId, viewingId, otherEpisodeId], {
        code: '23503',
        constraint: 'catalog_viewing_episode_watches_episode_fk'
      })

      await expectDatabaseConstraint('INSERT INTO catalog_episode_watches (user_id, catalog_episode_id) VALUES ($1, $2)', [userId, episodeIds[1]], { code: '55000' })
      await expectDatabaseConstraint('INSERT INTO catalog_viewings (user_id, catalog_item_id, status) VALUES ($1, $2, \'watching\')', [userId, movieId], { code: '23514' })
      await expectDatabaseConstraint('INSERT INTO catalog_viewings (user_id, catalog_item_id, status) VALUES ($1, $2, \'paused\')', [userId, movieId], { code: '23514' })

      await expectDatabaseConstraint('INSERT INTO catalog_viewings (user_id, catalog_item_id, status) VALUES ($1, $2, \'unknown\')', [userId, catalogItemId], {
        code: '23514',
        constraint: 'catalog_viewings_status'
      })

      await client.query('INSERT INTO catalog_viewings (user_id, catalog_item_id, status) VALUES ($1, $2, \'completed\'), ($1, $3, \'paused\'), ($1, $3, \'completed\')', [userId, movieId, catalogItemId])

      const validStatuses = await client.query('SELECT items.type, viewings.status FROM catalog_viewings viewings JOIN catalog_items items ON items.id = viewings.catalog_item_id WHERE viewings.user_id = $1 ORDER BY items.type, viewings.status', [userId])

      expect(validStatuses.rows).toStrictEqual([
        {
          type: 'movie',
          status: 'completed'
        },
        {
          type: 'series',
          status: 'completed'
        },
        {
          type: 'series',
          status: 'paused'
        },
        {
          type: 'series',
          status: 'watching'
        }
      ])
    } finally {
      await client.query('ROLLBACK')
    }
  })

})
