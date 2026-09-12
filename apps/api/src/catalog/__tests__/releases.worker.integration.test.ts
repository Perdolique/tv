import { env, exports } from 'cloudflare:workers'
import type { CatalogErrorEnvelope, CatalogReleasesResponse } from '@tv/shared/catalog'
import { Client } from 'pg'
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashSessionToken } from '../../auth/session.ts'
import { assertDisposableTestDatabase } from '../../testing/test-database.ts'

const TEST_SESSION_TOKEN = 'r'.repeat(43)
const EXPIRED_SESSION_TOKEN = 'e'.repeat(43)
const TEST_USER_ID = '70000000-0000-4000-8000-000000000001'
const TEST_REQUEST_ID = '70000000-0000-4000-8000-000000000099'
const TEST_COOKIE = `__Host-tv_session=${TEST_SESSION_TOKEN}`

const TEST_RELEASE_IDS = [
  '70000000-0000-4000-8000-000000000011',
  '70000000-0000-4000-8000-000000000012'
]

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
  path = '/api/catalog/releases?from=2026-10-01&to=2026-10-31',
  cookie: string | null = TEST_COOKIE
): Promise<Response> {
  const headers = new Headers()

  if (cookie !== null) {
    headers.set('Cookie', cookie)
  }

  headers.set('X-Request-ID', TEST_REQUEST_ID)

  return exports.default.fetch(new Request(`https://tv-api.test${path}`, { headers }))
}

function expectNoStore(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('no-store')
}

describe('catalog releases Worker contract', () => {
  beforeEach(async () => {
    const tokenHash = await hashSessionToken(TEST_SESSION_TOKEN)

    await withClient(async (client) => {
      await client.query('DELETE FROM catalog_releases WHERE id = ANY($1::uuid[])', [TEST_RELEASE_IDS])
      await client.query('DELETE FROM users WHERE id = $1', [TEST_USER_ID])

      await client.query(`
        INSERT INTO users (id, email)
        VALUES ($1, 'catalog-releases@example.com')
      `, [TEST_USER_ID])

      await client.query(`
        INSERT INTO sessions (user_id, token_hash, expires_at)
        VALUES ($1, $2, now() + interval '30 days')
      `, [TEST_USER_ID, tokenHash])
    })
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('requires a current session and returns an empty private list', async () => {
    const expiredHash = await hashSessionToken(EXPIRED_SESSION_TOKEN)

    await withClient(async (client) => {
      await client.query(`
        INSERT INTO sessions (user_id, token_hash, expires_at)
        VALUES ($1, $2, now() - interval '1 day')
      `, [TEST_USER_ID, expiredHash])
    })

    const anonymous = await request(undefined, null)
    const expired = await request(undefined, `__Host-tv_session=${EXPIRED_SESSION_TOKEN}`)
    const authenticated = await request()

    for (const response of [anonymous, expired]) {
      expect(response.status).toBe(401)
      expectNoStore(response)
    }

    const authenticationError = {
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication is required.'
      }
    }

    await expect(Promise.all([
      anonymous.json(),
      expired.json()
    ])).resolves.toStrictEqual([
      authenticationError,
      authenticationError
    ])

    expect(authenticated.status).toBe(200)
    await expect(authenticated.json()).resolves.toStrictEqual({ items: [] })
    expectNoStore(authenticated)
  })

  it('returns localized separate episodes of a followed title in stable order', async () => {
    const wireId = await withClient(async (client) => {
      const seeded = await client.query<{ id: string }>(`
        SELECT id FROM catalog_items JOIN catalog_item_titles ON catalog_item_id = id
        WHERE title = 'The Wire' AND is_original
      `)

      const id = seeded.rows[0]?.id

      assert(id !== undefined, 'The Wire is missing from the release catalog fixtures')

      await client.query(`
        INSERT INTO catalog_item_follows (user_id, catalog_item_id)
        VALUES ($1, $2)
      `, [TEST_USER_ID, id])

      await client.query(`
        INSERT INTO catalog_releases (id, catalog_item_id, release_date, season_number, episode_number)
        VALUES
          ($1, $3, '2026-10-02', 6, 2),
          ($2, $3, '2026-10-02', 6, 1)
      `, [TEST_RELEASE_IDS[1], TEST_RELEASE_IDS[0], id])

      return id
    })

    const response = await request('/api/catalog/releases?from=2026-10-02&to=2026-10-02&titleLocale=ru-RU')
    const body = await response.json<CatalogReleasesResponse>()

    expect(response.status).toBe(200)
    expect(body.items).toHaveLength(2)
    expect(body.items.map(item => item.releaseId)).toStrictEqual(TEST_RELEASE_IDS)
    expect(body.items.map(item => item.episodeNumber)).toStrictEqual([1, 2])

    for (const item of body.items) {
      expect(item).toMatchObject({
        id: wireId,
        releaseDate: '2026-10-02',
        seasonNumber: 6,
        title: 'Прослушка',
        titleLocale: 'ru',
        type: 'series'
      })
    }

    expectNoStore(response)
  })

  it('validates dates and locale only after authentication', async () => {
    const anonymous = await request('/api/catalog/releases?from=bad&to=also-bad&titleLocale=not_a_locale', null)

    expect(anonymous.status).toBe(401)

    await expect(anonymous.json()).resolves.toStrictEqual({ error: {
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Authentication is required.'
    } })

    const missing = await request('/api/catalog/releases')

    expect(missing.status).toBe(400)

    await expect(missing.json()).resolves.toStrictEqual({ error: {
      code: 'INVALID_REQUEST',

      fields: {
        from: 'Use a valid calendar date in YYYY-MM-DD format.',
        to: 'Use a valid calendar date in YYYY-MM-DD format.'
      },

      message: 'The request is invalid.'
    } })

    const reversed = await request('/api/catalog/releases?from=2026-10-02&to=2026-10-01')

    expect(reversed.status).toBe(400)

    await expect(reversed.json()).resolves.toStrictEqual({ error: {
      code: 'INVALID_REQUEST',

      fields: {
        to: 'Use a date on or after from.'
      },

      message: 'The request is invalid.'
    } })

    const tooWide = await request('/api/catalog/releases?from=2024-01-01&to=2025-01-01')

    expect(tooWide.status).toBe(400)

    await expect(tooWide.json()).resolves.toStrictEqual({ error: {
      code: 'INVALID_REQUEST',

      fields: {
        to: 'Use a range of 366 days or fewer.'
      },

      message: 'The request is invalid.'
    } })

    const invalidLocale = await request('/api/catalog/releases?from=2026-10-01&to=2026-10-02&titleLocale=not_a_locale')

    expect(invalidLocale.status).toBe(400)

    await expect(invalidLocale.json()).resolves.toStrictEqual({ error: {
      code: 'INVALID_REQUEST',

      fields: {
        titleLocale: 'Use a valid BCP 47 locale.'
      },

      message: 'The request is invalid.'
    } })

    for (const response of [anonymous, missing, reversed, tooWide, invalidLocale]) {
      expectNoStore(response)
    }
  })

  it('returns a safe 503 and keeps the raw database failure in telemetry', async () => {
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {
      // Expected failure is inspected below.
    })

    await withClient(async (client) => {
      await client.query('ALTER TABLE catalog_releases RENAME TO catalog_releases_unavailable')

      try {
        const response = await request()
        const body = await response.json<CatalogErrorEnvelope>()

        expect(response.status).toBe(503)

        expect(body).toStrictEqual({ error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'The catalog is temporarily unavailable.'
        } })

        const serialized = JSON.stringify(logs.mock.calls)

        expect(serialized).toContain('catalog_releases')
        expect(serialized).toContain('does not exist')

        expect(logs).toHaveBeenCalledWith(
          expect.stringContaining(`"requestId":"${TEST_REQUEST_ID}"`)
        )

        expect(response.headers.get('x-request-id')).toBe(TEST_REQUEST_ID)
        expectNoStore(response)
      } finally {
        await client.query('ALTER TABLE catalog_releases_unavailable RENAME TO catalog_releases')
      }
    })
  })
})
