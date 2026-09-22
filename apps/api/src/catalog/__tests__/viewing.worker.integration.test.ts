import { env, exports } from 'cloudflare:workers'
import { Client } from 'pg'
import type { CatalogViewingHistoryResponse, CatalogViewingSummaryResponse } from '@tv/shared/catalog'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashSessionToken } from '../../auth/session.ts'
import { assertDisposableTestDatabase } from '../../testing/test-database.ts'

const userId = '52000000-0000-7000-8000-000000000010'
const token = 'h'.repeat(43)
const cookie = `__Host-tv_session=${token}`
const historyPath = '/api/catalog/viewing-history'
const summaryPath = '/api/catalog/viewing-summary'

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

async function request(path: string, authenticated = true): Promise<Response> {
  const headers = authenticated ? { Cookie: cookie } : {}
  const input = new Request(`https://tv-api.test${path}`, { headers })

  return exports.default.fetch(input)
}

describe('viewing Worker routes', () => {
  beforeEach(async () => {
    const hash = await hashSessionToken(token)

    await withClient(async (client) => {
      await client.query('DELETE FROM users WHERE id = $1', [userId])
      await client.query('INSERT INTO users (id, email) VALUES ($1, $2)', [userId, 'viewing-worker@example.com'])
      await client.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'1 day\')', [userId, hash])
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await withClient(async client => client.query('DELETE FROM users WHERE id = $1', [userId]))
  })

  it.each([historyPath, summaryPath])('requires a session and returns no-store for %s', async (path) => {
    const response = await request(path, false)

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'AUTHENTICATION_REQUIRED' } })
  })

  it('returns empty data, mixed marks, counts, translations and older pages', async () => {
    const empty = await request(historyPath)

    await expect(empty.json()).resolves.toStrictEqual({
      items: [],
      nextCursor: null
    })

    await withClient(async (client) => {
      await client.query(`INSERT INTO catalog_movie_watches (user_id, catalog_item_id)
        SELECT $1, id FROM catalog_items WHERE type = 'movie' ORDER BY id LIMIT 2`, [userId])

      await client.query(`INSERT INTO catalog_episode_watches (user_id, catalog_episode_id)
        SELECT $1, id FROM catalog_episodes ORDER BY id LIMIT 23`, [userId])
    })

    const response = await request(`${historyPath}?titleLocale=ru`)
    const first = await response.json<CatalogViewingHistoryResponse>()
    const summaryResponse = await request(summaryPath)
    const summary = await summaryResponse.json<CatalogViewingSummaryResponse>()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(first.items).toHaveLength(20)
    expect(first.items.every(item => item.titleLocale === 'ru')).toBe(true)
    expect(first.nextCursor).not.toBeNull()

    expect(summary).toMatchObject({
      watchedMovieCount: 2,
      watchedEpisodeCount: 23
    })

    expect(summary.series.reduce((total, series) => total + series.watchedEpisodeCount, 0)).toBe(23)

    const next = await request(`${historyPath}?cursor=${first.nextCursor}`)
    const older = await next.json<CatalogViewingHistoryResponse>()

    expect(older.items).toHaveLength(5)
    expect(older.nextCursor).toBeNull()
    expect(older.items.filter(item => item.kind === 'movie')).toHaveLength(2)
  })

  it('validates cursors after checking authentication', async () => {
    const invalid = await request(`${historyPath}?cursor=invalid`)
    const anonymous = await request(`${historyPath}?cursor=invalid`, false)

    expect(invalid.status).toBe(400)
    expect(anonymous.status).toBe(401)
    expect(invalid.headers.get('cache-control')).toBe('no-store')
    expect(anonymous.headers.get('cache-control')).toBe('no-store')

    await expect(invalid.json()).resolves.toMatchObject({ error: {
      code: 'INVALID_REQUEST',
      fields: { cursor: 'Use a valid viewing history cursor.' }
    } })
  })

  it.each([historyPath, summaryPath])('validates locale only after authentication for %s', async (path) => {
    const invalidPath = `${path}?titleLocale=not_a_locale`
    const invalid = await request(invalidPath)
    const anonymous = await request(invalidPath, false)

    expect(invalid.status).toBe(400)
    expect(anonymous.status).toBe(401)
    expect(invalid.headers.get('cache-control')).toBe('no-store')
    expect(anonymous.headers.get('cache-control')).toBe('no-store')
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: 'INVALID_REQUEST' } })
    await expect(anonymous.json()).resolves.toMatchObject({ error: { code: 'AUTHENTICATION_REQUIRED' } })
  })

  it.each([historyPath, summaryPath])('preserves raw database errors in logs and returns a safe response for %s', async (path) => {
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {
      // The safe-error test checks captured diagnostics.
    })

    await withClient(async (client) => {
      await client.query('ALTER TABLE catalog_movie_watches RENAME TO catalog_movie_watches_unavailable')

      try {
        const response = await request(path)

        expect(response.status).toBe(503)
        expect(response.headers.get('cache-control')).toBe('no-store')

        await expect(response.json()).resolves.toStrictEqual({ error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'The catalog is temporarily unavailable.'
        } })

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
