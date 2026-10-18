import { randomUUID } from 'node:crypto'
import * as v from 'valibot'
import { catalogRatingMutationResponseSchema, catalogViewingMutationResponseSchema } from '@tv/shared/catalog-viewings'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ratingWorkerFixture, requireHttpValue } from '../../testing/rating-worker-fixtures.ts'

const fixture = ratingWorkerFixture()

describe('season rating HTTP context', () => {
  beforeEach(fixture.setup)

  afterAll(async () => {
    await fixture.cleanup()
  })

  it('keeps season aggregate votes separate from title and episode votes for authenticated and anonymous readers', async () => {
    const seasonContext = await fixture.context(fixture.seriesId)

    const season = await fixture.request(fixture.path('season'), 'PUT', {
      ...seasonContext,
      score: 6,
      viewingDate: '2026-01-15'
    })

    const titleContext = await fixture.context(fixture.seriesId)

    const title = await fixture.request(fixture.path('series'), 'PUT', {
      ...titleContext,
      score: 1
    })

    const episodeContext = await fixture.context(fixture.seriesId)

    const episode = await fixture.request(fixture.path('episode'), 'PUT', {
      ...episodeContext,
      score: 10
    })

    const otherContext = await fixture.context(fixture.seriesId, fixture.otherUserId)

    const other = await fixture.request(fixture.path('season'), 'PUT', {
      ...otherContext,
      score: 8,
      viewingDate: '2026-01-16'
    }, fixture.otherCookie)

    expect([season.status, title.status, episode.status, other.status]).toStrictEqual([200, 200, 200, 200])

    const summary = await fixture.request(`${fixture.path('season')}-summary`, 'GET', undefined, null)
    const invalidSessionSummary = await fixture.request(`${fixture.path('season')}-summary`, 'GET', undefined, '__Host-tv_session=invalid')

    expect(summary.status).toBe(200)
    expect(invalidSessionSummary.status).toBe(200)

    await expect(summary.json()).resolves.toStrictEqual({
      averageScore: 7,
      ratingCount: 2
    })

    await expect(invalidSessionSummary.json()).resolves.toStrictEqual({
      averageScore: 7,
      ratingCount: 2
    })
  })

  it.each([
    {
      kind: 'series',
      suffix: 'rating',
      currentVoteScore: 8
    },
    {
      kind: 'season',
      suffix: 'seasons/1/rating',
      currentVoteScore: null
    }
  ] as const)('supports historical $kind routes and chosen-viewing reads without moving the public vote', async ({ kind, suffix, currentVoteScore }) => {
    const context = await fixture.context(fixture.seriesId)

    const firstResponse = await fixture.request(fixture.path(kind), 'PUT', {
      ...context,
      score: 8,
      viewingDate: '2026-01-15'
    })

    const firstRaw: unknown = await firstResponse.json()
    const first = v.parse(catalogRatingMutationResponseSchema, firstRaw)
    const firstViewing = requireHttpValue(first.viewing)
    const rewatchRequestId = randomUUID()

    const nextResponse = await fixture.request(`/items/${fixture.seriesId}/viewings`, 'POST', {
      requestId: rewatchRequestId,
      mode: 'current',
      currentViewingId: firstViewing.id,
      contextVersion: first.summary.contextVersion,
      status: 'watching',
      startedOn: '2026-02-01',
      completedOn: null,
      completeCurrentOn: '2026-01-31'
    })

    expect(nextResponse.status).toBe(200)

    const nextRaw: unknown = await nextResponse.json()
    const next = v.parse(catalogViewingMutationResponseSchema, nextRaw)
    const oldResponse = await fixture.request(`/items/${fixture.seriesId}/viewings/${firstViewing.id}`)
    const oldRaw: unknown = await oldResponse.json()
    const old = v.parse(v.strictObject({ viewing: catalogViewingMutationResponseSchema.entries.viewing }), oldRaw)
    const historyPath = `/items/${fixture.seriesId}/viewings/${firstViewing.id}/${suffix}`
    const historicalRatingRequestId = randomUUID()

    const changed = await fixture.request(historyPath, 'PUT', {
      requestId: historicalRatingRequestId,
      revision: old.viewing.revision,
      timeZone: 'UTC',
      score: 2
    })

    expect(changed.status).toBe(200)

    const changedRaw: unknown = await changed.json()
    const historical = v.parse(catalogRatingMutationResponseSchema, changedRaw)
    const currentResponse = await fixture.request(fixture.path(kind))
    const currentRaw: unknown = await currentResponse.json()
    const current = v.parse(catalogRatingMutationResponseSchema, currentRaw)
    const selectedResponse = await fixture.request(`${fixture.path(kind)}?viewingId=${firstViewing.id}`)
    const selectedRaw: unknown = await selectedResponse.json()
    const selected = v.parse(catalogRatingMutationResponseSchema, selectedRaw)

    expect(current.score).toBeNull()
    expect(current.viewing?.id).toBe(next.viewing.id)
    expect(selected.score).toBe(2)
    expect(selected.viewing?.id).toBe(firstViewing.id)
    expect(selected.summary.currentViewingId).toBe(next.viewing.id)
    expect(historical.summary.currentVoteScore).toBe(currentVoteScore)

    const removalRequestId = randomUUID()

    const removed = await fixture.request(historyPath, 'DELETE', {
      requestId: removalRequestId,
      revision: historical.viewing?.revision,
      timeZone: 'UTC'
    })

    const summary = await fixture.request(`${fixture.path(kind)}-summary`, 'GET', undefined, null)

    expect(removed.status).toBe(200)

    await expect(summary.json()).resolves.toStrictEqual({
      averageScore: 8,
      ratingCount: 1
    })

    const wrongOwner = await fixture.request(`${fixture.path(kind)}?viewingId=${firstViewing.id}`, 'GET', undefined, fixture.otherCookie)

    expect(wrongOwner.status).toBe(404)
  })

  it.each(['/items/invalid/seasons/1/rating', '/items/invalid/seasons/1/rating-summary'])('rejects malformed scope %s before accessing catalog data', async path => {
    const response = await fixture.request(path)

    expect(response.status).toBe(400)
  })

  it.each([['0', 400], ['-1', 400], ['1.5', 400], ['2147483648', 400], ['abc', 400], ['999', 404]] as const)('rejects season %s for private reads, public summaries and both mutations', async (season, status) => {
    const path = `/items/${fixture.seriesId}/seasons/${season}/rating`
    const input = await fixture.context(fixture.seriesId)
    const privateRead = await fixture.request(path)
    const publicRead = await fixture.request(`${path}-summary`, 'GET', undefined, null)

    const save = await fixture.request(path, 'PUT', {
      ...input,
      score: 8,
      viewingDate: '2026-01-15'
    })

    const remove = await fixture.request(path, 'DELETE', input)

    expect([privateRead.status, publicRead.status, save.status, remove.status]).toStrictEqual([status, status, status, status])
  })

})
