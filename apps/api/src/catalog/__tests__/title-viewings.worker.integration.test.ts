/* oxlint-disable eslint/max-lines -- Viewing and rating endpoints share authentication and exact-record HTTP fixtures. */
import * as v from 'valibot'

import {
  catalogViewingMutationResponseSchema,
  catalogRatingMutationResponseSchema,
  type CatalogViewingMutationResponse,
  type CatalogViewingsResponse
} from '@tv/shared/catalog-viewings'

import { env, exports } from 'cloudflare:workers'
import { Client } from 'pg'
import type { CatalogTimelineResponse } from '@tv/shared/catalog-timeline'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashSessionToken } from '../../auth/session.ts'
import { assertDisposableTestDatabase } from '../../testing/test-database.ts'

const TEST_SESSION_TOKEN = 'j'.repeat(43)
const TEST_USER_ID = '60000000-0000-4000-8000-000000000005'
const TEST_COOKIE = `__Host-tv_session=${TEST_SESSION_TOKEN}`

async function withClient<Result>(run: (client: Client) => Promise<Result>): Promise<Result> {
  const client = new Client({ connectionString: env.DATABASE.connectionString })

  try {
    await client.connect()
    await assertDisposableTestDatabase(client)

    return await run(client)
  } finally {
    await client.end()
  }
}

async function findCatalogItemId(title: string): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(`
      SELECT id FROM catalog_items JOIN catalog_item_titles ON catalog_item_id = id
      WHERE title = $1 AND is_original
    `, [title])

    const id = result.rows[0]?.id

    if (id === undefined) {
      throw new Error(`${title} is missing from the seeded catalog`)
    }

    return id
  })
}

// oxlint-disable-next-line eslint/max-params -- Test requests keep the HTTP method, cookie and body explicit.
async function request(
  path: string,
  method = 'GET',
  cookie: string | null = TEST_COOKIE,
  body?: unknown
): Promise<Response> {
  const headers = new Headers()

  if (cookie !== null) {
    headers.set('Cookie', cookie)
  }

  if (body !== undefined) { headers.set('Content-Type', 'application/json') }

  const options: RequestInit = {
    headers,
    method
  }

  if (body !== undefined && method !== 'GET') { options.body = JSON.stringify(body) }

  const target = `https://tv-api.test${path}`
  const upstreamRequest = new Request(target, options)

  return exports.default.fetch(upstreamRequest)
}

function expectNoStore(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('no-store')
}

describe('title viewing Worker contract', () => {
  beforeEach(async () => {
    const hash = await hashSessionToken(TEST_SESSION_TOKEN)

    await withClient(async client => {
      await client.query('DELETE FROM users WHERE id = $1', [TEST_USER_ID])
      await client.query('INSERT INTO users (id, email) VALUES ($1, \'movie-viewings-worker@example.com\')', [TEST_USER_ID])
      await client.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'1 day\')', [TEST_USER_ID, hash])
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await withClient( async client => client.query('DELETE FROM users WHERE id = $1', [TEST_USER_ID]))
  })

  it('authenticates all viewing endpoints before validating IDs or bodies', async () => {
    const endpoints = [['GET', ''], ['POST', ''], ['GET', '/invalid'], ['PATCH', '/invalid'], ['DELETE', '/invalid'], ['PUT', '/invalid/rating'], ['DELETE', '/invalid/rating']]

    const requests = endpoints.map(async ([method, suffix]) => {
      const target = `/api/catalog/items/invalid/viewings${suffix}`
      const response = await request(target, method, null, { invalid: true })

      expect(response.status).toBe(401)
      expectNoStore(response)
    })

    await Promise.all(requests)
  })

  it.each([
    {
      name: 'malformed JSON',
      contentType: 'application/json',
      bodyKind: 'malformed',
      status: 400
    },
    {
      name: 'a non-JSON content type',
      contentType: 'text/plain',
      bodyKind: 'valid',
      status: 400
    },
    {
      name: 'JSON larger than 16 KiB',
      contentType: 'application/json',
      bodyKind: 'oversized',
      status: 413
    }
  ] as const)('rejects $name after authentication and before changing viewings', async ({ contentType, bodyKind, status }) => {
    const id = await findCatalogItemId('Dead Man')
    const path = `/api/catalog/items/${id}/viewings`
    const creationRequestId = crypto.randomUUID()

    const validBody = JSON.stringify({
      requestId: creationRequestId,
      mode: 'current',
      currentViewingId: null,
      contextVersion: 0,
      status: 'completed',
      startedOn: null,
      completedOn: '2026-10-17'
    })

    const padding = ' '.repeat(16_384)

    const bodies = {
      valid: validBody,
      malformed: '{',
      oversized: `${padding}${validBody}`
    }

    const body = bodies[bodyKind]
    const url = `https://tv-api.test${path}`

    const authenticatedRequest = new Request(url, {
      method: 'POST',

      headers: {
        Cookie: TEST_COOKIE,
        'Content-Type': contentType
      },

      body
    })

    const anonymousRequest = new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body
    })

    const [authenticated, anonymous] = await Promise.all([
      exports.default.fetch(authenticatedRequest),
      exports.default.fetch(anonymousRequest)
    ])

    expect(authenticated.status).toBe(status)
    expect(anonymous.status).toBe(401)
    expectNoStore(authenticated)
    expectNoStore(anonymous)
    await expect(authenticated.json()).resolves.toMatchObject({ error: { code: 'INVALID_REQUEST' } })
    await expect(anonymous.json()).resolves.toMatchObject({ error: { code: 'AUTHENTICATION_REQUIRED' } })

    const listing = await request(path)

    await expect(listing.json()).resolves.toMatchObject({
      items: [],

      summary: {
        currentViewingId: null,
        contextVersion: 0
      }
    })
  })

  it('replays a committed viewing and reads one stable timeline entry', async () => {
    const catalogItemId = await findCatalogItemId('Dead Man')
    const viewingId = crypto.randomUUID()
    const eventId = crypto.randomUUID()

    const input = {
      requestId: crypto.randomUUID(),
      mode: 'history',
      currentViewingId: null,
      contextVersion: 0,
      status: 'completed',
      startedOn: null,
      completedOn: '2024-02-03'
    }

    const inputJson = JSON.stringify(input)

    await withClient(async client => {
      await client.query('BEGIN')
      await client.query('INSERT INTO catalog_viewings (id, user_id, catalog_item_id, completed_on, recorded_at) VALUES ($1, $2, $3, \'2024-02-03\', \'2024-02-03 04:05:06.123456+00\')', [viewingId, TEST_USER_ID, catalogItemId])
      await client.query('INSERT INTO catalog_timeline_events (id, user_id, catalog_item_id, viewing_id, kind, occurred_at) VALUES ($1, $2, $3, $4, \'movie_viewing\', \'2024-02-03 04:05:06.123456+00\')', [eventId, TEST_USER_ID, catalogItemId, viewingId])
      await client.query('INSERT INTO catalog_viewing_requests (user_id, request_id, catalog_item_id, action, input, viewing_id, result, watch_ids) VALUES ($1, $2, $3, \'viewing:create\', $4::jsonb, $5, \'{}\'::jsonb, \'[]\'::jsonb)', [TEST_USER_ID, input.requestId, catalogItemId, inputJson, viewingId])
      await client.query('COMMIT')
    })

    const path = `/api/catalog/items/${catalogItemId}/viewings`
    const replayResponse = await request(path, 'POST', TEST_COOKIE, input)
    const replay = await replayResponse.json<CatalogViewingMutationResponse>()

    expect(replayResponse.status).toBe(200)
    expectNoStore(replayResponse)
    expect(replay.viewing.id).toBe(viewingId)
    expect(replay.viewing.recordedAt).toBe('2024-02-03T04:05:06.123456Z')
    expect(replay.summary.completedCount).toBe(1)

    const timelinePath = `/api/catalog/items/${catalogItemId}/timeline?timeZone=UTC`
    const timelineResponse = await request(timelinePath)
    const timeline = await timelineResponse.json<CatalogTimelineResponse>()

    expect(timelineResponse.status).toBe(200)
    expectNoStore(timelineResponse)

    expect(timeline.items).toStrictEqual([{
      id: eventId,
      kind: 'movie_viewing',
      occurredAt: '2024-02-03T00:00:00.000000Z',
      viewingId,
      startedOn: null,
      completedOn: '2024-02-03',
      score: null
    }])

    const retryResponse = await request(path, 'POST', TEST_COOKIE, input)
    const retry = await retryResponse.json<unknown>()

    expect(retry).toStrictEqual(replay)

    const repeatedTimelineResponse = await request(timelinePath)
    const repeatedTimeline = await repeatedTimelineResponse.json<unknown>()

    expect(repeatedTimeline).toStrictEqual(timeline)
  })

  it('creates, replays, edits and deletes records without restoring a deleted request key', async () => {
    const id = await findCatalogItemId('Dead Man')
    const path = `/api/catalog/items/${id}/viewings`

    const input = {
      requestId: crypto.randomUUID(),
      mode: 'current',
      currentViewingId: null,
      contextVersion: 0,
      status: 'completed',
      startedOn: null,
      completedOn: '2026-10-17'
    }

    const firstResponse = await request(path, 'POST', TEST_COOKIE, input)
    const first = await firstResponse.json<CatalogViewingMutationResponse>()

    expect(firstResponse.status).toBe(200)
    expectNoStore(firstResponse)

    expect(first).toMatchObject({
      viewing: {
        status: 'completed',
        startedOn: null,
        completedOn: '2026-10-17',
        revision: 1
      },

      summary: {
        completedCount: 1,
        currentViewingId: first.viewing.id,
        contextVersion: 1
      }
    })

    expect(first.viewing.id).not.toBe(id)

    const replay = await request(path, 'POST', TEST_COOKIE, input)

    await expect(replay.json()).resolves.toStrictEqual(first)

    const conflict = await request(path, 'POST', TEST_COOKIE, {
      ...input,
      requestId: crypto.randomUUID()
    })

    expect(conflict.status).toBe(409)

    const target = `${path}/${first.viewing.id}`
    const point = await request(target)

    await expect(point.json()).resolves.toStrictEqual({ viewing: first.viewing })

    const dateRequestId = crypto.randomUUID()

    const dates = {
      requestId: dateRequestId,
      status: 'completed',
      revision: 1,
      startedOn: '2024-02-29',
      completedOn: '2026-10-17'
    }

    const updated = await request(target, 'PATCH', TEST_COOKIE, dates)
    const edit = await updated.json<CatalogViewingMutationResponse>()

    expect(edit.viewing).toMatchObject({
      startedOn: '2024-02-29',
      revision: 2,
      recordedAt: first.viewing.recordedAt
    })

    const repeatedEdit = await request(target, 'PATCH', TEST_COOKIE, dates)

    await expect(repeatedEdit.json()).resolves.toStrictEqual(edit)

    const staleDeletionRequestId = crypto.randomUUID()

    const staleDelete = await request(target, 'DELETE', TEST_COOKIE, {
      requestId: staleDeletionRequestId,
      revision: 1
    })

    expect(staleDelete.status).toBe(409)

    const deletionRequestId = crypto.randomUUID()

    const deletion = {
      requestId: deletionRequestId,
      revision: 2
    }

    const deleted = await request(target, 'DELETE', TEST_COOKIE, deletion)

    await expect(deleted.json()).resolves.toStrictEqual({ summary: {
      completedCount: 0,
      currentViewingId: null,
      contextVersion: 3,
      currentViewingScore: null,
      currentVoteScore: null
    } })

    const late = await request(path, 'POST', TEST_COOKIE, input)

    expect(late.status).toBe(409)

    const missing = await request(target)

    expect(missing.status).toBe(404)

    const again = await request(target, 'DELETE', TEST_COOKIE, deletion)

    expect(again.status).toBe(409)
    expectNoStore(again)
  })

  it('rejects impossible dates, reversed dates, unsupported state and invalid cursors', async () => {
    const id = await findCatalogItemId('Dead Man')
    const path = `/api/catalog/items/${id}/viewings`

    const invalidInputs = [{ completedOn: undefined }, { completedOn: null }, { completedOn: '' }, { startedOn: '2023-02-29' }, { completedOn: '0000-01-01' }, {
      startedOn: '2020-02-02',
      completedOn: '2020-02-01'
    }, { status: 'started' }, { mode: 'rewatch' }, { userId: TEST_USER_ID }]

    const requests = invalidInputs.map(async extra => {
      const response = await request(path, 'POST', TEST_COOKIE, {
        requestId: crypto.randomUUID(),
        mode: 'history',
        currentViewingId: null,
        contextVersion: 0,
        status: 'completed',
        startedOn: null,
        completedOn: '2026-10-17',
        ...extra
      })

      expect(response.status).toBe(400)
      expectNoStore(response)
    })

    await Promise.all(requests)

    const series = await findCatalogItemId('Spartacus')
    const response = await request(`/api/catalog/items/${series}/viewings`)

    expect(response.status).toBe(200)

    await expect(response.json()).resolves.toMatchObject({
      items: [],
      summary: { currentViewingId: null }
    })

    const invalid = await request(`${path}?cursor=bad`)

    expect(invalid.status).toBe(400)
  })

  it('pages tied timestamps without requiring the cursor row and resolves a direct link outside the page', async () => {
    const id = await findCatalogItemId('Dead Man')

    await withClient( async client => client.query('INSERT INTO catalog_viewings (user_id, catalog_item_id, completed_on, recorded_at) SELECT $1, $2, \'2020-01-01\'::date, \'2020-01-01T12:00:00.123456Z\' FROM generate_series(1, 23)', [TEST_USER_ID, id]))

    const path = `/api/catalog/items/${id}/viewings`
    const firstResponse = await request(path)
    const first = await firstResponse.json<CatalogViewingsResponse>()

    expect(first.items).toHaveLength(20)
    expect(first.summary.completedCount).toBe(23)
    await withClient( async client => client.query('DELETE FROM catalog_viewings WHERE id = $1', [first.items.at(-1)?.id]))

    const nextResponse = await request(`${path}?cursor=${first.nextCursor}`)
    const next = await nextResponse.json<CatalogViewingsResponse>()

    expect(next.items).toHaveLength(3)
    expect(next.nextCursor).toBeNull()

    const point = await request(`${path}/${next.items[0]?.id}`)

    await expect(point.json()).resolves.toStrictEqual({ viewing: next.items[0] })

    const allItems = [...first.items, ...next.items]
    const ids = allItems.map(item => item.id)
    const distinct = new Set(ids)
    const exactTimes = next.items.every(item => item.recordedAt === '2020-01-01T12:00:00.123456Z')

    expect(distinct.size).toBe(23)
    expect(exactTimes).toBe(true)
  })

  it('returns safe infrastructure errors while logging the original failure', async () => {
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {
      // Captured diagnostics are checked below.
    })

    const id = await findCatalogItemId('Dead Man')

    await withClient(async client => {
      await client.query('ALTER TABLE catalog_viewings RENAME TO catalog_viewings_unavailable')

      try {
        const response = await request(`/api/catalog/items/${id}/viewings`)

        expect(response.status).toBe(503)
        expectNoStore(response)

        await expect(response.json()).resolves.toMatchObject({ error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'The catalog is temporarily unavailable.'
        } })

        const serialized = JSON.stringify(logs.mock.calls)

        expect(serialized).toContain('catalog_viewings')
        expect(serialized).toContain('does not exist')
      } finally {
        await client.query('ALTER TABLE catalog_viewings_unavailable RENAME TO catalog_viewings')
      }
    })
  })

  it('rates exact viewings, rejects stale context and keeps historical writes out of the current vote', async () => {
    const id = await findCatalogItemId('Dead Man')
    const path = `/api/catalog/items/${id}/viewings`
    const ratingPath = `/api/catalog/items/${id}/rating`
    const firstRequestId = crypto.randomUUID()

    const firstResponse = await request(path, 'POST', TEST_COOKIE, {
      mode: 'current',
      requestId: firstRequestId,
      currentViewingId: null,
      contextVersion: 0,
      status: 'completed',
      startedOn: null,
      completedOn: '2026-10-17'
    })

    const firstRaw: unknown = await firstResponse.json()
    const first = v.parse(catalogViewingMutationResponseSchema, firstRaw)

    expect(firstResponse.status).toBe(200)
    expect(first.viewing.score).toBeNull()

    const correctionRequestId = crypto.randomUUID()

    const corrected = await request(ratingPath, 'PUT', TEST_COOKIE, {
      requestId: correctionRequestId,
      currentViewingId: first.viewing.id,
      contextVersion: first.summary.contextVersion,
      timeZone: 'UTC',
      score: 6
    })

    const correctedRaw: unknown = await corrected.json()
    const result = v.parse(catalogRatingMutationResponseSchema, correctedRaw)

    expect(result.viewing?.id).toBe(first.viewing.id)
    expect(result.viewing?.score).toBe(6)

    const secondRequestId = crypto.randomUUID()

    const secondResponse = await request(path, 'POST', TEST_COOKIE, {
      mode: 'current',
      requestId: secondRequestId,
      currentViewingId: first.viewing.id,
      contextVersion: result.summary.contextVersion,
      status: 'completed',
      startedOn: null,
      completedOn: '2026-10-17'
    })

    const secondRaw: unknown = await secondResponse.json()
    const second = v.parse(catalogViewingMutationResponseSchema, secondRaw)

    expect(second.viewing.score).toBeNull()
    expect(second.summary.currentVoteScore).toBe(6)

    const secondRatingRequestId = crypto.randomUUID()

    const secondRatingResponse = await request(ratingPath, 'PUT', TEST_COOKIE, {
      requestId: secondRatingRequestId,
      currentViewingId: second.viewing.id,
      contextVersion: second.summary.contextVersion,
      timeZone: 'UTC',
      score: 7
    })

    const secondRatingRaw: unknown = await secondRatingResponse.json()
    const secondRating = v.parse(catalogRatingMutationResponseSchema, secondRatingRaw)
    const historicalPath = `${path}/${first.viewing.id}/rating`
    const historicalRatingRequestId = crypto.randomUUID()

    const historical = await request(historicalPath, 'PUT', TEST_COOKIE, {
      requestId: historicalRatingRequestId,
      revision: result.viewing?.revision,
      timeZone: 'UTC',
      score: 9
    })

    const historicalRaw: unknown = await historical.json()
    const updated = v.parse(catalogRatingMutationResponseSchema, historicalRaw)

    expect(updated.viewing?.score).toBe(9)
    expect(updated.summary.currentVoteScore).toBe(7)
    expect(updated.summary.currentViewingId).toBe(second.viewing.id)

    const staleRequestId = crypto.randomUUID()

    const stale = await request(ratingPath, 'PUT', TEST_COOKIE, {
      requestId: staleRequestId,
      currentViewingId: first.viewing.id,
      contextVersion: first.summary.contextVersion,
      timeZone: 'UTC',
      score: 3
    })

    const missingContext = await request(ratingPath, 'PUT', TEST_COOKIE, { score: 3 })
    const invalidHistoryRequestId = crypto.randomUUID()

    const invalidHistory = await request(historicalPath, 'PUT', TEST_COOKIE, {
      requestId: invalidHistoryRequestId,
      revision: updated.viewing?.revision,
      timeZone: 'UTC',
      score: 11
    })

    const currentHistoryPath = `${path}/${second.viewing.id}/rating`
    const currentAsHistoryRequestId = crypto.randomUUID()

    const currentAsHistory = await request(currentHistoryPath, 'DELETE', TEST_COOKIE, {
      requestId: currentAsHistoryRequestId,
      revision: secondRating.viewing?.revision,
      timeZone: 'UTC'
    })

    expect(stale.status).toBe(409)
    expect(missingContext.status).toBe(400)
    expect(invalidHistory.status).toBe(400)
    expect(currentAsHistory.status).toBe(409)

    const removalRequestId = crypto.randomUUID()

    const removed = await request(historicalPath, 'DELETE', TEST_COOKIE, {
      requestId: removalRequestId,
      revision: updated.viewing?.revision,
      timeZone: 'UTC'
    })

    const removedRaw: unknown = await removed.json()
    const afterRemoval = v.parse(catalogRatingMutationResponseSchema, removedRaw)

    expect(afterRemoval.viewing?.score).toBeNull()
    expect(afterRemoval.summary.currentVoteScore).toBe(7)

    const currentVote = await request(ratingPath)
    const voteRaw: unknown = await currentVote.json()
    const vote = v.parse(catalogRatingMutationResponseSchema, voteRaw)

    expect(vote.score).toBe(7)
    expect(vote.viewing?.id).toBe(second.viewing.id)
    expectNoStore(stale)
    expectNoStore(removed)
  })
})
