import { env, exports } from 'cloudflare:workers'
import { Client } from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionToken, hashSessionToken } from '../../auth/session.ts'
import { assertDisposableTestDatabase } from '../../testing/test-database.ts'

const token = createSessionToken()
const userId = '82000000-0000-4000-8000-000000000001'
const otherUserId = '82000000-0000-4000-8000-000000000002'
const cookie = `__Host-tv_session=${token}`

async function withClient<Result>(operation: (client: Client) => Promise<Result>): Promise<Result> {
  const client = new Client({ connectionString: env.DATABASE.connectionString })

  try {
    await client.connect()
    await assertDisposableTestDatabase(client)

    return await operation(client)
  } finally {
    await client.end()
  }
}

async function target() {
  return withClient(async client => {
    const rows = await client.query<{ id: string; catalog_item_id: string }>('SELECT e.id, e.catalog_item_id FROM catalog_episodes e JOIN catalog_item_titles t ON t.catalog_item_id = e.catalog_item_id WHERE t.title = \'Spartacus\' AND t.is_original AND e.season_number = 1 ORDER BY e.episode_number LIMIT 1')
    const [episode] = rows.rows

    if (episode === undefined) {
      throw new Error('Missing episode fixture')
    }

    return {
      episodePath: `/api/catalog/episodes/${episode.id}`,
      seasonPath: `/api/catalog/items/${episode.catalog_item_id}/seasons/1/episodes`,
      episodeId: episode.id,
      itemId: episode.catalog_item_id
    }
  })
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  session?: string | null;
}

async function request(path: string, { method = 'GET', body, session = cookie }: RequestOptions = {}): Promise<Response> {
  const headers = new Headers()

  if (session !== null) {
    headers.set('Cookie', session)
  }

  if (body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  const content = body === undefined ? null : JSON.stringify(body)
  const url = `https://tv-api.test${path}`

  const input = new Request(url, {
    method,
    body: content,
    headers
  })

  return exports.default.fetch(input)
}

function expectSuccess(response: Response): void {
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
}

describe('episode rating Worker contract', () => {
  beforeEach(async () => {
    const hash = await hashSessionToken(token)

    await withClient(async client => {
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId, otherUserId]])
      await client.query('INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)', [userId, 'episode-ratings@example.com', otherUserId, 'other-episode-ratings@example.com'])
      await client.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'30 days\')', [userId, hash])
    })
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('serves batch and point reads, updates and removals through the real Worker', async () => {
    const { episodePath, seasonPath, episodeId } = await target()
    const initial = await request(`${seasonPath}/ratings`)

    expectSuccess(initial)

    const expectedPersonalItems: unknown = expect.arrayContaining([{
      episodeId,
      score: null
    }])

    await expect(initial.json()).resolves.toMatchObject({ items: expectedPersonalItems })

    /* oxlint-disable eslint/no-await-in-loop -- Sequential writes check create, update, and repeat behavior. */
    for (const score of [1, 10, 10]) {
      const saved = await request(`${episodePath}/rating`, {
        method: 'PUT',
        body: { score }
      })

      expectSuccess(saved)
      await expect(saved.json()).resolves.toStrictEqual({ score })
    }

    /* oxlint-enable eslint/no-await-in-loop */

    const personal = await request(`${episodePath}/rating`)
    const summary = await request(`${episodePath}/rating-summary`, { session: null })
    const batch = await request(`${seasonPath}/rating-summaries`, { session: null })

    expectSuccess(personal)
    expectSuccess(summary)
    expectSuccess(batch)
    await expect(personal.json()).resolves.toStrictEqual({ score: 10 })

    await expect(summary.json()).resolves.toStrictEqual({
      averageScore: 10,
      ratingCount: 1
    })

    const expectedSummaries: unknown = expect.arrayContaining([{
      episodeId,
      averageScore: 10,
      ratingCount: 1
    }])

    await expect(batch.json()).resolves.toMatchObject({ items: expectedSummaries })

    const removed = await request(`${episodePath}/rating`, { method: 'DELETE' })
    const empty = await request(`${episodePath}/rating-summary`)

    expectSuccess(removed)
    expectSuccess(empty)
    await expect(removed.json()).resolves.toStrictEqual({ score: null })

    await expect(empty.json()).resolves.toStrictEqual({
      averageScore: null,
      ratingCount: 0
    })
  })

  it.each(['GET', 'PUT', 'DELETE'])('requires a valid account before validating %s targets', async method => {
    const anonymous = await request('/api/catalog/episodes/invalid/rating', {
      method,
      session: null
    })

    expect(anonymous.status).toBe(401)

    await withClient(async client => {
      await client.query('UPDATE sessions SET expires_at = now() - interval \'1 day\' WHERE user_id = $1', [userId])
    })

    const expired = await request('/api/catalog/episodes/invalid/rating', { method })

    expect(expired.status).toBe(401)
  })

  it.each([0, 11, 1.5, '7', null, true])('rejects score %s without changing the saved vote', async score => {
    const { episodePath } = await target()

    await request(`${episodePath}/rating`, {
      method: 'PUT',
      body: { score: 7 }
    })

    const invalid = await request(`${episodePath}/rating`, {
      method: 'PUT',
      body: { score }
    })

    const preserved = await request(`${episodePath}/rating`)

    expect(invalid.status).toBe(400)
    await expect(preserved.json()).resolves.toStrictEqual({ score: 7 })
  })

  it('rejects supplied owners, malformed targets and unknown episodes', async () => {
    const { episodePath, itemId, episodeId, seasonPath } = await target()

    await withClient(async client => {
      await client.query('INSERT INTO catalog_item_ratings (user_id, catalog_item_id, catalog_episode_id, score) VALUES ($1, $2, $3, 4)', [otherUserId, itemId, episodeId])
    })

    const spoofed = await request(`${episodePath}/rating`, {
      method: 'PUT',

      body: {
        score: 9,
        userId: otherUserId
      }
    })

    const anonymousBatch = await request(`${seasonPath}/ratings`, { session: null })
    const invalid = await request('/api/catalog/episodes/invalid/rating-summary')

    const unknown = await request('/api/catalog/episodes/82000000-0000-4000-8000-999999999999/rating', {
      method: 'PUT',
      body: { score: 7 }
    })

    const invalidSeason = await request(`/api/catalog/items/${itemId}/seasons/0/episodes/rating-summaries`)

    expect(spoofed.status).toBe(400)
    expect(anonymousBatch.status).toBe(401)
    expect(invalid.status).toBe(400)
    expect(unknown.status).toBe(404)
    expect(invalidSeason.status).toBe(400)
    await request(`${episodePath}/rating`, { method: 'DELETE' })

    const otherVote = await request(`${episodePath}/rating-summary`)

    await expect(otherVote.json()).resolves.toStrictEqual({
      averageScore: 4,
      ratingCount: 1
    })
  })

  it.each(['GET', 'DELETE'])('rejects malformed and unknown personal %s targets', async method => {
    const invalid = await request('/api/catalog/episodes/invalid/rating', { method })
    const unknown = await request('/api/catalog/episodes/82000000-0000-4000-8000-999999999999/rating', { method })

    expect(invalid.status).toBe(400)
    expect(unknown.status).toBe(404)
  })

  it.each([
    {
      season: '0',
      expectedStatus: 400
    },
    {
      season: '999999',
      expectedStatus: 404
    }
  ])('rejects private batch season $season with $expectedStatus', async ({ season, expectedStatus }) => {
    const { itemId } = await target()
    const response = await request(`/api/catalog/items/${itemId}/seasons/${season}/episodes/ratings`)

    expect(response.status).toBe(expectedStatus)
  })

  it('rejects malformed and unknown items in private batch reads', async () => {
    const invalid = await request('/api/catalog/items/invalid/seasons/1/episodes/ratings')
    const unknown = await request('/api/catalog/items/82000000-0000-4000-8000-999999999999/seasons/1/episodes/ratings')

    expect(invalid.status).toBe(400)
    expect(unknown.status).toBe(404)
  })

  it('keeps database errors in diagnostics and preserves a failed write', async () => {
    const { episodePath, seasonPath } = await target()
    const log = vi.spyOn(console, 'error').mockReturnValue()

    await request(`${episodePath}/rating`, {
      method: 'PUT',
      body: { score: 6 }
    })

    await withClient(async client => {
      await client.query('ALTER TABLE catalog_item_ratings RENAME TO unavailable_episode_ratings')

      try {
        const failed = await request(`${episodePath}/rating`, {
          method: 'PUT',
          body: { score: 9 }
        })

        const summary = await request(`${seasonPath}/rating-summaries`)

        await Promise.all([failed, summary].map(async response => {
          expect(response.status).toBe(503)

          await expect(response.json()).resolves.toStrictEqual({ error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'The catalog is temporarily unavailable.'
          } })
        }))

        const diagnostics = JSON.stringify(log.mock.calls)

        expect(diagnostics).toContain('catalog_item_ratings')
        expect(diagnostics).toContain('requestId')
      } finally {
        await client.query('ALTER TABLE unavailable_episode_ratings RENAME TO catalog_item_ratings')
      }
    })

    const preserved = await request(`${episodePath}/rating`)

    await expect(preserved.json()).resolves.toStrictEqual({ score: 6 })
  })
})
