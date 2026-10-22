/* oxlint-disable eslint/max-lines -- PostgreSQL fixtures cover stable grouping, calendar invalidation and bounded pagination together. */
import { env } from 'node:process'
import assert from 'node:assert/strict'
import { createDatabase } from '@tv/database'
import { catalogTimelineResponseSchema } from '@tv/shared/catalog-timeline'
import { Client } from 'pg'
import * as v from 'valibot'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'
import { findCatalogTimeline } from '../../timeline-repository.ts'
import { findViewings } from '../../viewings-repository.ts'
import { findViewingHistory } from '../../viewing-repository.ts'

const userId = '93000000-0000-4000-8000-000000000011'
const otherUserId = '93000000-0000-4000-8000-000000000012'
const seriesId = '93000000-0000-4000-8000-000000000013'
const movieId = '93000000-0000-4000-8000-000000000014'
const client = new Client({ connectionString: env.TEST_DATABASE_URL })
const database = createDatabase(client)

const owner = {
  userId,
  catalogItemId: seriesId
}

interface WatchSeed {
  viewingId: string;
  timestamp: string;
  episodeNumbers: number[];
  seasonNumber?: number;
}

async function seedViewing(status: 'watching' | 'completed' = 'watching'): Promise<string> {
  const completedOn = status === 'completed' ? '2026-10-31' : null

  const result = await client.query<{ id: string }>(`
    INSERT INTO catalog_viewings (user_id, catalog_item_id, status, started_on, completed_on)
    VALUES ($1, $2, $3, '2026-10-01', $4) RETURNING id
  `, [userId, seriesId, status, completedOn])

  const id = result.rows[0]?.id

  assert.ok(id !== undefined, 'Series viewing fixture is missing')

  return id
}

async function seedWatches(seed: WatchSeed): Promise<void> {
  await client.query(`
    WITH marks AS (
      INSERT INTO catalog_viewing_episode_watches (user_id, catalog_item_id, viewing_id, catalog_episode_id, marked_at)
      SELECT $1, $2, $3, id, $4::timestamptz FROM catalog_episodes
      WHERE catalog_item_id = $2 AND season_number = $5 AND episode_number = ANY($6::integer[]) RETURNING *
    )
    INSERT INTO catalog_timeline_events (user_id, catalog_item_id, kind, viewing_id, watch_id, catalog_episode_id, occurred_at)
    SELECT user_id, catalog_item_id, 'episode_watched', viewing_id, id, catalog_episode_id, marked_at FROM marks
  `, [userId, seriesId, seed.viewingId, seed.timestamp, seed.seasonNumber ?? 1, seed.episodeNumbers])
}

async function seedMilestones(viewingId: string, count: number, timestamp = '2026-10-01T12:00:00.123456Z'): Promise<void> {
  await client.query(`
    INSERT INTO catalog_timeline_events (user_id, catalog_item_id, viewing_id, kind, season_number, episode_ids, occurred_at)
    SELECT $1, $2, $3, 'season_completed', 1, jsonb_build_array((SELECT id FROM catalog_episodes WHERE catalog_item_id = $2 LIMIT 1)), $5::timestamptz
    FROM generate_series(1, $4::integer)
  `, [userId, seriesId, viewingId, count, timestamp])
}

interface SeededMovieDay {
  id: string;
  day: string;
}

async function seedMovieDays(days: string[]): Promise<SeededMovieDay[]> {
  const result = await client.query<SeededMovieDay>(`
    WITH viewings AS (
      INSERT INTO catalog_viewings (user_id, catalog_item_id, status, completed_on, recorded_at)
      SELECT $1, $2, 'completed', day, '2026-10-17T12:00:00Z'::timestamptz - number * interval '1 minute'
      FROM unnest($3::date[]) WITH ORDINALITY AS days(day, number)
      RETURNING id, user_id, catalog_item_id, completed_on, recorded_at
    ), events AS (
      INSERT INTO catalog_timeline_events (id, user_id, catalog_item_id, viewing_id, kind, occurred_at)
      SELECT id, user_id, catalog_item_id, id, 'movie_viewing', recorded_at FROM viewings RETURNING viewing_id
    )
    SELECT viewings.id, completed_on::text AS day FROM viewings JOIN events ON events.viewing_id = viewings.id
  `, [userId, movieId, days])

  return result.rows
}

describe('private title timeline reads', () => {
  beforeAll(async () => {
    if (env.TEST_DATABASE_URL === undefined || env.TEST_DATABASE_URL === '') {
      throw new Error('TEST_DATABASE_URL is required')
    }

    await client.connect()
    await assertDisposableTestDatabase(client)
  })

  beforeEach(async () => {
    await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId, otherUserId]])
    await client.query('DELETE FROM catalog_items WHERE id = ANY($1::uuid[])', [[seriesId, movieId]])
    await client.query('INSERT INTO users (id, email) VALUES ($1, \'timeline@example.com\'), ($2, \'other-timeline@example.com\')', [userId, otherUserId])
    await client.query('INSERT INTO catalog_items (id, type) VALUES ($1, \'series\'), ($2, \'movie\')', [seriesId, movieId])
    await client.query('INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original) VALUES ($1, \'en\', \'Timeline series\', true), ($2, \'en\', \'Timeline movie\', true)', [seriesId, movieId])

    await client.query(`
      INSERT INTO catalog_episodes (catalog_item_id, season_number, episode_number, source_title)
      SELECT $1::uuid, 1, number, 'Episode ' || number FROM generate_series(1, 28) number
      UNION ALL SELECT $1::uuid, 2, number, null FROM unnest(ARRAY[1, 3]) number
    `, [seriesId])
  })

  afterAll(async () => {
    await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId, otherUserId]])
    await client.query('DELETE FROM catalog_items WHERE id = ANY($1::uuid[])', [[seriesId, movieId]])
    await client.end()
  })

  it('groups a complete day before paging and preserves episode gaps by season', async () => {
    // Arrange
    const viewingId = await seedViewing()
    const episodeNumbers = Array.from({ length: 28 }, (_value, index) => index + 1)

    await seedWatches({
      viewingId,
      timestamp: '2026-10-25T01:30:00.123456Z',
      episodeNumbers
    })

    await seedWatches({
      viewingId,
      timestamp: '2026-10-25T01:30:00.123456Z',
      seasonNumber: 2,
      episodeNumbers: [1, 3]
    })

    await seedMilestones(viewingId, 23)

    // Act
    const first = await findCatalogTimeline(database, owner, { timeZone: 'Europe/Tallinn' })
    const [group] = first.items

    assert.ok(group?.kind === 'episode_group', 'Expected the complete episode group')
    assert.ok(first.nextCursor !== null, 'Expected a next timeline page')

    const next = await findCatalogTimeline(database, owner, {
      timeZone: 'Europe/Tallinn',
      cursor: first.nextCursor
    })

    const validTimeline = v.is(catalogTimelineResponseSchema, first)

    // Assert
    expect(validTimeline).toBe(true)
    expect(first.items).toHaveLength(20)
    expect(group.totalCount).toBe(30)
    expect(group.id).toBe(`episode_group:${viewingId}:2026-10-25`)

    expect(group.seasons).toStrictEqual([
      {
        seasonNumber: 1,

        ranges: [{
          firstEpisodeNumber: 1,
          lastEpisodeNumber: 28
        }]
      },
      {
        seasonNumber: 2,

        ranges: [{
          firstEpisodeNumber: 1,
          lastEpisodeNumber: 1
        }, {
          firstEpisodeNumber: 3,
          lastEpisodeNumber: 3
        }]
      }
    ])

    expect(next.items).toHaveLength(4)
    expect(next.nextCursor).toBeNull()
  })

  it('uses local midnight across DST and separates repeated viewings of one episode', async () => {
    // Arrange
    const firstViewing = await seedViewing('completed')
    const secondViewing = await seedViewing()
    const timestamps = ['2026-10-24T20:59:59.999999Z', '2026-10-24T21:00:00.000000Z', '2026-10-25T00:30:00.123456Z', '2026-10-25T01:30:00.123456Z', '2026-10-25T22:00:00.000000Z']

    for (const [index, timestamp] of timestamps.entries()) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- One PostgreSQL client executes its fixture writes serially.
      await seedWatches({
        viewingId: firstViewing,
        timestamp,
        episodeNumbers: [index + 1]
      })
    }

    await seedWatches({
      viewingId: secondViewing,
      timestamp: '2026-10-25T01:30:00.123456Z',
      episodeNumbers: [1]
    })

    // Act
    const timeline = await findCatalogTimeline(database, owner, { timeZone: 'Europe/Tallinn' })
    const groups = timeline.items.filter(item => item.kind === 'episode_group')
    const firstGroups = groups.filter(item => item.viewingId === firstViewing)
    const counts = firstGroups.map(item => [item.localDate, item.totalCount])
    const secondGroup = groups.find(item => item.viewingId === secondViewing)

    // Assert
    expect(counts).toStrictEqual([['2026-10-26', 1], ['2026-10-25', 3], ['2026-10-24', 1]])

    expect(secondGroup).toMatchObject({
      localDate: '2026-10-25',
      totalCount: 1
    })
  })

  it('keeps a group identity and page position after deleting its latest mark and revisiting an old viewing', async () => {
    // Arrange
    const olderViewing = await seedViewing('completed')
    const newerViewing = await seedViewing()

    await seedWatches({
      viewingId: olderViewing,
      timestamp: '2026-10-25T02:00:00.123456Z',
      episodeNumbers: [1]
    })

    await seedWatches({
      viewingId: olderViewing,
      timestamp: '2026-10-25T01:00:00.123456Z',
      episodeNumbers: [2]
    })

    await seedWatches({
      viewingId: newerViewing,
      timestamp: '2026-10-24T01:00:00.123456Z',
      episodeNumbers: [1]
    })

    await seedMilestones(newerViewing, 43)

    const first = await findCatalogTimeline(database, owner, { timeZone: 'Europe/Tallinn' })
    const [group] = first.items

    assert.ok(group?.kind === 'episode_group', 'Expected the old viewing group')
    assert.ok(first.nextCursor !== null, 'Expected a next timeline page')

    await client.query(`DELETE FROM catalog_viewing_episode_watches WHERE viewing_id = $1
      AND catalog_episode_id = (SELECT id FROM catalog_episodes WHERE catalog_item_id = $2 AND season_number = 1 AND episode_number = 1)`, [olderViewing, seriesId])

    await seedWatches({
      viewingId: olderViewing,
      timestamp: '2026-10-25T03:00:00.123456Z',
      episodeNumbers: [3]
    })

    // Act
    const refreshed = await findCatalogTimeline(database, owner, { timeZone: 'Europe/Tallinn' })

    const second = await findCatalogTimeline(database, owner, {
      timeZone: 'Europe/Tallinn',
      cursor: first.nextCursor
    })

    assert.ok(second.nextCursor !== null, 'Expected a third timeline page')

    const third = await findCatalogTimeline(database, owner, {
      timeZone: 'Europe/Tallinn',
      cursor: second.nextCursor
    })

    const items = [...first.items, ...second.items, ...third.items]
    const ids = items.map(item => item.id)
    const uniqueIds = new Set(ids)
    const groups = items.filter(item => item.kind === 'episode_group')
    const groupKeys = groups.map(item => item.id)

    // Assert
    expect(refreshed.items[0]).toMatchObject({
      id: group.id,
      occurredAt: group.occurredAt,
      totalCount: 2
    })

    expect(ids).toHaveLength(45)
    expect(uniqueIds.size).toBe(45)
    expect(groupKeys).toStrictEqual([`episode_group:${olderViewing}:2026-10-25`, `episode_group:${newerViewing}:2026-10-24`])
    expect(third.nextCursor).toBeNull()
  })

  it('pages microsecond ties after boundary deletion and excludes new source events', async () => {
    // Arrange
    const viewingId = await seedViewing()

    await seedMilestones(viewingId, 23)

    await client.query(`UPDATE catalog_timeline_events SET occurred_at = '2026-10-01T12:00:00.123455Z'
      WHERE user_id = $1 AND id IN (SELECT id FROM catalog_timeline_events WHERE user_id = $1 ORDER BY id LIMIT 3)`, [userId])

    const expected = await client.query<{ id: string }>('SELECT id FROM catalog_timeline_events WHERE user_id = $1 ORDER BY occurred_at DESC, id DESC', [userId])
    const first = await findCatalogTimeline(database, owner, { timeZone: 'UTC' })

    assert.ok(first.nextCursor !== null, 'Timeline cursor is missing')
    await client.query('DELETE FROM catalog_timeline_events WHERE id = $1', [first.items.at(-1)?.id])
    await client.query('DELETE FROM catalog_timeline_events WHERE id = $1', [first.items[0]?.id])
    await seedMilestones(viewingId, 1, '2026-10-01T12:00:00.123457Z')

    // Act
    const next = await findCatalogTimeline(database, owner, {
      timeZone: 'UTC',
      cursor: first.nextCursor
    })

    const ids = [...first.items, ...next.items].map(item => item.id)
    const expectedIds = expected.rows.map(row => row.id)

    // Assert
    expect(next.items).toHaveLength(3)
    expect(ids).toStrictEqual(expectedIds)
    expect(next.nextCursor).toBeNull()
  })

  it.each(['series_started', 'rewatch_started'] as const)('uses viewing dates and live item scores for movies, %s and completion rows', async startKind => {
    // Arrange
    const viewingId = await seedViewing('completed')

    await client.query(`INSERT INTO catalog_timeline_events (user_id, catalog_item_id, viewing_id, kind, occurred_at)
      VALUES ($1, $2, $3, $4, '2026-10-15'), ($1, $2, $3, 'series_completed', '2026-10-16')`, [userId, seriesId, viewingId, startKind])

    await client.query('INSERT INTO catalog_item_ratings (user_id, catalog_item_id, viewing_id, score) VALUES ($1, $2, $3, 7)', [userId, seriesId, viewingId])

    const movie = await client.query<{ id: string }>(`INSERT INTO catalog_viewings (user_id, catalog_item_id, status, completed_on)
      VALUES ($1, $2, 'completed', '2024-02-29') RETURNING id`, [userId, movieId])

    const movieViewingId = movie.rows[0]?.id

    await client.query(`INSERT INTO catalog_timeline_events (user_id, catalog_item_id, viewing_id, kind)
      VALUES ($1, $2, $3, 'movie_viewing') ON CONFLICT DO NOTHING`, [userId, movieId, movieViewingId])

    await client.query('INSERT INTO catalog_item_ratings (user_id, catalog_item_id, viewing_id, score) VALUES ($1, $2, $3, 8)', [userId, movieId, movieViewingId])

    // Act
    const before = await findCatalogTimeline(database, owner, { timeZone: 'Europe/Tallinn' })

    await client.query('UPDATE catalog_item_ratings SET score = 9 WHERE viewing_id = $1', [viewingId])

    const after = await findCatalogTimeline(database, owner, { timeZone: 'Europe/Tallinn' })

    const movieTimeline = await findCatalogTimeline(database, {
      userId,
      catalogItemId: movieId
    }, { timeZone: 'America/New_York' })

    // Assert
    expect(before.items).toHaveLength(2)

    expect(before.items[0]).toMatchObject({
      kind: 'series_completed',
      completedOn: '2026-10-31',
      occurredAt: '2026-10-31T00:00:00.000000Z'
    })

    expect(before.items[1]).toMatchObject({
      kind: startKind,
      startedOn: '2026-10-01',
      score: 7,
      occurredAt: '2026-10-01T00:00:00.000000Z'
    })

    expect(after.items[1]).toStrictEqual({
      ...before.items[1],
      score: 9
    })

    expect(movieTimeline.items[0]).toMatchObject({
      kind: 'movie_viewing',
      viewingId: movieViewingId,
      completedOn: '2024-02-29',
      score: 8,
      occurredAt: '2024-02-29T00:00:00.000000Z'
    })

    await client.query('DELETE FROM catalog_viewings WHERE id = $1', [movieViewingId])

    await expect(findCatalogTimeline(database, {
      userId,
      catalogItemId: movieId
    }, { timeZone: 'UTC' })).resolves.toStrictEqual({
      items: [],
      nextCursor: null
    })
  })

  it('invalidates a bounded page on date correction and preserves it on rating edits', async () => {
    // Arrange
    const viewingId = await seedViewing('completed')

    await seedMilestones(viewingId, 23)

    await client.query(`INSERT INTO catalog_timeline_events (user_id, catalog_item_id, viewing_id, kind, occurred_at)
      VALUES ($1, $2, $3, 'series_started', '2026-09-01')`, [userId, seriesId, viewingId])

    const first = await findCatalogTimeline(database, owner, { timeZone: 'UTC' })

    assert.ok(first.nextCursor !== null, 'Timeline cursor is missing')
    await client.query('INSERT INTO catalog_item_ratings (user_id, catalog_item_id, viewing_id, score) VALUES ($1, $2, $3, 9)', [userId, seriesId, viewingId])

    // Act and assert
    const afterRating = await findCatalogTimeline(database, owner, {
      timeZone: 'UTC',
      cursor: first.nextCursor
    })

    expect(afterRating.items).toHaveLength(4)
    await client.query('UPDATE catalog_viewings SET started_on = \'2026-10-02\' WHERE id = $1', [viewingId])

    await expect(findCatalogTimeline(database, owner, {
      timeZone: 'UTC',
      cursor: first.nextCursor
    })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      status: 400
    })

    const refreshed = await findCatalogTimeline(database, owner, { timeZone: 'UTC' })

    expect(refreshed.items[0]).toMatchObject({
      kind: 'series_started',
      startedOn: '2026-10-02',
      score: 9
    })
  })

  it('keeps skipped local calendar dates distinct across a movie timeline page boundary', async () => {
    // Arrange
    const laterDays = Array.from({ length: 19 }, () => '2012-01-01')
    const days = ['2011-12-31', '2011-12-30', ...laterDays]
    const seeded = await seedMovieDays(days)
    const newer = seeded.find(viewing => viewing.day === '2011-12-31')
    const older = seeded.find(viewing => viewing.day === '2011-12-30')

    const movieOwner = {
      userId,
      catalogItemId: movieId
    }

    assert.ok(newer !== undefined, 'Newer movie viewing is missing')
    assert.ok(older !== undefined, 'Older movie viewing is missing')

    // Act
    const first = await findCatalogTimeline(database, movieOwner, { timeZone: 'Pacific/Apia' })

    assert.ok(first.nextCursor !== null, 'Movie timeline cursor is missing')

    const second = await findCatalogTimeline(database, movieOwner, {
      timeZone: 'Pacific/Apia',
      cursor: first.nextCursor
    })

    const ids = [...first.items, ...second.items].map(item => item.id)
    const distinct = new Set(ids)

    // Assert
    expect(first.items).toHaveLength(20)

    expect(first.items.at(-1)).toMatchObject({
      viewingId: newer.id,
      completedOn: '2011-12-31',
      occurredAt: '2011-12-31T00:00:00.000000Z'
    })

    expect(second.items).toHaveLength(1)

    expect(second.items[0]).toMatchObject({
      viewingId: older.id,
      completedOn: '2011-12-30',
      occurredAt: '2011-12-30T00:00:00.000000Z'
    })

    expect(second.nextCursor).toBeNull()
    expect(distinct.size).toBe(21)
  })

  /* oxlint-disable eslint/no-await-in-loop, vitest/no-conditional-in-test -- Cursor pages are sequential; nullable inputs and date ties require choosing the next position. */
  it('pages watched-date ties in the same order across viewings, timeline and dashboard history', async () => {
    // Arrange
    const days = Array.from({ length: 43 }, (_value, index) => {
      const day = Math.floor(index / 2) + 1
      const dayNumber = String(day).padStart(2, '0')

      return `2020-01-${dayNumber}`
    })

    const seeded = await seedMovieDays(days)

    const expected = seeded.toSorted((left, right) => {
      const dayOrder = right.day.localeCompare(left.day)
      const idOrder = right.id.localeCompare(left.id)

      return dayOrder || idOrder
    })

    const expectedIds = expected.map(viewing => viewing.id)

    const movieOwner = {
      userId,
      catalogItemId: movieId
    }

    const viewingIds: string[] = []
    const timelineIds: string[] = []
    const dashboardIds: string[] = []
    let viewingCursor: string | null = null
    let timelineCursor: string | null = null
    let dashboardCursor: string | null = null

    // Act
    for (let pageNumber = 0; pageNumber < 3; pageNumber += 1) {
      const viewingPage = await findViewings(database, movieOwner, viewingCursor)

      const query = {
        timeZone: 'Europe/Tallinn',
        cursor: timelineCursor ?? undefined
      }

      const timelinePage = await findCatalogTimeline(database, movieOwner, query)

      const dashboardPage = await findViewingHistory(database, {
        userId,
        status: null,
        titleLocale: 'en'
      }, dashboardCursor)

      const pageViewingIds = viewingPage.items.map(viewing => viewing.id)
      const movieEvents = timelinePage.items.filter(item => item.kind === 'movie_viewing')
      const pageTimelineIds = movieEvents.map(item => item.viewingId)
      const pageDashboardIds = dashboardPage.items.map(item => item.viewingId)

      viewingIds.push(...pageViewingIds)
      timelineIds.push(...pageTimelineIds)
      dashboardIds.push(...pageDashboardIds)

      viewingCursor = viewingPage.nextCursor
      timelineCursor = timelinePage.nextCursor
      dashboardCursor = dashboardPage.nextCursor
    }

    // Assert
    expect(viewingIds).toStrictEqual(expectedIds)
    expect(timelineIds).toStrictEqual(expectedIds)
    expect(dashboardIds).toStrictEqual(expectedIds)
    expect([viewingCursor, timelineCursor, dashboardCursor]).toStrictEqual([null, null, null])
  })
  /* oxlint-enable eslint/no-await-in-loop, vitest/no-conditional-in-test */

  it('keeps the stored milestone count when the catalog grows', async () => {
    // Arrange
    const viewingId = await seedViewing()

    await seedMilestones(viewingId, 1)
    await client.query('INSERT INTO catalog_episodes (catalog_item_id, season_number, episode_number) VALUES ($1, 1, 29)', [seriesId])

    // Act
    const timeline = await findCatalogTimeline(database, owner, { timeZone: 'UTC' })

    // Assert
    expect(timeline.items[0]).toMatchObject({
      kind: 'season_completed',
      seasonNumber: 1,
      totalCount: 1
    })
  })

  it('isolates accounts and rejects cursor reuse under a different title or zone', async () => {
    // Arrange
    const viewingId = await seedViewing()

    await seedMilestones(viewingId, 23)

    const first = await findCatalogTimeline(database, owner, { timeZone: 'UTC' })

    assert.ok(first.nextCursor !== null, 'Timeline cursor is missing')

    // Act and assert
    await expect(findCatalogTimeline(database, {
      userId: otherUserId,
      catalogItemId: seriesId
    }, { timeZone: 'UTC' })).resolves.toStrictEqual({
      items: [],
      nextCursor: null
    })

    await expect(findCatalogTimeline(database, {
      userId: otherUserId,
      catalogItemId: seriesId
    }, {
      timeZone: 'UTC',
      cursor: first.nextCursor
    })).rejects.toMatchObject({ status: 400 })

    await expect(findCatalogTimeline(database, {
      userId,
      catalogItemId: movieId
    }, {
      timeZone: 'UTC',
      cursor: first.nextCursor
    })).rejects.toMatchObject({ status: 400 })

    await expect(findCatalogTimeline(database, owner, {
      timeZone: 'Europe/Tallinn',
      cursor: first.nextCursor
    })).rejects.toMatchObject({ status: 400 })
  })
})
