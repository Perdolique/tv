import { randomUUID } from 'node:crypto'
import * as v from 'valibot'

import {
  catalogEpisodeRatingsResponseSchema,
  catalogRatingMutationResponseSchema,
  catalogViewingMutationResponseSchema
} from '@tv/shared/catalog-viewings'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ratingWorkerFixture, requireHttpValue } from '../../testing/rating-worker-fixtures.ts'

const fixture = ratingWorkerFixture()

describe('episode rating HTTP watch boundary', () => {
  beforeEach(fixture.setup)

  afterAll(async () => {
    await fixture.cleanup()
  })

  it('returns the confirmed mark and batch rating context, then requires explicit consent before unwatching its score', async () => {
    const context = await fixture.context(fixture.seriesId)

    const input = {
      ...context,
      score: 8,
      viewingDate: '2026-01-15'
    }

    const response = await fixture.request(fixture.path('episode'), 'PUT', input)

    expect(response.status).toBe(200)

    const raw: unknown = await response.json()
    const rated = v.parse(catalogRatingMutationResponseSchema, raw)
    const watch = requireHttpValue(rated.watches?.[0])
    const ratedViewing = requireHttpValue(rated.viewing)
    const batchResponse = await fixture.request(`/items/${fixture.seriesId}/seasons/1/episodes/ratings`)
    const batchRaw: unknown = await batchResponse.json()
    const batch = v.parse(catalogEpisodeRatingsResponseSchema, batchRaw)

    expect(batch.items).toStrictEqual([{
      episodeId: fixture.episodeId,
      score: 8
    }])

    expect(batch.viewing?.id).toBe(ratedViewing.id)
    expect(batch.summary).toStrictEqual(rated.summary)

    const unwatchRequestId = randomUUID()

    const unwatch = {
      requestId: unwatchRequestId,
      currentViewingId: ratedViewing.id,
      contextVersion: rated.summary.contextVersion,
      watchId: watch.id
    }

    const refused = await fixture.request(`/episodes/${fixture.episodeId}/watched`, 'DELETE', unwatch)

    expect(refused.status).toBe(409)
    await expect(refused.json()).resolves.toMatchObject({ error: { fields: { confirmRatingRemoval: 'Removing this mark also removes its episode rating. Confirm to continue.' } } })

    const confirmed = await fixture.request(`/episodes/${fixture.episodeId}/watched`, 'DELETE', {
      ...unwatch,
      confirmRatingRemoval: true
    })

    expect(confirmed.status).toBe(200)

    const replay = await fixture.request(fixture.path('episode'), 'PUT', input)

    expect(replay.status).toBe(409)

    const summary = await fixture.request(`${fixture.path('episode')}-summary`, 'GET', undefined, null)

    await expect(summary.json()).resolves.toStrictEqual({
      averageScore: null,
      ratingCount: 0
    })
  })

  it('rejects unavailable new marks and preserves an empty diary on failure', async () => {
    const context = await fixture.context(fixture.seriesId)

    const response = await fixture.request(`/episodes/${fixture.futureEpisodeId}/rating`, 'PUT', {
      ...context,
      score: 8,
      viewingDate: '2026-01-15'
    })

    const current = await fixture.request(fixture.path('series'))
    const currentRaw: unknown = await current.json()
    const rating = v.parse(catalogRatingMutationResponseSchema, currentRaw)

    expect(response.status).toBe(400)
    expect(rating.viewing).toBeNull()
    expect(rating.summary.contextVersion).toBe(0)
  })

  it('keeps episode summaries public and validates unknown episodes and selected viewing ownership', async () => {
    const context = await fixture.context(fixture.seriesId)

    const response = await fixture.request(fixture.path('episode'), 'PUT', {
      ...context,
      score: 6,
      viewingDate: '2026-01-15'
    })

    const raw: unknown = await response.json()
    const rated = v.parse(catalogRatingMutationResponseSchema, raw)
    const summary = await fixture.request(`/items/${fixture.seriesId}/seasons/1/episodes/rating-summaries`, 'GET', undefined, null)
    const unknown = await fixture.request(`/episodes/${randomUUID()}/rating`)
    const wrongOwner = await fixture.request(`/items/${fixture.seriesId}/seasons/1/episodes/ratings?viewingId=${rated.viewing?.id}`, 'GET', undefined, fixture.otherCookie)

    expect(summary.status).toBe(200)

    await expect(summary.json()).resolves.toStrictEqual({ items: [{
      episodeId: fixture.episodeId,
      averageScore: 6,
      ratingCount: 1
    }] })

    expect(unknown.status).toBe(404)
    expect(wrongOwner.status).toBe(404)
  })

  it('adds a historical episode score and mark in the selected viewing while leaving current progress and public votes untouched', async () => {
    const historyRequestId = randomUUID()

    const historyResponse = await fixture.request(`/items/${fixture.seriesId}/viewings`, 'POST', {
      requestId: historyRequestId,
      mode: 'history',
      currentViewingId: null,
      contextVersion: 0,
      status: 'completed',
      startedOn: '2026-01-01',
      completedOn: '2026-01-31'
    })

    const historyRaw: unknown = await historyResponse.json()
    const history = v.parse(catalogViewingMutationResponseSchema, historyRaw)
    const currentRequestId = randomUUID()

    const currentResponse = await fixture.request(`/items/${fixture.seriesId}/viewings`, 'POST', {
      requestId: currentRequestId,
      mode: 'current',
      currentViewingId: null,
      contextVersion: 0,
      status: 'watching',
      startedOn: '2026-02-01',
      completedOn: null
    })

    const currentRaw: unknown = await currentResponse.json()
    const current = v.parse(catalogViewingMutationResponseSchema, currentRaw)
    const path = `/items/${fixture.seriesId}/viewings/${history.viewing.id}/episodes/${fixture.episodeId}/rating`
    const ratingRequestId = randomUUID()

    const ratedResponse = await fixture.request(path, 'PUT', {
      requestId: ratingRequestId,
      revision: history.viewing.revision,
      timeZone: 'UTC',
      score: 8
    })

    expect(ratedResponse.status).toBe(200)

    const ratedRaw: unknown = await ratedResponse.json()
    const rated = v.parse(catalogRatingMutationResponseSchema, ratedRaw)
    const ratedViewing = requireHttpValue(rated.viewing)

    expect(rated.score).toBe(8)
    expect(ratedViewing.id).toBe(history.viewing.id)
    expect(rated.watches).toHaveLength(1)
    expect(rated.summary.currentViewingId).toBe(current.viewing.id)

    const selectedResponse = await fixture.request(`/items/${fixture.seriesId}/seasons/1/episodes/ratings?viewingId=${history.viewing.id}`)
    const selectedRaw: unknown = await selectedResponse.json()
    const selected = v.parse(catalogEpisodeRatingsResponseSchema, selectedRaw)
    const liveResponse = await fixture.request(fixture.path('episode'))
    const liveRaw: unknown = await liveResponse.json()
    const live = v.parse(catalogRatingMutationResponseSchema, liveRaw)
    const publicSummary = await fixture.request(`${fixture.path('episode')}-summary`, 'GET', undefined, null)

    expect(selected.items).toStrictEqual([{
      episodeId: fixture.episodeId,
      score: 8
    }])

    expect(live.score).toBeNull()
    expect(live.watches).toStrictEqual([])

    await expect(publicSummary.json()).resolves.toStrictEqual({
      averageScore: null,
      ratingCount: 0
    })

    const removalRequestId = randomUUID()

    const removedResponse = await fixture.request(path, 'DELETE', {
      requestId: removalRequestId,
      revision: ratedViewing.revision,
      timeZone: 'UTC'
    })

    const removedRaw: unknown = await removedResponse.json()
    const removed = v.parse(catalogRatingMutationResponseSchema, removedRaw)

    expect(removed.score).toBeNull()
    expect(removed.watches).toStrictEqual(rated.watches)
  })

})
