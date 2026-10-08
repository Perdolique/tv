/* oxlint-disable eslint/max-lines -- Episode snapshots and private watch persistence share one seeded catalog fixture. */
import { env } from 'node:process'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { afterAll, assert, describe, expect, it } from 'vitest'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'
import { findCatalogEpisodeListing } from '../../episodes-repository.ts'

import {
  findSeriesWatches,
  markSeriesEpisodeWatched,
  unmarkSeriesEpisodeWatched
} from '../../series-viewings-repository.ts'

import { followCatalogItem } from '../../repository.ts'
import { createMovieViewing } from '../../movie-viewings-repository.ts'

const databaseUrl = env.TEST_DATABASE_URL

if (databaseUrl === undefined || databaseUrl === '') {
  throw new Error('TEST_DATABASE_URL is required for database integration tests')
}

const client = new Client({ connectionString: databaseUrl })

await client.connect()

async function findCatalogItemId(title: string): Promise<string> {
  const result = await client.query<{ id: string }>(`
    SELECT id FROM catalog_items JOIN catalog_item_titles ON catalog_item_id = id
    WHERE title = $1 AND is_original
  `, [title])

  const id = result.rows[0]?.id

  assert(id !== undefined, `${title} is missing from the seeded catalog`)

  return id
}

async function findMarkedAt(userId: string, episodeId: string): Promise<Date> {
  const result = await client.query<{ marked_at: Date }>(`
    SELECT marked_at FROM catalog_episode_watches
    WHERE user_id = $1 AND catalog_episode_id = $2
  `, [userId, episodeId])

  const markedAt = result.rows[0]?.marked_at

  assert(markedAt !== undefined, 'The episode watch timestamp is missing')

  return markedAt
}

describe('postgreSQL catalog episodes and watches', () => {
  afterAll(async () => {
    await client.end()
  })

  it('contains the exact stable Chernobyl episode snapshot', async () => {
    const chernobylId = await findCatalogItemId('Chernobyl')

    const result = await client.query<{
      air_date: string;
      episode_number: number;
      id: string;
      season_number: number;
      source_title: string;
      tvmaze_episode_id: number;
    }>(`
      SELECT episode.id, episode.season_number, episode.episode_number, episode.source_title,
        episode.air_date::text AS air_date, link.external_id::integer AS tvmaze_episode_id
      FROM catalog_episodes AS episode
      JOIN catalog_external_links AS link ON link.catalog_episode_id = episode.id
        AND link.provider = 'tvmaze' AND link.entity_type = 'episode'
      WHERE episode.catalog_item_id = $1
      ORDER BY episode.season_number, episode.episode_number, episode.id
    `, [chernobylId])

    expect(result.rows).toStrictEqual([
      {
        id: '30000000-0000-7000-8000-000000000001',
        season_number: 1,
        episode_number: 1,
        source_title: '1:23:45',
        air_date: '2019-05-06',
        tvmaze_episode_id: 1_594_417
      },
      {
        id: '30000000-0000-7000-8000-000000000002',
        season_number: 1,
        episode_number: 2,
        source_title: 'Please Remain Calm',
        air_date: '2019-05-13',
        tvmaze_episode_id: 1_634_381
      },
      {
        id: '30000000-0000-7000-8000-000000000003',
        season_number: 1,
        episode_number: 3,
        source_title: 'Open Wide, O Earth',
        air_date: '2019-05-20',
        tvmaze_episode_id: 1_634_382
      },
      {
        id: '30000000-0000-7000-8000-000000000004',
        season_number: 1,
        episode_number: 4,
        source_title: 'The Happiness of All Mankind',
        air_date: '2019-05-27',
        tvmaze_episode_id: 1_634_383
      },
      {
        id: '30000000-0000-7000-8000-000000000005',
        season_number: 1,
        episode_number: 5,
        source_title: 'Vichnaya Pamyat',
        air_date: '2019-06-03',
        tvmaze_episode_id: 1_634_384
      }
    ])

    await expect(findCatalogEpisodeListing(createDatabase(client), chernobylId)).resolves.toMatchObject({
      type: 'series',

      items: result.rows.map((row) => {
        return {
          airDate: row.air_date,
          episodeNumber: row.episode_number,
          id: row.id,
          seasonNumber: row.season_number,
          sourceTitle: row.source_title
        }
      })
    })
  })

  it('enforces positive unique episode coordinates, source IDs and series parents', async () => {
    await assertDisposableTestDatabase(client)

    const chernobylId = await findCatalogItemId('Chernobyl')
    const movieId = await findCatalogItemId('Dead Man')
    const fixtureId = '70000000-0000-7000-8000-000000000001'

    await expect(client.query(`
      INSERT INTO catalog_external_links (provider, entity_type, external_id, catalog_episode_id)
      VALUES ('tvmaze', 'episode', '1594417', '30000000-0000-7000-8000-000000000002')
    `)).rejects.toMatchObject({ code: '23505' })

    await expect(client.query(`
      INSERT INTO catalog_episodes (id, catalog_item_id, season_number, episode_number)
      VALUES ($1, $2, 1, 1)
    `, [fixtureId, chernobylId])).rejects.toMatchObject({ code: '23505' })

    await expect(client.query(`
      INSERT INTO catalog_episodes (id, catalog_item_id, season_number, episode_number)
      VALUES ($1, $2, 0, 6)
    `, [fixtureId, chernobylId])).rejects.toMatchObject({ code: '23514' })

    await expect(client.query(`
      INSERT INTO catalog_episodes (id, catalog_item_id, season_number, episode_number)
      VALUES ($1, $2, 1, 1)
    `, [fixtureId, movieId])).rejects.toMatchObject({ code: '23514' })

    await expect(client.query(`
      UPDATE catalog_items SET type = 'movie' WHERE id = $1
    `, [chernobylId])).rejects.toMatchObject({ code: '23514' })
  })

  it('isolates accounts and stays independent from follows and movie watches', async () => {
    await assertDisposableTestDatabase(client)

    const firstUserId = '70000000-0000-7000-8000-000000000011'
    const secondUserId = '70000000-0000-7000-8000-000000000012'
    const chernobylId = await findCatalogItemId('Chernobyl')
    const movieId = await findCatalogItemId('Dead Man')
    const episodeId = '30000000-0000-7000-8000-000000000001'
    const database = createDatabase(client)

    try {
      await client.query(`
        INSERT INTO users (id, email)
        VALUES ($1, 'first-episode-watch@example.com'), ($2, 'second-episode-watch@example.com')
      `, [firstUserId, secondUserId])

      const markRequestId = crypto.randomUUID()

      const marked = await markSeriesEpisodeWatched(database, firstUserId, episodeId, {
        requestId: markRequestId,
        currentViewingId: null,
        contextVersion: 0,
        timeZone: 'UTC'
      })

      await followCatalogItem(database, secondUserId, chernobylId)

      await createMovieViewing(database, {
        userId: secondUserId,
        catalogItemId: movieId
      }, {
        requestId: crypto.randomUUID(),
        mode: 'history',
        startedOn: null,
        completedOn: null
      })

      await expect(findSeriesWatches(database, {
        userId: firstUserId,
        catalogItemId: chernobylId
      })).resolves.toStrictEqual(marked)

      expect(marked.watchedEpisodeIds).toStrictEqual([episodeId])

      await expect(findSeriesWatches(database, {
        userId: secondUserId,
        catalogItemId: chernobylId
      })).resolves.toStrictEqual({
        watchedEpisodeIds: [],
        watches: [],
        currentViewing: null,
        contextVersion: 0
      })
    } finally {
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[firstUserId, secondUserId]])
    }
  })

  it('keeps repeated marks idempotent, refreshes time after delete and allows future episodes', async () => {
    await assertDisposableTestDatabase(client)

    const userId = '70000000-0000-7000-8000-000000000021'
    const episodeId = '70000000-0000-7000-8000-000000000022'
    const chernobylId = await findCatalogItemId('Chernobyl')
    const database = createDatabase(client)

    try {
      await client.query(`
        INSERT INTO users (id, email) VALUES ($1, 'future-episode-watch@example.com')
      `, [userId])

      await client.query(`
        INSERT INTO catalog_episodes (
          id, catalog_item_id, season_number, episode_number, source_title, air_date
        ) VALUES ($1, $2, 2, 1, 'Future episode', '2099-01-01')
      `, [episodeId, chernobylId])

      const markRequestId = crypto.randomUUID()

      const marked = await markSeriesEpisodeWatched(database, userId, episodeId, {
        requestId: markRequestId,
        currentViewingId: null,
        contextVersion: 0,
        timeZone: 'UTC'
      })

      const viewingId = marked.currentViewing?.id
      const watchId = marked.watches[0]?.id

      assert(viewingId !== undefined)
      assert(watchId !== undefined)
      expect(marked.watchedEpisodeIds).toStrictEqual([episodeId])

      const initialTimestamp = await findMarkedAt(userId, episodeId)

      await client.query('SELECT pg_sleep(0.01)')

      const repeatRequestId = crypto.randomUUID()

      const repeated = await markSeriesEpisodeWatched(database, userId, episodeId, {
        requestId: repeatRequestId,
        currentViewingId: viewingId,
        contextVersion: marked.contextVersion,
        timeZone: 'UTC'
      })

      expect(repeated.watches).toStrictEqual(marked.watches)
      await expect(findMarkedAt(userId, episodeId)).resolves.toStrictEqual(initialTimestamp)

      const unwatch = {
        currentViewingId: viewingId,
        contextVersion: marked.contextVersion,
        watchId
      }

      const unmarked = await unmarkSeriesEpisodeWatched(database, userId, episodeId, unwatch)

      expect(unmarked.watchedEpisodeIds).toStrictEqual([])
      await expect(unmarkSeriesEpisodeWatched(database, userId, episodeId, unwatch)).resolves.toStrictEqual(unmarked)
      await client.query('SELECT pg_sleep(0.01)')

      const renewRequestId = crypto.randomUUID()

      const renewed = await markSeriesEpisodeWatched(database, userId, episodeId, {
        requestId: renewRequestId,
        currentViewingId: viewingId,
        contextVersion: marked.contextVersion,
        timeZone: 'UTC'
      })

      const renewedTimestamp = await findMarkedAt(userId, episodeId)

      expect(renewedTimestamp.getTime()).toBeGreaterThan(initialTimestamp.getTime())
      expect(renewed.watches[0]?.id).not.toBe(watchId)
    } finally {
      await client.query('DELETE FROM catalog_episodes WHERE id = $1', [episodeId])
      await client.query('DELETE FROM users WHERE id = $1', [userId])
    }
  })

  it('cascades watches when an account, episode or series is deleted', async () => {
    await assertDisposableTestDatabase(client)

    const userId = '70000000-0000-7000-8000-000000000031'
    const seriesId = '70000000-0000-7000-8000-000000000032'
    const episodeId = '70000000-0000-7000-8000-000000000033'
    const database = createDatabase(client)

    await client.query(`
      INSERT INTO users (id, email) VALUES ($1, 'cascade-episode-watch@example.com')
    `, [userId])

    await client.query(`
      INSERT INTO catalog_items (id, type, release_year) VALUES ($1, 'series', 2099)
    `, [seriesId])

    await client.query(`
      INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original)
      VALUES ($1, 'en', 'Disposable episode series', true)
    `, [seriesId])

    await client.query(`
      INSERT INTO catalog_episodes (id, catalog_item_id, season_number, episode_number)
      VALUES ($1, $2, 1, 1)
    `, [episodeId, seriesId])

    await client.query(`
      INSERT INTO catalog_external_links (provider, entity_type, external_id, catalog_episode_id)
      VALUES ('tvmaze', 'episode', '9000033', $1)
    `, [episodeId])

    const firstMarkRequestId = crypto.randomUUID()

    await markSeriesEpisodeWatched(database, userId, episodeId, {
      requestId: firstMarkRequestId,
      currentViewingId: null,
      contextVersion: 0,
      timeZone: 'UTC'
    })

    await client.query('DELETE FROM catalog_items WHERE id = $1', [seriesId])

    const afterSeriesDelete = await client.query<{ count: string }>(`
      SELECT count(*) FROM catalog_viewing_episode_watches WHERE user_id = $1
    `, [userId])

    const linksAfterSeriesDelete = await client.query<{ count: string }>(`
      SELECT count(*) FROM catalog_external_links
      WHERE provider = 'tvmaze' AND entity_type = 'episode' AND external_id = '9000033'
    `)

    expect(afterSeriesDelete.rows[0]?.count).toBe('0')
    expect(linksAfterSeriesDelete.rows[0]?.count).toBe('0')

    const nextMarkRequestId = crypto.randomUUID()

    await markSeriesEpisodeWatched(
      database,
      userId,
      '30000000-0000-7000-8000-000000000001',
      {
        requestId: nextMarkRequestId,
        currentViewingId: null,
        contextVersion: 0,
        timeZone: 'UTC'
      }
    )

    await client.query('DELETE FROM users WHERE id = $1', [userId])

    const afterUserDelete = await client.query<{ count: string }>(`
      SELECT count(*) FROM catalog_viewing_episode_watches WHERE user_id = $1
    `, [userId])

    expect(afterUserDelete.rows[0]?.count).toBe('0')
  })
})
