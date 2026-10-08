/* oxlint-disable eslint/max-lines -- This PostgreSQL fixture suite covers grouping, pagination and immutable event metadata together. */
import { env } from 'node:process'
import assert from 'node:assert/strict'
import { createDatabase } from '@tv/database'
import { catalogTimelineEpisodesResponseSchema, catalogTimelineResponseSchema } from '@tv/shared/catalog-timeline'
import { Client } from 'pg'
import * as v from 'valibot'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'
import { findCatalogTimeline, findCatalogTimelineEpisodes } from '../../timeline-repository.ts'

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

async function seedViewing(status: 'watching' | 'paused' | 'completed' = 'watching'): Promise<string> {
  const result = await client.query<{ id: string }>(`
    INSERT INTO catalog_viewings (user_id, catalog_item_id, status)
    VALUES ($1, $2, $3) RETURNING id
  `, [userId, seriesId, status])

  const id = result.rows[0]?.id

  if (id === undefined) { throw new Error('Series viewing fixture is missing') }

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

async function seedRatings(count: number): Promise<void> {
  await client.query(`
    INSERT INTO catalog_timeline_events (user_id, catalog_item_id, kind, occurred_at, previous_score, score)
    SELECT $1, $2, 'rating_changed', '2026-10-01T12:00:00.123456Z'::timestamptz, 7, 8
    FROM generate_series(1, $3::integer)
  `, [userId, seriesId, count])
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

  it('groups more than twenty episodes before paging and preserves gaps by season', async () => {
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

    await seedRatings(23)

    // Act
    const first = await findCatalogTimeline(database, owner, { timeZone: 'Europe/Tallinn' })
    const [group] = first.items

    assert.ok(group?.kind === 'episode_group', 'Expected the complete episode group')
    assert.ok(first.nextCursor !== null, 'Expected a next timeline page')

    const next = await findCatalogTimeline(database, owner, {
      timeZone: 'Europe/Tallinn',
      cursor: first.nextCursor
    })

    const episodes = await findCatalogTimelineEpisodes(database, owner, {
      timeZone: 'Europe/Tallinn',
      viewingId,
      localDate: group.localDate,
      groupCursor: group.episodesCursor
    })

    // Assert
    const validTimeline = v.is(catalogTimelineResponseSchema, first)

    expect(validTimeline).toBe(true)
    expect(first.items).toHaveLength(20)
    expect(group.totalCount).toBe(30)

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

    const nextPageContainsOnlyRatings = next.items.every(item => item.kind === 'rating_changed')

    expect(nextPageContainsOnlyRatings).toBe(true)
    expect(next.nextCursor).toBeNull()

    const validEpisodes = v.is(catalogTimelineEpisodesResponseSchema, episodes)

    expect(validEpisodes).toBe(true)
    expect(episodes.items).toHaveLength(20)
    expect(episodes.nextCursor).not.toBeNull()
  })

  it('keeps detail pages on the same upper bound after new marks and boundary deletion', async () => {
    // Arrange
    const viewingId = await seedViewing()
    const episodeNumbers = Array.from({ length: 25 }, (_value, index) => index + 1)

    await seedWatches({
      viewingId,
      timestamp: '2026-10-25T01:30:00.123456Z',
      episodeNumbers
    })

    const timeline = await findCatalogTimeline(database, owner, { timeZone: 'Europe/Tallinn' })
    const [group] = timeline.items

    assert.ok(group?.kind === 'episode_group', 'Episode group is missing')

    const query = {
      timeZone: 'Europe/Tallinn',
      viewingId,
      localDate: group.localDate,
      groupCursor: group.episodesCursor
    }

    const first = await findCatalogTimelineEpisodes(database, owner, query)

    assert.ok(first.nextCursor !== null, 'Episode detail cursor is missing')

    await seedWatches({
      viewingId,
      timestamp: '2026-10-25T01:30:00.123457Z',
      episodeNumbers: [26]
    })

    const boundaryWatch = first.items.at(-1)

    await client.query('DELETE FROM catalog_viewing_episode_watches WHERE id = $1', [boundaryWatch?.watchId])
    await client.query('DELETE FROM catalog_viewing_episode_watches WHERE id = $1', [first.items[0]?.watchId])

    // Act
    const next = await findCatalogTimelineEpisodes(database, owner, {
      ...query,
      cursor: first.nextCursor
    })

    const repeatedFirstPage = await findCatalogTimelineEpisodes(database, owner, query)
    const refreshed = await findCatalogTimeline(database, owner, { timeZone: 'Europe/Tallinn' })

    // Assert
    const nextPageExcludesNewMark = next.items.every(item => item.episodeNumber !== 26)
    const repeatedPageExcludesNewMark = repeatedFirstPage.items.every(item => item.episodeNumber !== 26)

    expect(next.items).toHaveLength(5)
    expect(nextPageExcludesNewMark).toBe(true)
    expect(repeatedPageExcludesNewMark).toBe(true)
    expect(next.nextCursor).toBeNull()

    const allItems = [...first.items, ...next.items]
    const allIds = allItems.map(item => item.id)
    const uniqueIds = new Set(allIds)

    expect(uniqueIds.size).toBe(25)

    expect(refreshed.items[0]).toMatchObject({
      kind: 'episode_group',
      totalCount: 24
    })

    await expect(findCatalogTimelineEpisodes(database, {
      userId: otherUserId,
      catalogItemId: seriesId
    }, query)).rejects.toMatchObject({ status: 400 })
  })

  it('uses local midnight across DST and keeps separate viewings of the same episode', async () => {
    // Arrange
    const firstViewing = await seedViewing('paused')
    const secondViewing = await seedViewing()

    await seedWatches({
      viewingId: firstViewing,
      timestamp: '2026-10-24T20:59:59.999999Z',
      episodeNumbers: [1]
    })

    await seedWatches({
      viewingId: firstViewing,
      timestamp: '2026-10-24T21:00:00.000000Z',
      episodeNumbers: [2]
    })

    await seedWatches({
      viewingId: firstViewing,
      timestamp: '2026-10-25T00:30:00.123456Z',
      episodeNumbers: [3]
    })

    await seedWatches({
      viewingId: firstViewing,
      timestamp: '2026-10-25T01:30:00.123456Z',
      episodeNumbers: [4]
    })

    await seedWatches({
      viewingId: firstViewing,
      timestamp: '2026-10-25T22:00:00.000000Z',
      episodeNumbers: [5]
    })

    await seedWatches({
      viewingId: secondViewing,
      timestamp: '2026-10-25T01:30:00.123456Z',
      episodeNumbers: [1]
    })

    // Act
    const timeline = await findCatalogTimeline(database, owner, { timeZone: 'Europe/Tallinn' })
    const groups = timeline.items.filter(item => item.kind === 'episode_group')
    const firstGroups = groups.filter(item => item.viewingId === firstViewing)
    const firstGroupCounts = firstGroups.map(item => [item.localDate, item.totalCount])
    const secondViewingGroup = groups.find(item => item.viewingId === secondViewing)

    // Assert
    expect(firstGroupCounts).toStrictEqual([
      ['2026-10-26', 1], ['2026-10-25', 3], ['2026-10-24', 1]
    ])

    expect(secondViewingGroup).toMatchObject({
      localDate: '2026-10-25',
      totalCount: 1
    })

    const timelineContainsOnlyGroups = timeline.items.every(item => item.kind === 'episode_group')

    expect(timelineContainsOnlyGroups).toBe(true)
  })

  it('pages exact timestamp ties without looking up a deleted boundary or adding new events', async () => {
    // Arrange
    await seedRatings(23)

    await client.query(`
      UPDATE catalog_timeline_events SET occurred_at = '2026-10-01T12:00:00.123455Z'
      WHERE user_id = $1 AND id IN (SELECT id FROM catalog_timeline_events WHERE user_id = $1 ORDER BY id LIMIT 3)
    `, [userId])

    const expected = await client.query<{ id: string }>('SELECT id FROM catalog_timeline_events WHERE user_id = $1 ORDER BY occurred_at DESC, id DESC', [userId])
    const first = await findCatalogTimeline(database, owner, { timeZone: 'UTC' })

    assert.ok(first.nextCursor !== null, 'Timeline cursor is missing')

    const boundaryEvent = first.items.at(-1)

    await client.query('DELETE FROM catalog_timeline_events WHERE id = $1', [boundaryEvent?.id])
    await client.query('DELETE FROM catalog_timeline_events WHERE id = $1', [first.items[0]?.id])
    await client.query('INSERT INTO catalog_timeline_events (user_id, catalog_item_id, kind, occurred_at, score) VALUES ($1, $2, \'rating_changed\', \'2026-10-01T12:00:00.123457Z\', 9)', [userId, seriesId])

    // Act
    const next = await findCatalogTimeline(database, owner, {
      timeZone: 'UTC',
      cursor: first.nextCursor
    })

    const allItems = [...first.items, ...next.items]
    const ids = allItems.map(item => item.id)
    const expectedIds = expected.rows.map(row => row.id)
    const nextPageHasEarlierEvents = next.items.every(item => item.occurredAt === '2026-10-01T12:00:00.123455Z')

    // Assert
    expect(first.items).toHaveLength(20)
    expect(boundaryEvent?.occurredAt).toBe('2026-10-01T12:00:00.123456Z')
    expect(next.items).toHaveLength(3)
    expect(nextPageHasEarlierEvents).toBe(true)
    expect(ids).toStrictEqual(expectedIds)
    expect(next.nextCursor).toBeNull()
  })

  it('reads current movie dates while keeping rating changes independent from viewing deletion', async () => {
    // Arrange
    const result = await client.query<{ id: string }>('INSERT INTO catalog_viewings (user_id, catalog_item_id, started_on, recorded_at) VALUES ($1, $2, \'2024-02-29\', \'2026-01-01T12:00:00.123456Z\') RETURNING id', [userId, movieId])
    const viewingId = result.rows[0]?.id

    await client.query(`
      INSERT INTO catalog_timeline_events (user_id, catalog_item_id, kind, viewing_id, occurred_at)
      VALUES ($1, $2, 'movie_viewing', $3, '2026-01-01T12:00:00.123456Z');
    `, [userId, movieId, viewingId])

    await client.query('INSERT INTO catalog_timeline_events (user_id, catalog_item_id, kind, occurred_at, previous_score, score) VALUES ($1, $2, \'rating_changed\', \'2026-01-02T12:00:00.123456Z\', 7, null)', [userId, movieId])
    await client.query('UPDATE catalog_viewings SET started_on = \'2024-03-01\', completed_on = \'2024-03-02\' WHERE id = $1', [viewingId])

    // Act
    const timeline = await findCatalogTimeline(database, {
      userId,
      catalogItemId: movieId
    }, { timeZone: 'UTC' })

    await client.query('DELETE FROM catalog_viewings WHERE id = $1', [viewingId])

    const remaining = await findCatalogTimeline(database, {
      userId,
      catalogItemId: movieId
    }, { timeZone: 'UTC' })

    // Assert
    expect(timeline.items[1]).toMatchObject({
      kind: 'movie_viewing',
      viewingId,
      startedOn: '2024-03-01',
      completedOn: '2024-03-02',
      occurredAt: '2026-01-01T12:00:00.123456Z'
    })

    expect(remaining.items).toHaveLength(1)

    expect(remaining.items[0]).toMatchObject({
      kind: 'rating_changed',
      target: 'item',
      previousScore: 7,
      score: null
    })

    const validTimeline = v.is(catalogTimelineResponseSchema, remaining)

    expect(validTimeline).toBe(true)
  })

  it('returns the stored rating targets and achievement count after the catalog grows', async () => {
    // Arrange
    const viewingId = await seedViewing()
    const episodes = await client.query<{ id: string }>('SELECT id FROM catalog_episodes WHERE catalog_item_id = $1 ORDER BY season_number, episode_number LIMIT 2', [seriesId])
    const episodeIds = episodes.rows.map(row => row.id)

    await client.query(`
      INSERT INTO catalog_timeline_events (user_id, catalog_item_id, kind, season_number, catalog_episode_id, previous_score, score)
      VALUES ($1, $2, 'rating_changed', null, null, null, 8),
        ($1, $2, 'rating_changed', 1, null, 8, 9), ($1, $2, 'rating_changed', null, $3, 9, 7)
    `, [userId, seriesId, episodeIds[0]])

    const episodeIdsJson = JSON.stringify(episodeIds)

    await client.query('INSERT INTO catalog_timeline_events (user_id, catalog_item_id, kind, viewing_id, season_number, episode_ids) VALUES ($1, $2, \'season_completed\', $3, 1, $4::jsonb)', [userId, seriesId, viewingId, episodeIdsJson])
    await client.query('INSERT INTO catalog_episodes (catalog_item_id, season_number, episode_number) VALUES ($1, 1, 29)', [seriesId])

    // Act
    const timeline = await findCatalogTimeline(database, owner, { timeZone: 'UTC' })
    const ratings = timeline.items.filter(item => item.kind === 'rating_changed')
    const ratingChanges = ratings.map(item => [item.target, item.seasonNumber, item.episodeNumber, item.previousScore, item.score])

    // Assert
    expect(ratingChanges).toStrictEqual([
      ['episode', 1, 1, 9, 7], ['season', 1, null, 8, 9], ['item', null, null, null, 8]
    ])

    expect(timeline.items[0]).toMatchObject({
      kind: 'season_completed',
      seasonNumber: 1,
      totalCount: 2
    })

    const validTimeline = v.is(catalogTimelineResponseSchema, timeline)

    expect(validTimeline).toBe(true)
  })

  it('does not repeat a paged group after its latest event is deleted', async () => {
    // Arrange
    const unseenViewing = await seedViewing('paused')
    const firstViewing = await seedViewing()

    // The old viewing closes before the new one starts, as the rewatch API requires.
    await client.query('UPDATE catalog_viewings SET recorded_at = \'2026-10-25T00:00:00.000000Z\' WHERE id = $1', [unseenViewing])
    await client.query('UPDATE catalog_viewings SET recorded_at = \'2026-10-25T00:30:00.000000Z\' WHERE id = $1', [firstViewing])

    await seedWatches({
      viewingId: firstViewing,
      timestamp: '2026-10-25T02:00:00.123456Z',
      episodeNumbers: [1]
    })

    await seedWatches({
      viewingId: firstViewing,
      timestamp: '2026-10-25T01:00:00.123456Z',
      episodeNumbers: [2]
    })

    await seedWatches({
      viewingId: unseenViewing,
      timestamp: '2026-10-25T00:10:00.123456Z',
      episodeNumbers: [1]
    })

    await seedRatings(43)
    await client.query('UPDATE catalog_timeline_events SET occurred_at = \'2026-10-25T01:30:00.123456Z\' WHERE user_id = $1 AND kind = \'rating_changed\'', [userId])

    const first = await findCatalogTimeline(database, owner, { timeZone: 'Europe/Tallinn' })
    const [group] = first.items

    assert.ok(group?.kind === 'episode_group', 'Expected the latest episode group')
    assert.ok(first.nextCursor !== null, 'Expected a next timeline page')
    await client.query('DELETE FROM catalog_viewing_episode_watches WHERE id = (SELECT watch_id FROM catalog_timeline_events WHERE id = $1)', [group.id])

    // Act
    const next = await findCatalogTimeline(database, owner, {
      timeZone: 'Europe/Tallinn',
      cursor: first.nextCursor
    })

    assert.ok(next.nextCursor !== null, 'Expected a third timeline page')

    const last = await findCatalogTimeline(database, owner, {
      timeZone: 'Europe/Tallinn',
      cursor: next.nextCursor
    })

    const lastGroups = last.items.filter(item => item.kind === 'episode_group')
    const lastViewingIds = lastGroups.map(item => item.viewingId)

    // Assert
    expect(first.items).toHaveLength(20)
    expect(group.viewingId).toBe(firstViewing)
    expect(next.items).toHaveLength(20)
    expect(lastViewingIds).toStrictEqual([unseenViewing])
    expect(last.items).toHaveLength(5)
    expect(last.nextCursor).toBeNull()
  })

  it('resets the viewing watermark after crossing the local day boundary', async () => {
    // Arrange
    const viewingId = await seedViewing()

    await client.query('UPDATE catalog_viewings SET recorded_at = \'2026-10-24T00:00:00.000000Z\' WHERE id = $1', [viewingId])

    await seedWatches({
      viewingId,
      timestamp: '2026-10-25T13:00:00.123456Z',
      episodeNumbers: [1]
    })

    await seedWatches({
      viewingId,
      timestamp: '2026-10-24T11:00:00.123456Z',
      episodeNumbers: [2]
    })

    await seedRatings(25)
    await client.query('UPDATE catalog_timeline_events SET occurred_at = \'2026-10-25T12:00:00.123456Z\' WHERE user_id = $1 AND kind = \'rating_changed\'', [userId])

    await client.query(`
      INSERT INTO catalog_timeline_events (user_id, catalog_item_id, kind, occurred_at, previous_score, score)
      SELECT $1, $2, 'rating_changed', '2026-10-24T12:00:00.123456Z'::timestamptz, 7, 8 FROM generate_series(1, 23)
    `, [userId, seriesId])

    // Act
    const first = await findCatalogTimeline(database, owner, { timeZone: 'Europe/Tallinn' })

    assert.ok(first.nextCursor !== null, 'Expected a second timeline page')

    const second = await findCatalogTimeline(database, owner, {
      timeZone: 'Europe/Tallinn',
      cursor: first.nextCursor
    })

    assert.ok(second.nextCursor !== null, 'Expected a third timeline page')

    const third = await findCatalogTimeline(database, owner, {
      timeZone: 'Europe/Tallinn',
      cursor: second.nextCursor
    })

    const allItems = [...first.items, ...second.items, ...third.items]
    const groups = allItems.filter(item => item.kind === 'episode_group')
    const groupDays = groups.map(item => [item.viewingId, item.localDate])

    // Assert
    expect(groupDays).toStrictEqual([
      [viewingId, '2026-10-25'], [viewingId, '2026-10-24']
    ])

    expect(third.items).toHaveLength(10)
    expect(third.nextCursor).toBeNull()
  })

  it('isolates accounts and rejects cursor reuse under a different title or zone', async () => {
    // Arrange
    await seedRatings(23)

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
