import { env, exports } from 'cloudflare:workers'
import { Client } from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashSessionToken } from '../../auth/session.ts'
import { assertDisposableTestDatabase } from '../../testing/test-database.ts'

const token = 'r'.repeat(43)
const userId = '79000000-0000-4000-8000-000000000001'
const otherUserId = '79000000-0000-4000-8000-000000000002'
const cookie = `__Host-tv_session=${token}`

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

async function itemId(title: string): Promise<string> {
  return withClient(async client => {
    const rows = await client.query<{ id: string }>('SELECT catalog_item_id AS id FROM catalog_item_titles WHERE title = $1 AND is_original', [title])
    const id = rows.rows[0]?.id

    if (id === undefined) { throw new Error(`Missing title: ${title}`) }

    return id
  })
}

interface RatingRequestOptions {
  input?: unknown;
  session?: string | null;
}

async function request(id: string, method = 'GET', { input, session = cookie }: RatingRequestOptions = {}): Promise<Response> {
  const headers = new Headers()

  const init: RequestInit = {
    headers,
    method
  }

  if (session !== null) { headers.set('Cookie', session) }

  if (input !== undefined && method !== 'GET') {
    headers.set('Content-Type', 'application/json')

    init.body = JSON.stringify(input)
  }

  const apiRequest = new Request(`https://tv-api.test/api/catalog/items/${id}/rating`, init)

  return exports.default.fetch(apiRequest)
}

async function expectScore(response: Response, score: number | null): Promise<void> {
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  await expect(response.json()).resolves.toStrictEqual({ score })
}

describe('catalog rating Worker contract', () => {
  beforeEach(async () => {
    const hash = await hashSessionToken(token)

    await withClient(async client => {
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId, otherUserId]])
      await client.query('INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)', [userId, 'ratings@example.com', otherUserId, 'other-ratings@example.com'])
      await client.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'30 days\')', [userId, hash])
    })
  })

  afterEach(() => { vi.restoreAllMocks() })

  it.each(['Dead Man', 'Spartacus'])('saves, changes, removes and reloads ratings for %s without changing follows or watches', async title => {
    const id = await itemId(title)

    await withClient(async client => {
      await client.query('INSERT INTO catalog_item_follows (user_id, catalog_item_id) VALUES ($1, $2)', [userId, id])
    })

    await expectScore(await request(id), null)
    await expectScore(await request(id, 'PUT', { input: { score: 1 } }), 1)
    await expectScore(await request(id, 'PUT', { input: { score: 10 } }), 10)
    await expectScore(await request(id, 'PUT', { input: { score: 10 } }), 10)

    const newToken = 'n'.repeat(43)
    const newHash = await hashSessionToken(newToken)

    await withClient(async client => {
      await client.query('DELETE FROM sessions WHERE user_id = $1', [userId])
      await client.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'30 days\')', [userId, newHash])
    })

    const newCookie = `__Host-tv_session=${newToken}`

    await expectScore(await request(id, 'GET', { session: newCookie }), 10)
    await expectScore(await request(id, 'DELETE', { session: newCookie }), null)
    await expectScore(await request(id, 'DELETE', { session: newCookie }), null)

    await withClient(async client => {
      const follows = await client.query('SELECT * FROM catalog_item_follows WHERE user_id = $1 AND catalog_item_id = $2', [userId, id])
      const movies = await client.query('SELECT * FROM catalog_movie_watches WHERE user_id = $1', [userId])
      const episodes = await client.query('SELECT * FROM catalog_episode_watches WHERE user_id = $1', [userId])

      expect(follows.rows).toHaveLength(1)
      expect(movies.rows).toHaveLength(0)
      expect(episodes.rows).toHaveLength(0)
    })
  })

  it.each(['GET', 'PUT', 'DELETE'])('rejects anonymous and expired sessions before validating %s inputs', async method => {
    const anonymous = await request('invalid', method, { session: null })

    expect(anonymous.status).toBe(401)

    await withClient(async client => {
      await client.query('UPDATE sessions SET expires_at = now() - interval \'1 day\' WHERE user_id = $1', [userId])
    })

    const expired = await request('invalid', method)

    expect(expired.status).toBe(401)
  })

  it.each([0, 11, 1.5, '7', null, true])('rejects an invalid score %s without changing an existing rating', async score => {
    const id = await itemId('Dead Man')

    await request(id, 'PUT', { input: { score: 7 } })

    const invalid = await request(id, 'PUT', { input: { score } })

    expect(invalid.status).toBe(400)
    await expectScore(await request(id), 7)
  })

  it('isolates accounts and rejects a supplied owner', async () => {
    const id = await itemId('Dead Man')

    await withClient(async client => {
      await client.query('INSERT INTO catalog_item_ratings (user_id, catalog_item_id, score) VALUES ($1, $2, 4)', [otherUserId, id])
    })

    await expectScore(await request(id), null)

    const spoofed = await request(id, 'PUT', { input: {
      score: 9,
      userId: otherUserId
    } })

    expect(spoofed.status).toBe(400)
    await expectScore(await request(id, 'PUT', { input: { score: 8 } }), 8)
    await expectScore(await request(id, 'DELETE'), null)

    await withClient(async client => {
      const rows = await client.query('SELECT score FROM catalog_item_ratings WHERE user_id = $1 AND catalog_item_id = $2', [otherUserId, id])

      expect(rows.rows).toStrictEqual([{ score: 4 }])
    })
  })

  it.each([
    {
      method: 'GET',
      input: undefined
    },
    {
      method: 'PUT',
      input: { score: 7 }
    },
    {
      method: 'DELETE',
      input: undefined
    }
  ])('rejects malformed and unknown targets for $method', async ({ method, input }) => {
    const malformed = await request('invalid', method, { input })
    const missing = await request('79000000-0000-4000-8000-999999999999', method, { input })

    expect(malformed.status).toBe(400)
    expect(missing.status).toBe(404)
  })

  it('preserves a rating when its watched mark is removed', async () => {
    const id = await itemId('Dead Man')

    await request(id, 'PUT', { input: { score: 8 } })

    for (const method of ['PUT', 'DELETE']) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- The watched mark must be saved before it is removed.
      const result = await exports.default.fetch(new Request(`https://tv-api.test/api/catalog/items/${id}/watched`, {
        headers: { Cookie: cookie },
        method
      }))

      expect(result.status).toBe(200)
    }

    await expectScore(await request(id), 8)
  })

  it('keeps a failed write out of persistence and logs the technical cause without exposing it', async () => {
    const id = await itemId('Dead Man')

    const log = vi.spyOn(console, 'error').mockImplementation(() => {
      // Capture the expected database failure.
    })

    await request(id, 'PUT', { input: { score: 7 } })

    await withClient(async client => {
      await client.query(`CREATE FUNCTION reject_test_rating() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'private rating database details'; END $$`)

      await client.query('CREATE TRIGGER reject_test_rating BEFORE UPDATE ON catalog_item_ratings FOR EACH ROW EXECUTE FUNCTION reject_test_rating()')

      try {
        const failed = await request(id, 'PUT', { input: { score: 9 } })
        const body = await failed.text()

        expect(failed.status).toBe(503)
        expect(body).not.toContain('private rating database details')
        expect(JSON.stringify(log.mock.calls)).toContain('private rating database details')
        await expectScore(await request(id), 7)
      } finally {
        await client.query('DROP TRIGGER reject_test_rating ON catalog_item_ratings')
        await client.query('DROP FUNCTION reject_test_rating()')
      }
    })
  })
})
