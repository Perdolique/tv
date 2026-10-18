import { randomUUID } from 'node:crypto'
import { env } from 'node:process'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readRatingSnapshot, setCurrentCatalogRating } from '../../rating-mutations.ts'
import { findCatalogItemRatingSummary } from '../../ratings-repository.ts'
import { ratingFixture, seasonTarget, titleTarget } from '../../../testing/rating-fixtures.ts'

const fixture = ratingFixture()

describe('viewing-owned ratings', () => {
  beforeAll(fixture.setup)
  beforeEach(fixture.reset)

  afterAll(async () => {
    await fixture.cleanup()
  })

  it.each([
    {
      kind: 'movie',
      catalogItemId: fixture.movieId,
      target: titleTarget,
      startedOn: null,
      completedOn: '2026-01-15',
      status: 'completed',
      watchCount: 0
    },
    {
      kind: 'series',
      catalogItemId: fixture.seriesId,
      target: titleTarget,
      startedOn: '2026-01-15',
      completedOn: null,
      status: 'watching',
      watchCount: 0
    },
    {
      kind: 'season',
      catalogItemId: fixture.seriesId,
      target: seasonTarget,
      startedOn: '2026-01-15',
      completedOn: null,
      status: 'watching',
      watchCount: 0
    },
    {
      kind: 'episode',
      catalogItemId: fixture.seriesId,
      target: fixture.episodeTarget,
      startedOn: '2026-01-15',
      completedOn: null,
      status: 'watching',
      watchCount: 1
    }
  ])('creates one $kind viewing with its first score and keeps it through correction and removal', async ({ catalogItemId, target, startedOn, completedOn, status, watchCount }) => {
    const first = await fixture.save(catalogItemId, target, 7)
    const firstId = first.viewing?.id

    expect(first.score).toBe(7)
    expect(firstId).toBeTypeOf('string')
    expect(first.viewing?.startedOn).toBe(startedOn)
    expect(first.viewing?.completedOn).toBe(completedOn)
    expect(first.viewing?.status).toBe(status)

    const stored = await fixture.client.query<{ id:string;viewing_id:string;score:number }>('SELECT id, viewing_id, score FROM catalog_item_ratings WHERE user_id = $1', [fixture.userId])
    const publicVotes = await fixture.client.query<{ source_viewing_id: string; score: number }>('SELECT source_viewing_id, score FROM catalog_rating_votes WHERE user_id = $1', [fixture.userId])

    expect(publicVotes.rows).toStrictEqual([{
      source_viewing_id: firstId,
      score: 7
    }])

    const eventsBefore = await fixture.client.query<{ id:string;kind:string;occurred_at:Date }>('SELECT id, kind, occurred_at FROM catalog_timeline_events WHERE user_id = $1 ORDER BY id', [fixture.userId])
    const corrected = await fixture.save(catalogItemId, target, 9)
    const unchanged = await fixture.save(catalogItemId, target, 9)

    expect(unchanged).toStrictEqual(corrected)

    const updated = await fixture.client.query<{ id:string;viewing_id:string;score:number }>('SELECT id, viewing_id, score FROM catalog_item_ratings WHERE user_id = $1', [fixture.userId])

    expect(updated.rows).toStrictEqual([{
      id: stored.rows[0]?.id,
      viewing_id: firstId,
      score: 9
    }])

    expect(corrected.viewing?.id).toBe(firstId)
    expect(corrected.viewing?.completedOn).toBe(first.viewing?.completedOn)
    expect(corrected.viewing?.startedOn).toBe(first.viewing?.startedOn)

    const removed = await fixture.save(catalogItemId, target, null)
    const viewings = await fixture.client.query('SELECT id FROM catalog_viewings WHERE user_id = $1', [fixture.userId])
    const ratings = await fixture.client.query('SELECT id FROM catalog_item_ratings WHERE user_id = $1', [fixture.userId])
    const votes = await fixture.client.query('SELECT id FROM catalog_rating_votes WHERE user_id = $1', [fixture.userId])
    const watches = await fixture.client.query('SELECT id FROM catalog_viewing_episode_watches WHERE user_id = $1', [fixture.userId])
    const eventsAfter = await fixture.client.query<{ id:string;kind:string;occurred_at:Date }>('SELECT id, kind, occurred_at FROM catalog_timeline_events WHERE user_id = $1 ORDER BY id', [fixture.userId])

    expect(removed.score).toBeNull()
    expect(viewings.rows).toStrictEqual([{ id: firstId }])
    expect(ratings.rows).toStrictEqual([])
    expect(votes.rows).toStrictEqual([])
    expect(watches.rows).toHaveLength(watchCount)
    expect(eventsAfter.rows).toStrictEqual(eventsBefore.rows)
    expect(eventsAfter.rows.some(event => event.kind === 'rating_changed')).toBe(false)

    const recreated = await fixture.save(catalogItemId, target, 9)
    const restored = await fixture.client.query<{ id: string }>('SELECT id FROM catalog_item_ratings WHERE user_id = $1', [fixture.userId])

    expect(recreated.viewing?.id).toBe(firstId)
    expect(restored.rows).toHaveLength(1)
    expect(restored.rows[0]?.id).not.toBe(stored.rows[0]?.id)
  })

  it('requires a supplied creation date and rolls all first-rating effects back on failure', async () => {
    const change = await fixture.input(fixture.movieId, 7)
    const { viewingDate, ...withoutDate } = change

    expect(viewingDate).toBe('2026-01-15')

    await expect(setCurrentCatalogRating(fixture.database, {
      userId: fixture.userId,
      catalogItemId: fixture.movieId
    }, titleTarget, withoutDate)).rejects.toMatchObject({ status: 400 })

    const rows = await fixture.client.query('SELECT id FROM catalog_viewings WHERE user_id = $1', [fixture.userId])

    expect(rows.rows).toStrictEqual([])

    await expect(findCatalogItemRatingSummary(fixture.database, fixture.movieId)).resolves.toStrictEqual({
      averageScore: null,
      ratingCount: 0
    })
  })

  it('does not create a viewing when removing an absent score and rejects stale contexts', async () => {
    const absent = await fixture.save(fixture.movieId, titleTarget, null)
    const stale = await fixture.input(fixture.movieId, 8)

    expect(absent.viewing).toBeNull()
    await fixture.save(fixture.movieId, titleTarget, 4)

    await expect(setCurrentCatalogRating(fixture.database, {
      userId: fixture.userId,
      catalogItemId: fixture.movieId
    }, titleTarget, stale)).rejects.toMatchObject({ status: 409 })

    await expect(readRatingSnapshot(fixture.database, {
      userId: fixture.userId,
      catalogItemId: fixture.movieId
    }, titleTarget)).resolves.toMatchObject({ score: 4 })
  })

  it('validates target existence and type before creating personal records', async () => {
    const movie = await fixture.input(fixture.movieId, 5)
    const series = await fixture.input(fixture.seriesId, 5)
    const missing = await fixture.input(randomUUID(), 5)

    await expect(setCurrentCatalogRating(fixture.database, {
      userId: fixture.userId,
      catalogItemId: fixture.movieId
    }, seasonTarget, movie)).rejects.toMatchObject({ status: 400 })

    await expect(setCurrentCatalogRating(fixture.database, {
      userId: fixture.userId,
      catalogItemId: fixture.seriesId
    }, {
      seasonNumber: 99,
      catalogEpisodeId: null
    }, series)).rejects.toMatchObject({ status: 404 })

    const missingCatalogItemId = randomUUID()

    await expect(setCurrentCatalogRating(fixture.database, {
      userId: fixture.userId,
      catalogItemId: missingCatalogItemId
    }, titleTarget, missing)).rejects.toMatchObject({ status: 404 })

    const rows = await fixture.client.query('SELECT id FROM catalog_viewings WHERE user_id = $1', [fixture.userId])

    expect(rows.rows).toStrictEqual([])
  })

  it('waits for original-title metadata changes and rejects a title removed while its rating waits', async () => {
    const connection = new Client({
      connectionString: env.TEST_DATABASE_URL,
      application_name: 'rating-metadata-race'
    })

    const input = await fixture.input(fixture.movieId, 8)

    await connection.connect()
    await fixture.client.query('BEGIN')
    await fixture.client.query('UPDATE catalog_item_titles SET is_original = false WHERE catalog_item_id = $1 AND is_original', [fixture.movieId])

    const concurrentDatabase = createDatabase(connection)

    const pending = setCurrentCatalogRating(concurrentDatabase, {
      userId: fixture.userId,
      catalogItemId: fixture.movieId
    }, titleTarget, input)

    const settled = Promise.allSettled([pending])

    try {
      await vi.waitFor(async () => {
        await fixture.client.query('SELECT pg_stat_clear_snapshot()')

        const waiting = await fixture.client.query<{ count: number }>('SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname = current_database() AND application_name = \'rating-metadata-race\' AND wait_event_type = \'Lock\'')

        expect(waiting.rows[0]?.count).toBe(1)
      }, { timeout: 5000 })
    } finally {
      await fixture.client.query('COMMIT')

      await settled

      await connection.end()
      await fixture.client.query('UPDATE catalog_item_titles SET is_original = true WHERE catalog_item_id = $1', [fixture.movieId])
    }

    await expect(settled).resolves.toMatchObject([{
      status: 'rejected',
      reason: { status: 404 }
    }])

    const rows = await fixture.client.query('SELECT id FROM catalog_item_ratings WHERE user_id = $1', [fixture.userId])

    expect(rows.rows).toStrictEqual([])
  })

  it('replays an absent score removal without clearing a viewing created later', async () => {
    const owner = {
      userId: fixture.userId,
      catalogItemId: fixture.movieId
    }

    const input = await fixture.input(fixture.movieId, null)
    const removed = await setCurrentCatalogRating(fixture.database, owner, titleTarget, input)
    const replay = await setCurrentCatalogRating(fixture.database, owner, titleTarget, input)

    expect(replay).toStrictEqual(removed)
    expect(replay.viewing).toBeNull()

    const created = await fixture.save(fixture.movieId, titleTarget, 8)
    const lateReplay = await setCurrentCatalogRating(fixture.database, owner, titleTarget, input)
    const current = await readRatingSnapshot(fixture.database, owner, titleTarget)

    expect(lateReplay.score).toBeNull()
    expect(lateReplay.viewing).toBeNull()
    expect(lateReplay.summary).toStrictEqual(created.summary)
    expect(current.score).toBe(8)
    expect(current.viewing?.id).toBe(created.viewing?.id)
  })

})
