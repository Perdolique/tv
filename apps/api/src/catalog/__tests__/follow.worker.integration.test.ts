import { env, exports } from 'cloudflare:workers'
import { Client } from 'pg'
import type { CatalogErrorEnvelope, CatalogFollowResponse } from '@tv/shared/catalog'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashSessionToken } from '../../auth/session.ts'
import { assertDisposableTestDatabase } from '../../testing/test-database.ts'

const TEST_SESSION_TOKEN = 'f'.repeat(43)
const TEST_USER_ID = '40000000-0000-4000-8000-000000000008'
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

async function findDeadManId(): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(`
      SELECT id FROM catalog_items JOIN catalog_item_titles ON catalog_item_id = id
      WHERE title = 'Dead Man' AND is_original
    `)

    const id = result.rows[0]?.id

    if (id === undefined) {
      throw new Error('Dead Man is missing from the seeded catalog')
    }

    return id
  })
}

async function request(
  path: string,
  method = 'GET',
  cookie: string | null = TEST_COOKIE
): Promise<Response> {
  const headers = new Headers()

  if (cookie !== null) {
    headers.set('Cookie', cookie)
  }

  return exports.default.fetch(new Request(`https://tv-api.test${path}`, {
    headers,
    method
  }))
}

function expectNoStore(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('no-store')
}

describe('catalog follow Worker contract', () => {
  beforeEach(async () => {
    const tokenHash = await hashSessionToken(TEST_SESSION_TOKEN)

    await withClient(async (client) => {
      await client.query('DELETE FROM users WHERE id = $1', [TEST_USER_ID])

      await client.query(`
        INSERT INTO users (id, email)
        VALUES ($1, 'catalog-follow@example.com')
      `, [TEST_USER_ID])

      await client.query(`
        INSERT INTO sessions (user_id, token_hash, expires_at)
        VALUES ($1, $2, now() + interval '30 days')
      `, [TEST_USER_ID, tokenHash])
    })
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('requires a verified session for every method', async () => {
    const id = await findDeadManId()

    const responses = await Promise.all(['GET', 'PUT', 'DELETE'].map(async method => (
      request(`/api/catalog/items/${id}/follow`, method, null)
    )))

    const bodies = await Promise.all(responses.map(async response => response.json()))

    for (const [index, response] of responses.entries()) {
      expect(response.status).toBe(401)

      expect(bodies[index]).toStrictEqual({ error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication is required.'
      } })

      expectNoStore(response)
    }
  })

  it('reads, follows and unfollows idempotently without a request body', async () => {
    const id = await findDeadManId()
    const path = `/api/catalog/items/${id}/follow`
    const initial = await request(path)
    const followed = await request(path, 'PUT')
    const followedAgain = await request(path, 'PUT')
    const readFollowed = await request(path)
    const unfollowed = await request(path, 'DELETE')
    const unfollowedAgain = await request(path, 'DELETE')
    const responses = [initial, followed, followedAgain, readFollowed, unfollowed, unfollowedAgain]
    const expectedStates = [false, true, true, true, false, false]

    const bodies = await Promise.all(
      responses.map(async response => response.json<CatalogFollowResponse>())
    )

    for (const [index, response] of responses.entries()) {
      expect(response.status).toBe(200)

      expect(bodies[index]).toStrictEqual({
        followed: expectedStates[index]
      })

      expectNoStore(response)
    }
  })

  it.each(['GET', 'PUT', 'DELETE'])('returns structured invalid and missing title errors for %s', async (method) => {
    const invalid = await request('/api/catalog/items/not-a-uuid/follow', method)

    const missing = await request(
      '/api/catalog/items/01991a00-0000-7000-8000-999999999999/follow',
      method
    )

    expect(invalid.status).toBe(400)

    await expect(invalid.json()).resolves.toMatchObject({ error: {
      code: 'INVALID_REQUEST',
      fields: { id: 'Use a valid catalog item UUID.' }
    } })

    expect(missing.status).toBe(404)

    await expect(missing.json()).resolves.toStrictEqual({ error: {
      code: 'NOT_FOUND',
      message: 'This title could not be found.'
    } })

    expectNoStore(invalid)
    expectNoStore(missing)
  })

  it.each(['GET', 'PUT', 'DELETE'])('returns a safe 503 and keeps the raw database failure in telemetry for %s', async (method) => {
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {
      // Expected failure is inspected below.
    })

    const id = await findDeadManId()

    await withClient(async (client) => {
      await client.query('ALTER TABLE catalog_item_follows RENAME TO catalog_item_follows_unavailable')

      try {
        const response = await request(`/api/catalog/items/${id}/follow`, method)
        const body = await response.json<CatalogErrorEnvelope>()

        expect(response.status).toBe(503)

        expect(body).toStrictEqual({ error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'The catalog is temporarily unavailable.'
        } })

        expectNoStore(response)

        const serialized = JSON.stringify(logs.mock.calls)

        expect(serialized).toContain('catalog_item_follows')
        expect(serialized).toContain('does not exist')
        expect(serialized).toContain('requestId')
      } finally {
        await client.query('ALTER TABLE catalog_item_follows_unavailable RENAME TO catalog_item_follows')
      }
    })
  })
})
