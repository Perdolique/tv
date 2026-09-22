import { env } from 'node:process'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { afterAll, assert, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'
import { createViewingHistoryResponse, decodeViewingCursor } from '../../viewing-history.ts'
import { findViewingHistoryRows, findViewingSummary } from '../../viewing-repository.ts'
import { markCatalogMovieWatched, unmarkCatalogMovieWatched } from '../../watched-repository.ts'

const userId = '52000000-0000-7000-8000-000000000001'
const otherUserId = '52000000-0000-7000-8000-000000000002'
const client = new Client({ connectionString: env.TEST_DATABASE_URL })
const database = createDatabase(client)

async function seedMarks(): Promise<void> {
  await client.query(`
    INSERT INTO catalog_movie_watches (user_id, catalog_item_id, marked_at)
    SELECT $1, id, '2026-09-22T13:00:00.123456Z'::timestamptz
    FROM catalog_items WHERE type = 'movie' ORDER BY id LIMIT 2
  `, [userId])

  await client.query(`
    INSERT INTO catalog_episode_watches (user_id, catalog_episode_id, marked_at)
    SELECT $1, id, '2026-09-22T13:00:00.123456Z'::timestamptz
    FROM catalog_episodes ORDER BY id LIMIT 23
  `, [userId])
}

describe('private viewing data', () => {
  beforeAll(async () => {
    if (env.TEST_DATABASE_URL === undefined || env.TEST_DATABASE_URL === '') {
      throw new Error('TEST_DATABASE_URL is required')
    }

    await client.connect()
    await assertDisposableTestDatabase(client)
  })

  beforeEach(async () => {
    await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId, otherUserId]])
    await client.query('INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)', [userId, 'viewing@example.com', otherUserId, 'other-viewing@example.com'])
  })

  afterAll(async () => {
    await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId, otherUserId]])
    await client.end()
  })

  it('counts marks without follows, without multiplying translations, and isolates accounts', async () => {
    await seedMarks()

    const summary = await findViewingSummary(database, userId, 'ru')
    const other = await findViewingSummary(database, otherUserId, 'en')
    const otherHistory = await findViewingHistoryRows(database, otherUserId, null)

    expect(summary.watchedMovieCount).toBe(2)
    expect(summary.watchedEpisodeCount).toBe(23)
    expect(summary.series.reduce((total, series) => total + series.watchedEpisodeCount, 0)).toBe(23)
    expect(new Set(summary.series.map(series => series.id)).size).toBe(summary.series.length)
    expect(summary.series.every(series => series.titleLocale === 'ru')).toBe(true)

    expect(other).toStrictEqual({
      watchedMovieCount: 0,
      watchedEpisodeCount: 0,
      series: []
    })

    expect(otherHistory).toStrictEqual([])
  })

  it('counts each series and orders equal marks by title ID before a newer mark', async () => {
    const episodes = await client.query<{ id: string; catalog_item_id: string }>(`
      SELECT id, catalog_item_id FROM catalog_episodes
      WHERE catalog_item_id IN (SELECT catalog_item_id FROM catalog_episodes GROUP BY catalog_item_id HAVING count(*) >= 2 ORDER BY catalog_item_id LIMIT 2)
      ORDER BY catalog_item_id, id
    `)

    const [firstSeriesEpisode, anotherFirstSeriesEpisode] = episodes.rows

    assert(firstSeriesEpisode !== undefined, 'First series fixture is missing')
    assert(anotherFirstSeriesEpisode !== undefined, 'Extra episode fixture is missing')

    const secondSeriesEpisode = episodes.rows.find(episode => episode.catalog_item_id !== firstSeriesEpisode.catalog_item_id)

    assert(secondSeriesEpisode !== undefined, 'Second series fixture is missing')

    await client.query(`
      INSERT INTO catalog_episode_watches (user_id, catalog_episode_id, marked_at)
      SELECT $1, unnest($2::uuid[]), '2026-09-22T13:00:00.123456Z'::timestamptz
    `, [userId, [firstSeriesEpisode.id, secondSeriesEpisode.id, anotherFirstSeriesEpisode.id]])

    const tied = await findViewingSummary(database, userId, 'en')

    expect(tied.series.map(series => [series.id, series.watchedEpisodeCount])).toStrictEqual([
      [secondSeriesEpisode.catalog_item_id, 1],
      [firstSeriesEpisode.catalog_item_id, 2]
    ])

    await client.query(`
      UPDATE catalog_episode_watches SET marked_at = '2026-09-22T13:00:00.123457Z'
      WHERE user_id = $1 AND catalog_episode_id = $2
    `, [userId, firstSeriesEpisode.id])

    const newer = await findViewingSummary(database, userId, 'en')

    expect(newer.series.map(series => series.id)).toStrictEqual([firstSeriesEpisode.catalog_item_id, secondSeriesEpisode.catalog_item_id])
    expect(newer.watchedEpisodeCount).toBe(3)
  })

  it('keeps one summary consistent when another client commits a mark between reads', async () => {
    const writer = new Client({ connectionString: env.TEST_DATABASE_URL })
    const execute = database.execute.bind(database)

    await writer.connect()

    try {
      vi.spyOn(database, 'execute').mockImplementationOnce(<Row extends Record<string, unknown>>(query: Parameters<typeof database.execute>[0]) => {
        const statement = execute<Row>(query)
        const run = statement.execute.bind(statement)

        vi.spyOn(statement, 'execute').mockImplementationOnce(async () => {
          const result = await run()

          // Commit after the first read, before a possible second read in the same response.
          await writer.query(`INSERT INTO catalog_episode_watches (user_id, catalog_episode_id)
            SELECT $1, id FROM catalog_episodes ORDER BY id LIMIT 1`, [userId])

          return result
        })

        return statement
      })

      const beforeCommit = await findViewingSummary(database, userId, 'en')
      const afterCommit = await findViewingSummary(database, userId, 'en')

      expect(beforeCommit).toStrictEqual({
        watchedMovieCount: 0,
        watchedEpisodeCount: 0,
        series: []
      })

      expect(afterCommit.watchedEpisodeCount).toBe(1)
      expect(afterCommit.series).toHaveLength(1)
      expect(afterCommit.series[0]?.watchedEpisodeCount).toBe(1)
    } finally {
      vi.restoreAllMocks()
      await writer.end()
    }
  })

  it('keeps ties across pages and allows a removed cursor row', async () => {
    await seedMarks()

    const firstRows = await findViewingHistoryRows(database, userId, null)
    const first = createViewingHistoryResponse(firstRows, 'en')
    const cursor = decodeViewingCursor(first.nextCursor)

    expect(first.items).toHaveLength(20)
    expect(first.items.every(item => item.kind === 'episode')).toBe(true)
    expect(cursor).not.toBeNull()
    await client.query('DELETE FROM catalog_episode_watches WHERE user_id = $1 AND catalog_episode_id = $2', [userId, cursor?.entryId])

    const nextRows = await findViewingHistoryRows(database, userId, cursor)
    const next = createViewingHistoryResponse(nextRows, 'en')
    const allItems = [...first.items, ...next.items]

    expect(next.items.map(item => item.kind)).toStrictEqual(['episode', 'episode', 'episode', 'movie', 'movie'])
    expect(next.nextCursor).toBeNull()
    expect(new Set(allItems.map(item => `${item.kind}:${item.entryId}`)).size).toBe(25)

    const expectedEpisodes = await client.query<{ id: string }>('SELECT id FROM catalog_episodes ORDER BY id LIMIT 23')
    const descendingIds = expectedEpisodes.rows.map(row => row.id).toReversed()

    expect(allItems.filter(item => item.kind === 'episode').map(item => item.entryId)).toStrictEqual(descendingIds)
  })

  it('keeps existing marks and timestamp precision when the new indexes are applied', async () => {
    await seedMarks()

    const before = await findViewingHistoryRows(database, userId, null)
    const migrationUrl = new URL('../../../../../../packages/database/migrations/20260922150414_slippery_northstar/migration.sql', import.meta.url)
    const migration = await readFile(migrationUrl, 'utf8')

    await client.query('BEGIN')

    try {
      await client.query('DROP INDEX catalog_movie_watches_user_marked_at_item_index, catalog_episode_watches_user_marked_at_episode_index')
      await client.query(migration)

      const after = await findViewingHistoryRows(database, userId, null)

      const indexes = await client.query<{ indexname: string; indexdef: string }>(`
        SELECT indexname, indexdef FROM pg_indexes WHERE indexname IN
          ('catalog_movie_watches_user_marked_at_item_index', 'catalog_episode_watches_user_marked_at_episode_index')
        ORDER BY indexname
      `)

      expect(after).toStrictEqual(before)

      expect(indexes.rows).toStrictEqual([
        {
          indexname: 'catalog_episode_watches_user_marked_at_episode_index',
          indexdef: 'CREATE INDEX catalog_episode_watches_user_marked_at_episode_index ON public.catalog_episode_watches USING btree (user_id, marked_at DESC NULLS LAST, catalog_episode_id DESC NULLS LAST)'
        },
        {
          indexname: 'catalog_movie_watches_user_marked_at_item_index',
          indexdef: 'CREATE INDEX catalog_movie_watches_user_marked_at_item_index ON public.catalog_movie_watches USING btree (user_id, marked_at DESC NULLS LAST, catalog_item_id DESC NULLS LAST)'
        }
      ])
    } finally {
      await client.query('ROLLBACK')
    }
  })

  it('does not lose marks separated by microseconds at the page boundary', async () => {
    await seedMarks()

    await client.query(`
      UPDATE catalog_episode_watches SET marked_at = '2026-09-22T13:00:00.123455Z'
      WHERE user_id = $1 AND catalog_episode_id IN
        (SELECT catalog_episode_id FROM catalog_episode_watches WHERE user_id = $1 ORDER BY catalog_episode_id LIMIT 3)
    `, [userId])

    const firstRows = await findViewingHistoryRows(database, userId, null)
    const first = createViewingHistoryResponse(firstRows, 'en')
    const cursor = decodeViewingCursor(first.nextCursor)
    const secondRows = await findViewingHistoryRows(database, userId, cursor)
    const second = createViewingHistoryResponse(secondRows, 'en')

    expect(cursor?.markedAt).toBe('2026-09-22T13:00:00.123456Z')
    expect(second.items).toHaveLength(5)
    expect(second.items.slice(0, 2).every(item => item.kind === 'movie')).toBe(true)
    expect(second.items.slice(2).every(item => item.markedAt === '2026-09-22T13:00:00.123455Z')).toBe(true)
    expect(second.nextCursor).toBeNull()
  })

  it('removes unmarked entries and dates a new mark without changing an existing mark', async () => {
    await seedMarks()

    const movie = await client.query<{ catalog_item_id: string }>('SELECT catalog_item_id FROM catalog_movie_watches WHERE user_id = $1 ORDER BY catalog_item_id LIMIT 1', [userId])
    const id = movie.rows[0]?.catalog_item_id

    assert(id !== undefined, 'Movie fixture is missing')
    await markCatalogMovieWatched(database, userId, id)

    const unchanged = await client.query<{ marked_at: string }>('SELECT marked_at::text FROM catalog_movie_watches WHERE user_id = $1 AND catalog_item_id = $2', [userId, id])

    expect(unchanged.rows[0]?.marked_at).toContain('13:00:00.123456')
    await unmarkCatalogMovieWatched(database, userId, id)

    const summary = await findViewingSummary(database, userId, 'en')

    expect(summary.watchedMovieCount).toBe(1)
    await markCatalogMovieWatched(database, userId, id)

    const updated = await findViewingHistoryRows(database, userId, null)
    const response = createViewingHistoryResponse(updated, 'en')

    expect(response.items[0]?.entryId).toBe(id)
    expect(response.items[0]?.markedAt).not.toBe('2026-09-22T13:00:00.123456Z')
  })
})
