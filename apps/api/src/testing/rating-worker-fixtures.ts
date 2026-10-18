/* oxlint-disable import/no-relative-parent-imports -- Shared integration fixtures use the real catalog and authentication boundaries. */
import { env, exports } from 'cloudflare:workers'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { createSessionToken, hashSessionToken } from '../auth/session.ts'
import { assertDisposableTestDatabase } from './test-database.ts'

async function withRatingClient<Result>(run: (client: Client) => Promise<Result>): Promise<Result> {
  const client = new Client({ connectionString: env.DATABASE.connectionString })

  try {
    await client.connect()
    await assertDisposableTestDatabase(client)

    return await run(client)
  } finally {
    await client.end()
  }
}

function ratingWorkerFixture() {
  const userId = randomUUID()
  const otherUserId = randomUUID()
  const movieId = randomUUID()
  const seriesId = randomUUID()
  const episodeId = randomUUID()
  const futureEpisodeId = randomUUID()
  const token = createSessionToken()
  const cookie = `__Host-tv_session=${token}`
  const otherToken = createSessionToken()
  const otherCookie = `__Host-tv_session=${otherToken}`

  async function cleanup(): Promise<void> {
    await withRatingClient(async client => {
      await client.query('DELETE FROM catalog_items WHERE id = ANY($1::uuid[])', [[movieId, seriesId]])
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId, otherUserId]])
    })
  }

  async function setup(): Promise<void> {
    await cleanup()

    const hash = await hashSessionToken(token)
    const otherHash = await hashSessionToken(otherToken)

    await withRatingClient(async client => {
      await client.query('INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)', [userId, `${userId}@example.com`, otherUserId, `${otherUserId}@example.com`])
      await client.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'30 days\'), ($3, $4, now() + interval \'30 days\')', [userId, hash, otherUserId, otherHash])
      await client.query('INSERT INTO catalog_items (id, type) VALUES ($1, \'movie\'), ($2, \'series\')', [movieId, seriesId])
      await client.query('INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original) VALUES ($1, \'en\', \'HTTP rating movie\', true), ($2, \'en\', \'HTTP rating series\', true)', [movieId, seriesId])
      await client.query('INSERT INTO catalog_episodes (id, catalog_item_id, season_number, episode_number, air_date) VALUES ($1, $2, 1, 1, \'2000-01-01\'), ($3, $2, 2, 1, \'9999-01-01\')', [episodeId, seriesId, futureEpisodeId])
    })
  }

  // oxlint-disable-next-line eslint/max-params -- Test requests separate path, method, payload and session.
  async function request(requestPath: string, method = 'GET', input?: unknown, session: string | null = cookie): Promise<Response> {
    const headers = new Headers()

    const init: RequestInit = {
      method,
      headers
    }

    if (session !== null) { headers.set('Cookie', session) }

    if (input !== undefined) {
      headers.set('Content-Type', 'application/json')

      init.body = JSON.stringify(input)
    }

    const requestValue = new Request(`https://tv-api.test/api/catalog${requestPath}`, init)

    return exports.default.fetch(requestValue)
  }

  async function context(catalogItemId: string, ownerId = userId) {
    return withRatingClient(async client => {
      const rows = await client.query<{ currentViewingId: string | null; contextVersion: number }>(`SELECT current_viewing_id AS "currentViewingId", context_version AS "contextVersion" FROM catalog_viewing_contexts WHERE user_id = $1 AND catalog_item_id = $2`, [ownerId, catalogItemId])
      const [current] = rows.rows
      const requestId = randomUUID()

      return {
        requestId,
        currentViewingId: current?.currentViewingId ?? null,
        contextVersion: current?.contextVersion ?? 0,
        timeZone: 'Europe/Tallinn'
      }
    })
  }

  function path(kind: 'movie' | 'series' | 'season' | 'episode'): string {
    if (kind === 'episode') { return `/episodes/${episodeId}/rating` }

    if (kind === 'season') { return `/items/${seriesId}/seasons/1/rating` }

    const catalogItemId = kind === 'movie' ? movieId : seriesId

    return `/items/${catalogItemId}/rating`
  }

  return {
    userId,
    otherUserId,
    movieId,
    seriesId,
    episodeId,
    futureEpisodeId,
    cookie,
    otherCookie,
    setup,
    cleanup,
    request,
    context,
    path
  }
}


function requireHttpValue<Value>(value: Value | null | undefined): Value {
  if (value === null || value === undefined) { throw new Error('Expected a confirmed HTTP value') }

  return value
}

export { ratingWorkerFixture, withRatingClient, requireHttpValue }
