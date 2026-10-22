import { randomUUID } from 'node:crypto'
import { env } from 'node:process'
import { Client } from 'pg'
import { afterAll, afterEach, assert, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ratingFixture, requireRatingViewing, titleTarget } from '../../../testing/rating-fixtures.ts'
import { insertSeriesEpisodeWatches } from '../../../testing/series-watch-fixtures.ts'
import { findViewingHistory, findViewingSummary } from '../../viewing-repository.ts'
import { createViewing, deleteViewing, updateViewing } from '../../viewings-repository.ts'
import { setHistoricalCatalogRating } from '../../rating-mutations.ts'

const fixture = ratingFixture()
const { client, database, userId, otherUserId, movieId, seriesId, episodeId } = fixture

const scope = {
  userId,
  status: null,
  titleLocale: 'en'
} as const

const extraSeriesIds = Array.from({ length: 6 }, () => randomUUID())

async function seedMovies(count = 24): Promise<string[]> {
  const result = await client.query<{ id: string }>(`
    INSERT INTO catalog_viewings (user_id, catalog_item_id, completed_on)
    SELECT $1, $2, '2026-09-22'::date FROM generate_series(1, $3)
    RETURNING id
  `, [userId, movieId, count])

  return result.rows.map(row => row.id).toSorted((left, right) => right.localeCompare(left))
}

describe('private viewing data', () => {
  beforeAll(async () => {
    await fixture.setup()
    await client.query(`INSERT INTO catalog_items (id, type) SELECT unnest($1::uuid[]), 'series'`, [extraSeriesIds])

    await client.query(`INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original)
      SELECT unnest($1::uuid[]), 'en', 'Active series', true`, [extraSeriesIds])

    await client.query(`INSERT INTO catalog_item_titles (catalog_item_id, locale, title)
      SELECT unnest($1::uuid[]), 'ru', 'Перевод'`, [[movieId, seriesId, ...extraSeriesIds]])
  })

  beforeEach(fixture.reset)
  afterEach(() => { vi.restoreAllMocks() })

  afterAll(async () => {
    await client.query('DELETE FROM catalog_items WHERE id = ANY($1::uuid[])', [extraSeriesIds])
    await fixture.cleanup()
  })

  it('returns separate mixed viewings with their own scores, never retained votes or child ratings', async () => {
    const original = await fixture.save(movieId, titleTarget, 8)
    const first = requireRatingViewing(original)

    const rewatch = await createViewing(database, {
      userId,
      catalogItemId: movieId
    }, {
      mode: 'current',
      status: 'completed',
      currentViewingId: first.id,
      requestId: randomUUID(),
      contextVersion: original.summary.contextVersion,
      startedOn: null,
      completedOn: '2026-10-01'
    })

    await setHistoricalCatalogRating(database, {
      userId,
      catalogItemId: movieId,
      viewingId: first.id
    }, titleTarget, {
      requestId: randomUUID(),
      revision: first.revision,
      score: 4,
      timeZone: 'UTC'
    })

    const series = await fixture.save(seriesId, fixture.episodeTarget, 10)
    const seriesViewing = requireRatingViewing(series)

    await fixture.save(movieId, titleTarget, 2, otherUserId)

    const page = await findViewingHistory(database, scope, null)

    const localized = await findViewingHistory(database, {
      ...scope,
      titleLocale: 'ru'
    }, null)

    const context = await client.query('SELECT * FROM catalog_viewing_contexts WHERE user_id = $1', [userId])
    const votes = await client.query('SELECT score FROM catalog_rating_votes WHERE user_id = $1 AND catalog_item_id = $2', [userId, movieId])

    expect(page.items).toHaveLength(3)

    expect(page.items.map(item => [item.viewingId, item.score])).toStrictEqual([
      [rewatch.viewing.id, null],
      [seriesViewing.id, null],
      [first.id, 4]
    ])

    expect(page.items.find(item => item.viewingId === first.id)).toMatchObject({
      type: 'movie',
      status: 'completed',
      startedOn: null,
      completedOn: '2026-01-15'
    })

    expect(page.items.find(item => item.viewingId === seriesViewing.id)).toMatchObject({
      type: 'series',
      status: 'watching',
      startedOn: '2026-01-15',
      completedOn: null
    })

    expect(localized.items.every(item => item.title === 'Перевод')).toBe(true)
    expect(votes.rows).toStrictEqual([{ score: 8 }])
    await findViewingHistory(database, scope, null)
    await findViewingSummary(database, userId, 'en')

    const unchanged = await client.query('SELECT * FROM catalog_viewing_contexts WHERE user_id = $1', [userId])

    expect(unchanged.rows).toStrictEqual(context.rows)

    const other = await findViewingHistory(database, {
      ...scope,
      userId: otherUserId
    }, null)

    expect(other.items).toHaveLength(1)
    expect(other.items[0]?.score).toBe(2)
  })

  it('bounds identities before translations and pages equal calendar dates without gaps or duplicates', async () => {
    const ids = await seedMovies()

    const first = await findViewingHistory(database, {
      ...scope,
      titleLocale: 'ru'
    }, null)

    const next = await findViewingHistory(database, {
      ...scope,
      titleLocale: 'ru'
    }, first.nextCursor)

    expect(first.items).toHaveLength(20)
    expect(next.items).toHaveLength(4)
    expect([...first.items, ...next.items].map(item => item.viewingId)).toStrictEqual(ids)
    expect(first.items.every(item => item.titleLocale === 'ru')).toBe(true)
    expect(next.nextCursor).toBeNull()

    await expect(findViewingHistory(database, {
      ...scope,
      userId: otherUserId,
      titleLocale: 'ru'
    }, first.nextCursor)).rejects.toMatchObject({ status: 400 })

    await expect(findViewingHistory(database, scope, first.nextCursor)).rejects.toMatchObject({ status: 400 })

    await expect(findViewingHistory(database, {
      ...scope,
      status: 'completed',
      titleLocale: 'ru'
    }, first.nextCursor)).rejects.toMatchObject({ status: 400 })
  })

  it('filters both states while summary counts all viewings and bounds active series independently of follows', async () => {
    await seedMovies(2)

    await insertSeriesEpisodeWatches(client, userId, {
      episodeIds: [episodeId],
      status: 'completed',
      markedAt: '2020-01-01T00:00:00Z'
    })

    const activeWatches = await insertSeriesEpisodeWatches(client, userId, {
      episodeIds: [episodeId],
      markedAt: '2026-01-01T00:00:00Z'
    })

    await client.query(`INSERT INTO catalog_viewings (user_id, catalog_item_id, status, started_on)
      SELECT $1, unnest($2::uuid[]), 'watching', '2025-01-01'::date`, [userId, extraSeriesIds.slice(0, 6)])

    const expectedActive = await client.query<{ id: string }>('SELECT id FROM catalog_viewings WHERE user_id = $1 AND status = \'watching\' ORDER BY started_on DESC, id DESC LIMIT 5', [userId])

    const watching = await findViewingHistory(database, {
      ...scope,
      status: 'watching'
    }, null)

    const completed = await findViewingHistory(database, {
      ...scope,
      status: 'completed'
    }, null)

    const summary = await findViewingSummary(database, userId, 'ru')
    const empty = await findViewingSummary(database, otherUserId, 'en')

    expect(watching.items).toHaveLength(7)
    expect(watching.items.every(item => item.status === 'watching')).toBe(true)
    expect(watching.items.every(item => item.type === 'series')).toBe(true)
    expect(completed.items).toHaveLength(3)
    expect(completed.items.every(item => item.status === 'completed')).toBe(true)

    expect(summary).toMatchObject({
      watchedMovieCount: 2,
      watchedEpisodeCount: 2,
      completedSeriesCount: 1,
      watchingSeriesCount: 7
    })

    expect(summary.activeSeries.map(item => item.viewingId)).toStrictEqual(expectedActive.rows.map(row => row.id))
    expect(summary.activeSeries.map(item => item.watchedEpisodeCount)).toStrictEqual([1, 0, 0, 0, 0])
    expect(summary.activeSeries.every(item => item.titleLocale === 'ru')).toBe(true)

    expect(empty).toStrictEqual({
      watchedMovieCount: 0,
      watchedEpisodeCount: 0,
      completedSeriesCount: 0,
      watchingSeriesCount: 0,
      activeSeries: []
    })

    await client.query('DELETE FROM catalog_viewing_episode_watches WHERE id = $1', [activeWatches[0]?.id])

    const afterUnmark = await findViewingSummary(database, userId, 'en')
    const afterHistory = await findViewingHistory(database, scope, null)

    expect(afterUnmark.watchedEpisodeCount).toBe(1)
    expect(afterUnmark.activeSeries[0]?.watchedEpisodeCount).toBe(0)
    expect(afterHistory.items).toHaveLength(10)
  })

  it.each(['date', 'score', 'delete', 'add'] as const)('requires refresh after a viewing %s change, including an unseen row', async change => {
    const ids = await seedMovies()
    const oldestId = ids.at(-1)

    assert(oldestId !== undefined)

    const first = await findViewingHistory(database, scope, null)

    const owner = {
      userId,
      catalogItemId: movieId,
      viewingId: oldestId
    }

    // oxlint-disable-next-line vitest/no-conditional-in-test -- Each named case applies one distinct real mutation before the same cursor assertions.
    switch (change) {
      case 'date': {
        await updateViewing(database, owner, {
          requestId: randomUUID(),
          currentViewingId: null,
          contextVersion: 0,
          revision: 1,
          status: 'completed',
          startedOn: null,
          completedOn: '2026-10-01'
        })

        break
      }
      case 'score': {
        await setHistoricalCatalogRating(database, owner, titleTarget, {
          requestId: randomUUID(),
          revision: 1,
          score: 9,
          timeZone: 'UTC'
        })

        break
      }
      case 'delete': {
        await deleteViewing(database, owner, {
          requestId: randomUUID(),
          revision: 1
        })

        break
      }
      case 'add': {
        await createViewing(database, owner, {
          requestId: randomUUID(),
          mode: 'history',
          currentViewingId: null,
          contextVersion: 0,
          status: 'completed',
          startedOn: null,
          completedOn: '2026-10-01'
        })

        break
      }
    }

    await expect(findViewingHistory(database, scope, first.nextCursor)).rejects.toMatchObject({
      status: 400,
      fields: { cursor: 'Your viewings changed. Refresh history.' }
    })

    const refreshed = await findViewingHistory(database, scope, null)
    const next = await findViewingHistory(database, scope, refreshed.nextCursor)
    const expected = await client.query<{ id: string }>('SELECT id FROM catalog_viewings WHERE user_id = $1 ORDER BY coalesce(completed_on, started_on) DESC, id DESC', [userId])

    expect([...refreshed.items, ...next.items].map(item => item.viewingId)).toStrictEqual(expected.rows.map(row => row.id))
  })

  it('reads summary counts and active progress in one snapshot across a concurrent commit', async () => {
    const writer = new Client({ connectionString: env.TEST_DATABASE_URL })
    const execute = database.execute.bind(database)

    await writer.connect()

    try {
      vi.spyOn(database, 'execute').mockImplementationOnce(<Row extends Record<string, unknown>>(query: Parameters<typeof database.execute>[0]) => {
        const statement = execute<Row>(query)
        const run = statement.execute.bind(statement)

        vi.spyOn(statement, 'execute').mockImplementationOnce(async () => {
          const result = await run()

          await insertSeriesEpisodeWatches(writer, userId, { episodeIds: [episodeId] })

          return result
        })

        return statement
      })

      const before = await findViewingSummary(database, userId, 'en')
      const after = await findViewingSummary(database, userId, 'en')

      expect(before).toMatchObject({
        watchingSeriesCount: 0,
        watchedEpisodeCount: 0,
        activeSeries: []
      })

      expect(after).toMatchObject({
        watchingSeriesCount: 1,
        watchedEpisodeCount: 1,
        activeSeries: [{ watchedEpisodeCount: 1 }]
      })
    } finally {
      await writer.end()
    }
  })
})
