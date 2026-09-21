import { env, exports } from 'cloudflare:workers'
import { Client } from 'pg'
import type { CatalogErrorEnvelope, CatalogWatchedResponse } from '@tv/shared/catalog'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashSessionToken } from '../../auth/session.ts'
import { assertDisposableTestDatabase } from '../../testing/test-database.ts'

const TEST_SESSION_TOKEN = 'v'.repeat(43)
const TEST_USER_ID = '60000000-0000-4000-8000-000000000001'
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

describe('catalog watched Worker contract', () => {
  beforeEach(async () => {
    const tokenHash = await hashSessionToken(TEST_SESSION_TOKEN)

    await withClient(async (client) => {
      await client.query('DELETE FROM users WHERE id = $1', [TEST_USER_ID])

      await client.query(`
        INSERT INTO users (id, email)
        VALUES ($1, 'catalog-watched@example.com')
      `, [TEST_USER_ID])

      await client.query(`
        INSERT INTO sessions (user_id, token_hash, expires_at)
        VALUES ($1, $2, now() + interval '30 days')
      `, [TEST_USER_ID, tokenHash])
    })
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('requires a verified session for every method', async () => {
    const id = await findCatalogItemId('Dead Man')
    const methods = ['GET', 'PUT', 'DELETE']

    const paths = [
      `/api/catalog/items/${id}/watched`,
      '/api/catalog/items/not-a-uuid/watched'
    ]

    const requests = paths.flatMap(path => methods.map(async method => (
      request(path, method, null)
    )))

    const responses = await Promise.all(requests)
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

  it('marks and unmarks idempotently without changing follows or the original timestamp', async () => {
    const id = await findCatalogItemId('Dead Man')
    const path = `/api/catalog/items/${id}/watched`

    await withClient(async (client) => {
      await client.query(`
        INSERT INTO catalog_item_follows (user_id, catalog_item_id)
        VALUES ($1, $2)
      `, [TEST_USER_ID, id])
    })

    const initial = await request(path)
    const marked = await request(path, 'PUT')

    const firstTimestamp = await withClient(async (client) => {
      const result = await client.query<{ marked_at: Date }>(`
        SELECT marked_at FROM catalog_movie_watches
        WHERE user_id = $1 AND catalog_item_id = $2
      `, [TEST_USER_ID, id])

      return result.rows[0]?.marked_at
    })

    await withClient(async (client) => client.query('SELECT pg_sleep(0.01)'))

    const markedAgain = await request(path, 'PUT')

    const repeatedTimestamp = await withClient(async (client) => {
      const result = await client.query<{ marked_at: Date }>(`
        SELECT marked_at FROM catalog_movie_watches
        WHERE user_id = $1 AND catalog_item_id = $2
      `, [TEST_USER_ID, id])

      return result.rows[0]?.marked_at
    })

    const readMarked = await request(path)
    const unmarked = await request(path, 'DELETE')
    const unmarkedAgain = await request(path, 'DELETE')
    const responses = [initial, marked, markedAgain, readMarked, unmarked, unmarkedAgain]
    const expectedStates = [false, true, true, true, false, false]

    const bodies = await Promise.all(
      responses.map(async response => response.json<CatalogWatchedResponse>())
    )

    for (const [index, response] of responses.entries()) {
      expect(response.status).toBe(200)

      expect(bodies[index]).toStrictEqual({
        watched: expectedStates[index]
      })

      expectNoStore(response)
    }

    await withClient(async (client) => {
      const follows = await client.query<{ count: string }>(`
        SELECT count(*) FROM catalog_item_follows
        WHERE user_id = $1 AND catalog_item_id = $2
      `, [TEST_USER_ID, id])

      const watches = await client.query<{ count: string; marked_at: Date }>(`
        SELECT count(*)::text AS count, max(marked_at) AS marked_at
        FROM catalog_movie_watches
        WHERE user_id = $1 AND catalog_item_id = $2
      `, [TEST_USER_ID, id])

      expect(firstTimestamp).toBeInstanceOf(Date)
      expect(repeatedTimestamp).toStrictEqual(firstTimestamp)
      expect(follows.rows[0]?.count).toBe('1')
      expect(watches.rows[0]?.count).toBe('0')
    })
  })

  it.each(['GET', 'PUT', 'DELETE'])('rejects series for %s', async (method) => {
    const id = await findCatalogItemId('Spartacus')
    const response = await request(`/api/catalog/items/${id}/watched`, method)

    expect(response.status).toBe(400)

    await expect(response.json()).resolves.toStrictEqual({ error: {
      code: 'INVALID_REQUEST',
      fields: { id: 'Only catalog movies can be marked as watched.' },
      message: 'The request is invalid.'
    } })

    expectNoStore(response)
  })

  it.each(['GET', 'PUT', 'DELETE'])('returns structured invalid and missing title errors for %s', async (method) => {
    const invalid = await request('/api/catalog/items/not-a-uuid/watched', method)

    const missing = await request(
      '/api/catalog/items/01991a00-0000-7000-8000-999999999999/watched',
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

    const id = await findCatalogItemId('Dead Man')

    await withClient(async (client) => {
      await client.query('ALTER TABLE catalog_movie_watches RENAME TO catalog_movie_watches_unavailable')

      try {
        const response = await request(`/api/catalog/items/${id}/watched`, method)
        const body = await response.json<CatalogErrorEnvelope>()

        expect(response.status).toBe(503)

        expect(body).toStrictEqual({ error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'The catalog is temporarily unavailable.'
        } })

        expectNoStore(response)

        const serialized = JSON.stringify(logs.mock.calls)

        expect(serialized).toContain('catalog_movie_watches')
        expect(serialized).toContain('does not exist')
        expect(serialized).toContain('requestId')
      } finally {
        await client.query('ALTER TABLE catalog_movie_watches_unavailable RENAME TO catalog_movie_watches')
      }
    })
  })
})
