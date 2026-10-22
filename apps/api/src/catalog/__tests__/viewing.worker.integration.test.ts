import { env, exports } from 'cloudflare:workers'
import { Client } from 'pg'
import type { CatalogViewingHistoryResponse, CatalogViewingSummaryResponse } from '@tv/shared/catalog'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashSessionToken } from '../../auth/session.ts'
import { assertDisposableTestDatabase } from '../../testing/test-database.ts'
import { insertSeriesEpisodeWatches } from '../../testing/series-watch-fixtures.ts'

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

  it('returns empty data, mixed viewings, counts, translations and scoped pages', async () => {
    const empty = await request(historyPath)

    await expect(empty.json()).resolves.toStrictEqual({
      items: [],
      nextCursor: null
    })

    await withClient(async (client) => {
      await client.query(`INSERT INTO catalog_viewings (user_id, catalog_item_id, completed_on)
        SELECT $1, item.id, '2026-09-22'::date FROM (SELECT id FROM catalog_items WHERE type = 'movie' ORDER BY id LIMIT 1) item CROSS JOIN generate_series(1, 24)`, [userId])

      const episodes = await client.query<{ id: string }>('SELECT id FROM catalog_episodes ORDER BY id LIMIT 23')
      const episodeIds = episodes.rows.map(episode => episode.id)

      await insertSeriesEpisodeWatches(client, userId, { episodeIds })
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
      watchedMovieCount: 24,
      watchedEpisodeCount: 23
    })

    expect(summary.activeSeries.length).toBeLessThanOrEqual(5)
    expect(summary.watchingSeriesCount).toBeGreaterThan(0)
    expect(summary.completedSeriesCount).toBe(0)

    const next = await request(`${historyPath}?titleLocale=ru&cursor=${first.nextCursor}`)
    const older = await next.json<CatalogViewingHistoryResponse>()

    expect(first.items.length + older.items.length).toBe(24 + summary.watchingSeriesCount)
    expect(older.nextCursor).toBeNull()
    expect([...first.items, ...older.items].filter(item => item.type === 'movie')).toHaveLength(24)

    const watching = await request(`${historyPath}?status=watching`)
    const filtered = await watching.json<CatalogViewingHistoryResponse>()

    expect(filtered.items.every(item => item.status === 'watching')).toBe(true)
    expect(filtered.items).toHaveLength(summary.watchingSeriesCount)
  })

  it.each(['cursor=invalid', 'status=unknown'])('validates %s after checking authentication', async parameter => {
    const invalid = await request(`${historyPath}?${parameter}`)
    const anonymous = await request(`${historyPath}?${parameter}`, false)

    expect(invalid.status).toBe(400)
    expect(anonymous.status).toBe(401)
    expect(invalid.headers.get('cache-control')).toBe('no-store')
    expect(anonymous.headers.get('cache-control')).toBe('no-store')

    await expect(invalid.json()).resolves.toMatchObject({ error: {
      code: 'INVALID_REQUEST'
    } })
  })

  it('rejects the old dashboard cursor version so the client can reload the first page', async () => {
    const legacyPayload = JSON.stringify({
      kind: 'episode',
      entryId: '30000000-0000-7000-8000-000000000001',
      markedAt: '2026-09-22T13:00:00.123456Z',
      version: 5
    })

    const legacyBase64 = btoa(legacyPayload)
    const legacyCursor = legacyBase64.replace(/=+$/u, '')
    const legacyPath = `${historyPath}?cursor=${legacyCursor}`
    const response = await request(legacyPath)

    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')

    await expect(response.json()).resolves.toMatchObject({ error: {
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
      await client.query('ALTER TABLE catalog_viewings RENAME TO catalog_viewings_unavailable')

      try {
        const response = await request(path)

        expect(response.status).toBe(503)
        expect(response.headers.get('cache-control')).toBe('no-store')

        await expect(response.json()).resolves.toStrictEqual({ error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'The catalog is temporarily unavailable.'
        } })

        const serialized = JSON.stringify(logs.mock.calls)

        expect(serialized).toContain('catalog_viewings')
        expect(serialized).toContain('does not exist')
        expect(serialized).toContain('requestId')
      } finally {
        await client.query('ALTER TABLE catalog_viewings_unavailable RENAME TO catalog_viewings')
      }
    })
  })
})
