import { env, exports } from 'cloudflare:workers'
import { Client } from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionToken, hashSessionToken } from '../../auth/session.ts'
import { assertDisposableTestDatabase } from '../../testing/test-database.ts'

const token = createSessionToken()
const userId = '81000000-0000-4000-8000-000000000001'
const otherUserId = '81000000-0000-4000-8000-000000000002'
const thirdUserId = '81000000-0000-4000-8000-000000000003'
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

    if (id === undefined) {
      const message = `Missing title: ${title}`

      throw new Error(message)
    }

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

  const ratingUrl = `https://tv-api.test/api/catalog/items/${id}/seasons/1/rating`
  const apiRequest = new Request(ratingUrl, init)

  return exports.default.fetch(apiRequest)
}

async function expectScore(response: Response, score: number | null): Promise<void> {
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')

  const body: unknown = await response.json()

  expect(body).toStrictEqual({ score })
}

async function expectSummary(response: Response, averageScore: number | null, ratingCount: number): Promise<void> {
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')

  const body: unknown = await response.json()

  expect(body).toStrictEqual({
    averageScore,
    ratingCount
  })
}

describe('season rating Worker contract', () => {
  beforeEach(async () => {
    const hash = await hashSessionToken(token)

    await withClient(async client => {
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId, otherUserId, thirdUserId]])
      await client.query('INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4), ($5, $6)', [userId, 'season-ratings@example.com', otherUserId, 'other-season-ratings@example.com', thirdUserId, 'third-season-ratings@example.com'])
      await client.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'30 days\')', [userId, hash])
    })
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('saves, changes, removes and reloads season ratings independently of follows and watches', async () => {
    const id = await itemId('Spartacus')

    await withClient(async client => {
      await client.query('INSERT INTO catalog_item_follows (user_id, catalog_item_id) VALUES ($1, $2)', [userId, id])
    })

    const unrated = await request(id)

    await expectScore(unrated, null)

    const created = await request(id, 'PUT', { input: { score: 1 } })

    await expectScore(created, 1)

    const corrected = await request(id, 'PUT', { input: { score: 10 } })

    await expectScore(corrected, 10)

    const unchanged = await request(id, 'PUT', { input: { score: 10 } })

    await expectScore(unchanged, 10)

    const episodeId = await withClient(async client => {
      const rows = await client.query<{ id: string }>('SELECT id FROM catalog_episodes WHERE catalog_item_id = $1 AND season_number = 1 LIMIT 1', [id])

      return rows.rows[0]?.id
    })

    expect(episodeId).toBeDefined()

    /* oxlint-disable eslint/no-await-in-loop -- Add watched before removing it and verify the rating after each operation. */
    for (const method of ['PUT', 'DELETE']) {
      const watchedUrl = `https://tv-api.test/api/catalog/episodes/${episodeId}/watched`

      const watchRequest = new Request(watchedUrl, {
        method,
        headers: { Cookie: cookie }
      })

      const watched = await exports.default.fetch(watchRequest)

      expect(watched.status).toBe(200)

      const retained = await request(id)

      await expectScore(retained, 10)
    }

    /* oxlint-enable eslint/no-await-in-loop */

    const newToken = createSessionToken()
    const newHash = await hashSessionToken(newToken)

    await withClient(async client => {
      await client.query('DELETE FROM sessions WHERE user_id = $1', [userId])
      await client.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'30 days\')', [userId, newHash])
    })

    const newCookie = `__Host-tv_session=${newToken}`
    const reloaded = await request(id, 'GET', { session: newCookie })

    await expectScore(reloaded, 10)

    const removed = await request(id, 'DELETE', { session: newCookie })

    await expectScore(removed, null)

    const alreadyRemoved = await request(id, 'DELETE', { session: newCookie })

    await expectScore(alreadyRemoved, null)

    await withClient(async client => {
      const follows = await client.query('SELECT * FROM catalog_item_follows WHERE user_id = $1 AND catalog_item_id = $2', [userId, id])
      const movies = await client.query('SELECT * FROM catalog_movie_watches WHERE user_id = $1', [userId])
      const episodes = await client.query('SELECT * FROM catalog_episode_watches WHERE user_id = $1', [userId])

      expect(follows.rows).toHaveLength(1)
      expect(movies.rows).toHaveLength(0)
      expect(episodes.rows).toHaveLength(0)
    })
  })

  // oxlint-disable-next-line vitest/expect-expect -- expectSummary asserts the complete HTTP and JSON contract.
  it('publicly reads current season averages after real writes', async () => {
    const id = await itemId('Spartacus')
    const summaryUrl = `https://tv-api.test/api/catalog/items/${id}/seasons/1/rating-summary`
    const anonymous = new Request(summaryUrl)
    const invalidSession = new Request(summaryUrl, { headers: { Cookie: '__Host-tv_session=invalid' } })
    const empty = await exports.default.fetch(anonymous)

    await expectSummary(empty, null, 0)
    await request(id, 'PUT', { input: { score: 6 } })

    const oneVote = await exports.default.fetch(invalidSession)

    await expectSummary(oneVote, 6, 1)

    await withClient(async client => {
      await client.query('INSERT INTO catalog_item_ratings (user_id, catalog_item_id, season_number, score) VALUES ($1, $2, 1, 6), ($3, $2, 1, 9)', [otherUserId, id, thirdUserId])
    })

    const threeVotesRequest = new Request(summaryUrl)
    const threeVotes = await exports.default.fetch(threeVotesRequest)

    await expectSummary(threeVotes, 7, 3)

  })

  it.each([['invalid', 400], ['79000000-0000-4000-8000-999999999999', 404]])('rejects the public summary target %s', async (id, status) => {
    const summaryUrl = `https://tv-api.test/api/catalog/items/${id}/seasons/1/rating-summary`
    const summaryRequest = new Request(summaryUrl)
    const response = await exports.default.fetch(summaryRequest)

    expect(response.status).toBe(status)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('returns a safe summary failure and keeps its database diagnostic', async () => {
    const id = await itemId('Spartacus')
    const log = vi.spyOn(console, 'error').mockReturnValue()

    await withClient(async client => {
      await client.query('ALTER TABLE catalog_item_ratings RENAME TO unavailable_test_season_ratings')

      try {
        const summaryUrl = `https://tv-api.test/api/catalog/items/${id}/seasons/1/rating-summary`
        const summaryRequest = new Request(summaryUrl)
        const response = await exports.default.fetch(summaryRequest)
        const body: unknown = await response.json()
        const loggedCalls = JSON.stringify(log.mock.calls)

        expect(response.status).toBe(503)
        expect(response.headers.get('cache-control')).toBe('no-store')

        expect(body).toStrictEqual({ error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'The catalog is temporarily unavailable.'
        } })

        expect(loggedCalls).toContain('catalog_item_ratings')
        expect(loggedCalls).toContain('requestId')
      } finally {
        await client.query('ALTER TABLE unavailable_test_season_ratings RENAME TO catalog_item_ratings')
      }
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
    const id = await itemId('Spartacus')

    await request(id, 'PUT', { input: { score: 7 } })

    const invalid = await request(id, 'PUT', { input: { score } })

    expect(invalid.status).toBe(400)

    const preserved = await request(id)

    await expectScore(preserved, 7)
  })

  it('isolates accounts and rejects a supplied owner', async () => {
    const id = await itemId('Spartacus')

    await withClient(async client => {
      await client.query('INSERT INTO catalog_item_ratings (user_id, catalog_item_id, season_number, score) VALUES ($1, $2, 1, 4)', [otherUserId, id])
    })

    const ownRating = await request(id)

    await expectScore(ownRating, null)

    const spoofed = await request(id, 'PUT', { input: {
      score: 9,
      userId: otherUserId
    } })

    expect(spoofed.status).toBe(400)

    const saved = await request(id, 'PUT', { input: { score: 8 } })

    await expectScore(saved, 8)

    const removed = await request(id, 'DELETE')

    await expectScore(removed, null)

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

  it('keeps a failed write out of persistence and logs the technical cause without exposing it', async () => {
    const id = await itemId('Spartacus')

    const log = vi.spyOn(console, 'error').mockImplementation(() => {
      // Capture the expected database failure.
    })

    await request(id, 'PUT', { input: { score: 7 } })

    await withClient(async client => {
      await client.query(`CREATE FUNCTION reject_test_season_rating() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'private rating database details'; END $$`)

      await client.query('CREATE TRIGGER reject_test_season_rating BEFORE UPDATE ON catalog_item_ratings FOR EACH ROW EXECUTE FUNCTION reject_test_season_rating()')

      try {
        const failed = await request(id, 'PUT', { input: { score: 9 } })
        const body = await failed.text()

        expect(failed.status).toBe(503)
        expect(body).not.toContain('private rating database details')

        const loggedCalls = JSON.stringify(log.mock.calls)

        expect(loggedCalls).toContain('private rating database details')

        const preserved = await request(id)

        await expectScore(preserved, 7)
      } finally {
        await client.query('DROP TRIGGER reject_test_season_rating ON catalog_item_ratings')
        await client.query('DROP FUNCTION reject_test_season_rating()')
      }
    })
  })

  it.each([['0', 400], ['-1', 400], ['1.5', 400], ['2147483648', 400], ['abc', 400], ['999', 404]] as const)('rejects invalid or missing season %s for every operation', async (season, status) => {
    const id = await itemId('Spartacus')
    const ratingBody = JSON.stringify({ score: 7 })

    const operations = [
      ['GET', 'rating', null],
      ['PUT', 'rating', ratingBody],
      ['DELETE', 'rating', null],
      ['GET', 'rating-summary', null]
    ] as const

    const requests = operations.map(async ([method, suffix, body]) => {
      const init: RequestInit = {
        method,
        body,

        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json'
        }
      }

      const requestUrl = `https://tv-api.test/api/catalog/items/${id}/seasons/${season}/${suffix}`
      const input = new Request(requestUrl, init)

      return exports.default.fetch(input)
    })

    const responses = await Promise.all(requests)
    const statuses = responses.map(response => response.status)

    expect(statuses).toStrictEqual([status, status, status, status])
  })

  it('rejects seasons on a movie for reads and writes', async () => {
    const id = await itemId('Dead Man')
    const read = await request(id)
    const write = await request(id, 'PUT', { input: { score: 8 } })
    const remove = await request(id, 'DELETE')
    const summaryUrl = `https://tv-api.test/api/catalog/items/${id}/seasons/1/rating-summary`
    const summaryRequest = new Request(summaryUrl)
    const summary = await exports.default.fetch(summaryRequest)

    expect([read.status, write.status, remove.status, summary.status]).toStrictEqual([400, 400, 400, 400])
  })

})
