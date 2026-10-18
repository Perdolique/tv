import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { findCatalogItemRatingSummary } from '../../ratings-repository.ts'
import { readRatingSnapshot, setHistoricalCatalogRating } from '../../rating-mutations.ts'
import { createViewing } from '../../viewings-repository.ts'

import {
  ratingFixture,
  seasonTarget,
  titleTarget,
  requireRatingViewing,
  requireTestValue
} from '../../../testing/rating-fixtures.ts'

const fixture = ratingFixture()

describe('season score and vote isolation', () => {
  beforeAll(fixture.setup)
  beforeEach(fixture.reset)

  afterAll(async () => {
    await fixture.cleanup()
  })

  it('counts one public vote per user without multiplying by episodes or mixing title and season targets', async () => {
    await fixture.save(fixture.seriesId, seasonTarget, 6)
    await fixture.save(fixture.seriesId, seasonTarget, 6, fixture.otherUserId)
    await fixture.save(fixture.seriesId, seasonTarget, 9, fixture.thirdUserId)
    await fixture.save(fixture.seriesId, titleTarget, 1)

    await fixture.save(fixture.seriesId, {
      seasonNumber: 2,
      catalogEpisodeId: null
    }, 2)

    await fixture.save(fixture.otherSeriesId, seasonTarget, 3)

    await expect(findCatalogItemRatingSummary(fixture.database, fixture.seriesId, 1)).resolves.toStrictEqual({
      averageScore: 7,
      ratingCount: 3
    })

    await expect(findCatalogItemRatingSummary(fixture.database, fixture.seriesId)).resolves.toStrictEqual({
      averageScore: 1,
      ratingCount: 1
    })

    await expect(findCatalogItemRatingSummary(fixture.database, fixture.seriesId, 2)).resolves.toStrictEqual({
      averageScore: 2,
      ratingCount: 1
    })

    await expect(findCatalogItemRatingSummary(fixture.database, fixture.otherSeriesId, 1)).resolves.toStrictEqual({
      averageScore: 3,
      ratingCount: 1
    })

    await fixture.save(fixture.seriesId, seasonTarget, 7)
    await fixture.save(fixture.seriesId, seasonTarget, null)

    await expect(findCatalogItemRatingSummary(fixture.database, fixture.seriesId, 1)).resolves.toStrictEqual({
      averageScore: 7.5,
      ratingCount: 2
    })

    await expect(readRatingSnapshot(fixture.database, {
      userId: fixture.otherUserId,
      catalogItemId: fixture.seriesId
    }, seasonTarget)).resolves.toMatchObject({ score: 6 })
  })

  it('reads personal season scores from the chosen viewing and never changes the public vote through history', async () => {
    const first = await fixture.save(fixture.seriesId, seasonTarget, 8)
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
    }, seasonTarget, {
      requestId: historicalRatingRequestId,
      revision: requireTestValue(previous.rows[0]).revision,
      timeZone: 'UTC',
      score: 2
    })

    expect(edited.summary.currentViewingId).toBe(next.viewing.id)

    await expect(readRatingSnapshot(fixture.database, {
      userId: fixture.userId,
      catalogItemId: fixture.seriesId
    }, seasonTarget)).resolves.toMatchObject({ score: null })

    await expect(readRatingSnapshot(fixture.database, {
      userId: fixture.userId,
      catalogItemId: fixture.seriesId
    }, seasonTarget, firstViewing.id)).resolves.toMatchObject({ score: 2 })

    await expect(findCatalogItemRatingSummary(fixture.database, fixture.seriesId, 1)).resolves.toStrictEqual({
      averageScore: 8,
      ratingCount: 1
    })

    const marks = await fixture.client.query('SELECT id FROM catalog_viewing_episode_watches WHERE user_id = $1', [fixture.userId])

    expect(marks.rows).toStrictEqual([])
  })
})
