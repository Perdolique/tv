import { env, exports } from 'cloudflare:workers'
import type { CatalogErrorEnvelope, CatalogWatchlistResponse } from '@tv/shared/catalog'
import { Client } from 'pg'
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashSessionToken } from '../../auth/session.ts'
import { assertDisposableTestDatabase } from '../../testing/test-database.ts'

const TEST_SESSION_TOKEN = 'w'.repeat(43)
const TEST_USER_ID = '50000000-0000-4000-8000-000000000003'
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

async function request(
  path = '/api/catalog/watchlist',
  cookie: string | null = TEST_COOKIE
): Promise<Response> {
  const headers = new Headers()

  if (cookie !== null) {
    headers.set('Cookie', cookie)
  }

  return exports.default.fetch(new Request(`https://tv-api.test${path}`, { headers }))
}

function expectNoStore(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('no-store')
}

describe('catalog watchlist Worker contract', () => {
  beforeEach(async () => {
    const tokenHash = await hashSessionToken(TEST_SESSION_TOKEN)

    await withClient(async (client) => {
      await client.query('DELETE FROM users WHERE id = $1', [TEST_USER_ID])

      await client.query(`
        INSERT INTO users (id, email)
        VALUES ($1, 'catalog-watchlist@example.com')
      `, [TEST_USER_ID])

      await client.query(`
        INSERT INTO sessions (user_id, token_hash, expires_at)
        VALUES ($1, $2, now() + interval '30 days')
      `, [TEST_USER_ID, tokenHash])
    })
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('requires a verified session and returns an empty private list', async () => {
    const anonymous = await request('/api/catalog/watchlist', null)
    const authenticated = await request()

    expect(anonymous.status).toBe(401)

    await expect(anonymous.json()).resolves.toStrictEqual({ error: {
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Authentication is required.'
    } })

    expect(authenticated.status).toBe(200)
    await expect(authenticated.json()).resolves.toStrictEqual({ items: [] })
    expectNoStore(anonymous)
    expectNoStore(authenticated)
  })

  it('returns localized followed titles newest first without duplicate items', async () => {
    const ids = await withClient(async (client) => {
      const seeded = await client.query<{ id: string; title: string }>(`
        SELECT id, title
        FROM catalog_items JOIN catalog_item_titles ON catalog_item_id = id
        WHERE is_original AND title IN ('Dead Man', 'Dune')
      `)

      const deadManId = seeded.rows.find(row => row.title === 'Dead Man')?.id
      const duneId = seeded.rows.find(row => row.title === 'Dune')?.id

      assert(deadManId !== undefined, 'Dead Man is missing from the watchlist catalog fixtures')
      assert(duneId !== undefined, 'Dune is missing from the watchlist catalog fixtures')

      await client.query(`
        INSERT INTO catalog_item_follows (user_id, catalog_item_id, followed_at)
        VALUES
          ($1, $2, '2026-09-10T12:00:00Z'),
          ($1, $3, '2026-09-11T12:00:00Z')
      `, [TEST_USER_ID, deadManId, duneId])

      return {
        deadManId,
        duneId
      }
    })

    const response = await request('/api/catalog/watchlist?titleLocale=ru-RU')
    const body = await response.json<CatalogWatchlistResponse>()

    expect(response.status).toBe(200)
    expect(body.items).toHaveLength(2)
    expect(body.items.map(item => item.id)).toStrictEqual([ids.duneId, ids.deadManId])

    expect(body.items[1]).toMatchObject({
      posterUrl: '/posters/dead-man-1995.webp',
      title: 'Мертвец',
      titleLocale: 'ru'
    })

    expectNoStore(response)
  })

  it('rejects an invalid title locale after authentication', async () => {
    const response = await request('/api/catalog/watchlist?titleLocale=not_a_locale')

    expect(response.status).toBe(400)

    await expect(response.json()).resolves.toStrictEqual({ error: {
      code: 'INVALID_REQUEST',

      fields: {
        titleLocale: 'Use a valid BCP 47 locale.'
      },

      message: 'The request is invalid.'
    } })

    expectNoStore(response)
  })

  it('requires authentication before validating the title locale', async () => {
    const response = await request('/api/catalog/watchlist?titleLocale=not_a_locale', null)

    expect(response.status).toBe(401)

    await expect(response.json()).resolves.toStrictEqual({ error: {
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Authentication is required.'
    } })

    expectNoStore(response)
  })

  it('returns a safe 503 and keeps the raw database failure in telemetry', async () => {
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {
      // Expected failure is inspected below.
    })

    await withClient(async (client) => {
      await client.query('ALTER TABLE catalog_item_follows RENAME TO catalog_item_follows_unavailable')

      try {
        const response = await request()
        const body = await response.json<CatalogErrorEnvelope>()

        expect(response.status).toBe(503)

        expect(body).toStrictEqual({ error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'The catalog is temporarily unavailable.'
        } })

        const serialized = JSON.stringify(logs.mock.calls)

        expect(serialized).toContain('catalog_item_follows')
        expect(serialized).toContain('does not exist')
        expect(serialized).toContain('requestId')
        expectNoStore(response)
      } finally {
        await client.query('ALTER TABLE catalog_item_follows_unavailable RENAME TO catalog_item_follows')
      }
    })
  })

  it('returns a safe 500 for a broken original-title invariant', async () => {
    const catalogItemId = '50000000-0000-4000-8000-000000000004'

    const logs = vi.spyOn(console, 'error').mockImplementation(() => {
      // Expected failure is inspected below.
    })

    await withClient(async (client) => {
      try {
        await client.query(`
          INSERT INTO catalog_items (id, type)
          VALUES ($1, 'movie')
        `, [catalogItemId])

        await client.query(`
          INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original)
          VALUES ($1, 'en', 'Broken watchlist invariant', false)
        `, [catalogItemId])

        await client.query(`
          INSERT INTO catalog_item_follows (user_id, catalog_item_id)
          VALUES ($1, $2)
        `, [TEST_USER_ID, catalogItemId])

        const response = await request()

        expect(response.status).toBe(500)

        await expect(response.json()).resolves.toStrictEqual({ error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred.'
        } })

        expect(JSON.stringify(logs.mock.calls)).toContain(
          `Catalog item ${catalogItemId} has no original title`
        )

        expectNoStore(response)
      } finally {
        await client.query('DELETE FROM catalog_items WHERE id = $1', [catalogItemId])
      }
    })
  })
})
