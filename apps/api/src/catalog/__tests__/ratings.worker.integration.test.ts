import { randomUUID } from 'node:crypto'
import * as v from 'valibot'
import { catalogRatingMutationResponseSchema } from '@tv/shared/catalog-viewings'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ratingWorkerFixture, withRatingClient } from '../../testing/rating-worker-fixtures.ts'

const fixture = ratingWorkerFixture()

async function readRating(response: Response) {
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')

  const value: unknown = await response.json()

  return v.parse(catalogRatingMutationResponseSchema, value)
}

describe('unified rating HTTP contracts', () => {
  beforeEach(fixture.setup)

  afterAll(async () => {
    await fixture.cleanup()
  })

  it.each([
    {
      kind: 'movie',
      catalogItemId: fixture.movieId
    },
    {
      kind: 'series',
      catalogItemId: fixture.seriesId
    },
    {
      kind: 'season',
      catalogItemId: fixture.seriesId
    },
    {
      kind: 'episode',
      catalogItemId: fixture.seriesId
    }
  ] as const)('saves, corrects, reloads and removes a $kind score with confirmed context', async ({ kind, catalogItemId }) => {
    const path = fixture.path(kind)
    const initial = await fixture.request(path)
    const empty = await readRating(initial)

    expect(empty.score).toBeNull()
    expect(empty.viewing).toBeNull()

    const context = await fixture.context(catalogItemId)

    const created = await fixture.request(path, 'PUT', {
      ...context,
      score: 7,
      viewingDate: '2026-01-15'
    })

    const rated = await readRating(created)

    expect(rated.score).toBe(7)
    expect(rated.summary.currentViewingId).toBe(rated.viewing?.id)

    const nextContext = await fixture.context(catalogItemId)

    const correctedResponse = await fixture.request(path, 'PUT', {
      ...nextContext,
      score: 9
    })

    const corrected = await readRating(correctedResponse)
    const reload = await fixture.request(path)
    const reloaded = await readRating(reload)

    expect(corrected.score).toBe(9)
    expect(corrected.viewing?.id).toBe(rated.viewing?.id)
    expect(reloaded).toStrictEqual(corrected)

    const removeContext = await fixture.context(catalogItemId)
    const removedResponse = await fixture.request(path, 'DELETE', removeContext)
    const removed = await readRating(removedResponse)

    expect(removed.score).toBeNull()
    expect(removed.viewing?.id).toBe(rated.viewing?.id)

    const summary = await fixture.request(`${path}-summary`, 'GET', undefined, null)

    expect(summary.status).toBe(200)

    await expect(summary.json()).resolves.toStrictEqual({
      averageScore: null,
      ratingCount: 0
    })
  })

  it.each(['movie', 'series', 'season', 'episode'] as const)('requires authentication before reading or parsing %s writes', async kind => {
    const path = fixture.path(kind)
    const get = await fixture.request(path, 'GET', undefined, null)
    const put = await fixture.request(path, 'PUT', { score: 100 }, null)
    const remove = await fixture.request(path, 'DELETE', undefined, null)

    expect([get.status, put.status, remove.status]).toStrictEqual([401, 401, 401])
  })

  it.each([0, 11, 1.5, '8', null, true])('rejects invalid score %s at the HTTP boundary while preserving the saved score', async score => {
    const initialContext = await fixture.context(fixture.movieId)

    const initial = await fixture.request(fixture.path('movie'), 'PUT', {
      ...initialContext,
      score: 6,
      viewingDate: '2026-01-15'
    })

    const rated = await readRating(initial)
    const context = await fixture.context(fixture.movieId)

    const response = await fixture.request(fixture.path('movie'), 'PUT', {
      ...context,
      score,
      viewingDate: '2026-01-15'
    })

    expect(response.status).toBe(400)

    const count = await withRatingClient(async client => client.query<{ count: number }>('SELECT count(*)::integer AS count FROM catalog_viewings WHERE user_id = $1', [fixture.userId]))

    expect(count.rows[0]?.count).toBe(1)

    const current = await fixture.request(fixture.path('movie'))
    const saved = await readRating(current)

    expect(saved.score).toBe(6)
    expect(saved.viewing?.id).toBe(rated.viewing?.id)
  })

  it('requires request IDs and valid dates, rejects stale context, and returns a safe missing-target response', async () => {
    const legacy = await fixture.request(fixture.path('series'), 'PUT', { score: 7 })
    const context = await fixture.context(fixture.movieId)

    const invalidDate = await fixture.request(fixture.path('movie'), 'PUT', {
      ...context,
      score: 7,
      viewingDate: '2026-02-30'
    })

    const noDate = await fixture.request(fixture.path('movie'), 'PUT', {
      ...context,
      score: 7
    })

    const valid = await fixture.request(fixture.path('movie'), 'PUT', {
      ...context,
      score: 7,
      viewingDate: '2026-01-15'
    })

    const movieRatingPath = fixture.path('movie')
    const staleRequestId = randomUUID()

    const stale = await fixture.request(movieRatingPath, 'PUT', {
      ...context,
      requestId: staleRequestId,
      score: 9
    })

    const missingCatalogItemId = randomUUID()
    const missingRatingPath = `/items/${missingCatalogItemId}/rating`
    const unknownRequestId = randomUUID()

    const unknown = await fixture.request(missingRatingPath, 'PUT', {
      ...context,
      requestId: unknownRequestId,
      score: 7,
      viewingDate: '2026-01-15'
    })

    expect([legacy.status, invalidDate.status, noDate.status, valid.status, stale.status, unknown.status]).toStrictEqual([400, 400, 400, 200, 409, 404])

    await expect(unknown.json()).resolves.toStrictEqual({ error: {
      code: 'NOT_FOUND',
      message: 'This title could not be found.'
    } })
  })

  it('returns the live score on an old successful retry after a correction or removal', async () => {
    const context = await fixture.context(fixture.movieId)

    const input = {
      ...context,
      score: 7,
      viewingDate: '2026-01-15'
    }

    const first = await fixture.request(fixture.path('movie'), 'PUT', input)

    await readRating(first)

    const nextContext = await fixture.context(fixture.movieId)

    const correction = await fixture.request(fixture.path('movie'), 'PUT', {
      ...nextContext,
      score: 9
    })

    await readRating(correction)

    const replay = await fixture.request(fixture.path('movie'), 'PUT', input)
    const corrected = await readRating(replay)

    expect(corrected.score).toBe(9)

    const removeContext = await fixture.context(fixture.movieId)

    await fixture.request(fixture.path('movie'), 'DELETE', removeContext)

    const deletedReplay = await fixture.request(fixture.path('movie'), 'PUT', input)
    const deleted = await readRating(deletedReplay)

    expect(deleted.score).toBeNull()
  })

  it('keeps personal scores within the authenticated account and rejects a supplied owner', async () => {
    const context = await fixture.context(fixture.movieId)

    const created = await fixture.request(fixture.path('movie'), 'PUT', {
      ...context,
      score: 6,
      viewingDate: '2026-01-15'
    })

    await readRating(created)

    const otherResponse = await fixture.request(fixture.path('movie'), 'GET', undefined, fixture.otherCookie)
    const other = await readRating(otherResponse)
    const currentContext = await fixture.context(fixture.movieId)

    const forged = await fixture.request(fixture.path('movie'), 'PUT', {
      ...currentContext,
      userId: fixture.otherUserId,
      score: 9
    })

    expect(other.score).toBeNull()
    expect(other.viewing).toBeNull()
    expect(forged.status).toBe(400)

    const currentResponse = await fixture.request(fixture.path('movie'))
    const current = await readRating(currentResponse)

    expect(current.score).toBe(6)
  })

})
