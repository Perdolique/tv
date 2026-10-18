import { randomUUID } from 'node:crypto'
import { env } from 'node:process'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { findCatalogEpisodeRatings, findCatalogEpisodeRatingSummaries } from '../../episode-ratings-repository.ts'
import { setCurrentCatalogRating, setHistoricalCatalogRating } from '../../rating-mutations.ts'
import { markSeriesEpisodeWatched, unmarkSeriesEpisodeWatched } from '../../series-viewings-repository.ts'
import { createViewing, deleteViewing, findViewing } from '../../viewings-repository.ts'
import { ratingFixture, titleTarget, requireRatingViewing, requireTestValue } from '../../../testing/rating-fixtures.ts'

const fixture = ratingFixture()

describe('episode rating atomic watch contract', () => {
  beforeAll(fixture.setup)
  beforeEach(fixture.reset)

  afterAll(async () => {
    await fixture.cleanup()
  })

  it.each([
    {
      availability: 'future',
      catalogEpisodeId: fixture.futureEpisodeId
    },
    {
      availability: 'unknown',
      catalogEpisodeId: fixture.unknownEpisodeId
    }
  ])('rejects a new rating for an episode with $availability availability without creating a viewing, score, vote or mark', async ({ catalogEpisodeId }) => {

    await expect(fixture.save(fixture.seriesId, {
      seasonNumber: null,
      catalogEpisodeId
    }, 8)).rejects.toMatchObject({ status: 400 })

    const counts = await fixture.client.query(`SELECT
      (SELECT count(*)::integer FROM catalog_viewings WHERE user_id = $1) AS viewings,
      (SELECT count(*)::integer FROM catalog_item_ratings WHERE user_id = $1) AS ratings,
      (SELECT count(*)::integer FROM catalog_rating_votes WHERE user_id = $1) AS votes,
      (SELECT count(*)::integer FROM catalog_viewing_episode_watches WHERE user_id = $1) AS watches,
      (SELECT count(*)::integer FROM catalog_timeline_events WHERE user_id = $1) AS events`, [fixture.userId])

    expect(counts.rows).toStrictEqual([{
      viewings: 0,
      ratings: 0,
      votes: 0,
      watches: 0,
      events: 0
    }])
  })

  it('rejects a direct episode rating linked to another series with an otherwise valid owned viewing', async () => {
    const viewingId = randomUUID()

    await fixture.client.query(`
      INSERT INTO catalog_viewings (id, user_id, catalog_item_id, status, started_on)
      VALUES ($1, $2, $3, 'watching', '2026-01-15')
    `, [viewingId, fixture.userId, fixture.otherSeriesId])

    await expect(fixture.client.query(`
      INSERT INTO catalog_item_ratings (user_id, catalog_item_id, viewing_id, catalog_episode_id, score)
      VALUES ($1, $2, $3, $4, 8)
    `, [fixture.userId, fixture.otherSeriesId, viewingId, fixture.episodeId])).rejects.toMatchObject({
      code: '23503',
      constraint: 'catalog_item_ratings_episode_item_fk'
    })
  })

  it('adds the episode mark and its milestones once, preserving the mark when the score is removed', async () => {
    const first = await fixture.save(fixture.seriesId, fixture.episodeTarget, 8)

    const second = await fixture.save(fixture.seriesId, {
      seasonNumber: null,
      catalogEpisodeId: fixture.nextEpisodeId
    }, 9)

    const corrected = await fixture.save(fixture.seriesId, fixture.episodeTarget, 6)
    const removed = await fixture.save(fixture.seriesId, fixture.episodeTarget, null)
    const events = await fixture.client.query<{ kind: string }>('SELECT kind FROM catalog_timeline_events WHERE user_id = $1 ORDER BY kind', [fixture.userId])
    const watches = await fixture.client.query('SELECT catalog_episode_id FROM catalog_viewing_episode_watches WHERE user_id = $1 ORDER BY catalog_episode_id', [fixture.userId])

    expect(first.watches?.map(watch => watch.catalogEpisodeId)).toStrictEqual([fixture.episodeId])
    expect(second.watches).toHaveLength(2)
    expect(corrected.viewing?.id).toBe(first.viewing?.id)
    expect(removed.watches).toHaveLength(2)
    expect(watches.rows).toHaveLength(2)
    expect(events.rows).toStrictEqual([{ kind: 'available_completed' }, { kind: 'episode_watched' }, { kind: 'episode_watched' }, { kind: 'season_completed' }, { kind: 'series_started' }])

    await expect(findCatalogEpisodeRatingSummaries(fixture.database, { episodeId: fixture.episodeId })).resolves.toStrictEqual([{
      episodeId: fixture.episodeId,
      averageScore: null,
      ratingCount: 0
    }])
  })

  it('allows a correction on an existing mark even when catalog availability later changes', async () => {
    const first = await fixture.save(fixture.seriesId, fixture.episodeTarget, 5)

    await fixture.client.query('UPDATE catalog_episodes SET air_date = \'9999-01-01\' WHERE id = $1', [fixture.episodeId])

    try {
      const corrected = await fixture.save(fixture.seriesId, fixture.episodeTarget, 7)

      expect(corrected.score).toBe(7)
      expect(corrected.watches).toStrictEqual(first.watches)
    } finally {
      await fixture.client.query('UPDATE catalog_episodes SET air_date = \'2000-01-01\' WHERE id = $1', [fixture.episodeId])
    }
  })

  it('requires confirmation to unwatch a rated episode and removes the mark, score and source vote atomically', async () => {
    const rated = await fixture.save(fixture.seriesId, fixture.episodeTarget, 8)
    const watch = requireTestValue(rated.watches?.[0])
    const ratedViewing = requireRatingViewing(rated)
    const unwatchRequestId = randomUUID()

    const input = {
      requestId: unwatchRequestId,
      currentViewingId: ratedViewing.id,
      contextVersion: rated.summary.contextVersion,
      watchId: watch.id,
      confirmRatingRemoval: false
    }

    await expect(unmarkSeriesEpisodeWatched(fixture.database, fixture.userId, fixture.episodeId, input)).rejects.toMatchObject({
      status: 409,
      fields: { confirmRatingRemoval: 'Removing this mark also removes its episode rating. Confirm to continue.' }
    })

    await expect(findCatalogEpisodeRatings(fixture.database, fixture.userId, { episodeId: fixture.episodeId })).resolves.toStrictEqual([{
      episodeId: fixture.episodeId,
      score: 8
    }])

    const confirmed = await unmarkSeriesEpisodeWatched(fixture.database, fixture.userId, fixture.episodeId, {
      ...input,
      confirmRatingRemoval: true
    })

    expect(confirmed.watches).toStrictEqual([])

    await expect(findCatalogEpisodeRatings(fixture.database, fixture.userId, { episodeId: fixture.episodeId })).resolves.toStrictEqual([{
      episodeId: fixture.episodeId,
      score: null
    }])

    await expect(findCatalogEpisodeRatingSummaries(fixture.database, { episodeId: fixture.episodeId })).resolves.toStrictEqual([{
      episodeId: fixture.episodeId,
      averageScore: null,
      ratingCount: 0
    }])
  })

  it('isolates selected viewing batch reads and historical episode changes from the current public vote', async () => {
    const first = await fixture.save(fixture.seriesId, fixture.episodeTarget, 7)
    const firstViewing = requireRatingViewing(first)
    const rewatchRequestId = randomUUID()

    const next = await createViewing(fixture.database, {
      userId: fixture.userId,
      catalogItemId: fixture.seriesId
    }, {
      requestId: rewatchRequestId,
      mode: 'current',
      currentViewingId: firstViewing.id,
      contextVersion: first.summary.contextVersion,
      status: 'watching',
      startedOn: '2026-02-01',
      completedOn: null,
      completeCurrentOn: '2026-01-31'
    })

    const previous = await fixture.client.query<{ revision: number }>('SELECT revision FROM catalog_viewings WHERE id = $1', [firstViewing.id])
    const historicalRatingRequestId = randomUUID()

    const edited = await setHistoricalCatalogRating(fixture.database, {
      userId: fixture.userId,
      catalogItemId: fixture.seriesId,
      viewingId: firstViewing.id
    }, fixture.episodeTarget, {
      requestId: historicalRatingRequestId,
      revision: requireTestValue(previous.rows[0]).revision,
      timeZone: 'UTC',
      score: 2
    })

    const scope = {
      catalogItemId: fixture.seriesId,
      seasonNumber: 1
    }

    expect(edited.summary.currentViewingId).toBe(next.viewing.id)

    await expect(findCatalogEpisodeRatings(fixture.database, fixture.userId, scope)).resolves.toStrictEqual([{
      episodeId: fixture.episodeId,
      score: null
    }, {
      episodeId: fixture.nextEpisodeId,
      score: null
    }])

    await expect(findCatalogEpisodeRatings(fixture.database, fixture.userId, scope, firstViewing.id)).resolves.toStrictEqual([{
      episodeId: fixture.episodeId,
      score: 2
    }, {
      episodeId: fixture.nextEpisodeId,
      score: null
    }])

    await expect(findCatalogEpisodeRatings(fixture.database, fixture.otherUserId, scope, firstViewing.id)).rejects.toMatchObject({ status: 404 })

    await expect(findCatalogEpisodeRatingSummaries(fixture.database, scope)).resolves.toStrictEqual([{
      episodeId: fixture.episodeId,
      averageScore: 7,
      ratingCount: 1
    }, {
      episodeId: fixture.nextEpisodeId,
      averageScore: null,
      ratingCount: 0
    }])
  })

  it('rolls the first episode rating back if recording its retry result fails', async () => {
    await fixture.client.query(`CREATE FUNCTION pg_temp.reject_rating_request() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'request write failed'; END; $$`)
    await fixture.client.query('CREATE TRIGGER reject_rating_request BEFORE INSERT ON catalog_viewing_requests FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_rating_request()')

    try {
      await expect(fixture.save(fixture.seriesId, fixture.episodeTarget, 8)).rejects.toThrow('Failed query:')
    } finally {
      await fixture.client.query('DROP TRIGGER reject_rating_request ON catalog_viewing_requests')
    }

    const counts = await fixture.client.query(`SELECT
      (SELECT count(*)::integer FROM catalog_viewings WHERE user_id = $1) AS viewings,
      (SELECT count(*)::integer FROM catalog_item_ratings WHERE user_id = $1) AS ratings,
      (SELECT count(*)::integer FROM catalog_rating_votes WHERE user_id = $1) AS votes,
      (SELECT count(*)::integer FROM catalog_viewing_episode_watches WHERE user_id = $1) AS watches,
      (SELECT count(*)::integer FROM catalog_timeline_events WHERE user_id = $1) AS events`, [fixture.userId])

    expect(counts.rows).toStrictEqual([{
      viewings: 0,
      ratings: 0,
      votes: 0,
      watches: 0,
      events: 0
    }])
  })

  it('keeps whole-series scores independent of episode scores', async () => {
    await fixture.save(fixture.seriesId, fixture.episodeTarget, 10)

    const series = await fixture.save(fixture.seriesId, titleTarget, 3)

    expect(series.score).toBe(3)

    await expect(findCatalogEpisodeRatings(fixture.database, fixture.userId, { episodeId: fixture.episodeId })).resolves.toStrictEqual([{
      episodeId: fixture.episodeId,
      score: 10
    }])
  })

  it('removes source votes when deleting an older viewing and preserves the newer viewing and its scores', async () => {
    const first = await fixture.save(fixture.seriesId, fixture.episodeTarget, 7)
    const firstViewing = requireRatingViewing(first)

    const owner = {
      userId: fixture.userId,
      catalogItemId: fixture.seriesId
    }

    const rewatchRequestId = randomUUID()

    const next = await createViewing(fixture.database, owner, {
      requestId: rewatchRequestId,
      mode: 'current',
      currentViewingId: firstViewing.id,
      contextVersion: first.summary.contextVersion,
      status: 'watching',
      startedOn: '2026-02-01',
      completedOn: null,
      completeCurrentOn: '2026-01-31'
    })

    await fixture.save(fixture.seriesId, titleTarget, 3)

    const oldViewing = await findViewing(fixture.database, owner, firstViewing.id)
    const deletionRequestId = randomUUID()

    await deleteViewing(fixture.database, {
      userId: fixture.userId,
      catalogItemId: fixture.seriesId,
      viewingId: firstViewing.id
    }, {
      requestId: deletionRequestId,
      revision: oldViewing.revision
    })

    const remaining = await findViewing(fixture.database, owner, next.viewing.id)
    const watches = await fixture.client.query('SELECT id FROM catalog_viewing_episode_watches WHERE user_id = $1', [fixture.userId])

    expect(remaining.score).toBe(3)
    expect(watches.rows).toStrictEqual([])

    await expect(findCatalogEpisodeRatingSummaries(fixture.database, { episodeId: fixture.episodeId })).resolves.toStrictEqual([{
      episodeId: fixture.episodeId,
      averageScore: null,
      ratingCount: 0
    }])
  })

  it('serializes a concurrent first rating and first watch through the same context', async () => {
    const input = await fixture.input(fixture.seriesId, 8)

    const owner = {
      userId: fixture.userId,
      catalogItemId: fixture.seriesId
    }

    const connection = new Client({ connectionString: env.TEST_DATABASE_URL })

    await connection.connect()

    try {
      const concurrentDatabase = createDatabase(connection)
      const rating = setCurrentCatalogRating(fixture.database, owner, fixture.episodeTarget, input)
      const markRequestId = randomUUID()

      const results = await Promise.allSettled([
        rating,
        markSeriesEpisodeWatched(concurrentDatabase, fixture.userId, fixture.episodeId, {
          requestId: markRequestId,
          currentViewingId: null,
          contextVersion: 0,
          timeZone: 'UTC',
          viewingDate: '2026-01-15'
        })
      ])

      const succeeded = results.filter(result => result.status === 'fulfilled')
      const conflicted = results.filter(result => result.status === 'rejected')

      expect(succeeded).toHaveLength(1)
      expect(conflicted).toMatchObject([{ reason: { status: 409 } }])
    } finally {
      await connection.end()
    }

    const counts = await fixture.client.query(`SELECT
      (SELECT count(*)::integer FROM catalog_viewings WHERE user_id = $1) AS viewings,
      (SELECT count(*)::integer FROM catalog_viewing_episode_watches WHERE user_id = $1) AS watches,
      (SELECT count(*)::integer FROM catalog_timeline_events WHERE user_id = $1 AND kind = 'series_started') AS starts,
      (SELECT count(*)::integer FROM catalog_timeline_events WHERE user_id = $1 AND kind = 'episode_watched') AS watched`, [fixture.userId])

    expect(counts.rows).toStrictEqual([{
      viewings: 1,
      watches: 1,
      starts: 1,
      watched: 1
    }])
  })

})
