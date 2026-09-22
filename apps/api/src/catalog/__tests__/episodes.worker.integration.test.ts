import { env, exports } from 'cloudflare:workers'
import { Client } from 'pg'

import type {
  CatalogEpisodeWatchesResponse,
  CatalogEpisodesResponse,
  CatalogErrorEnvelope,
  CatalogWatchedResponse
} from '@tv/shared/catalog'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionToken, hashSessionToken } from '../../auth/session.ts'
import { assertDisposableTestDatabase } from '../../testing/test-database.ts'

const FIRST_SESSION_TOKEN = createSessionToken()
const SECOND_SESSION_TOKEN = createSessionToken()
const FIRST_USER_ID = '71000000-0000-7000-8000-000000000001'
const SECOND_USER_ID = '71000000-0000-7000-8000-000000000002'
const FIRST_COOKIE = `__Host-tv_session=${FIRST_SESSION_TOKEN}`
const SECOND_COOKIE = `__Host-tv_session=${SECOND_SESSION_TOKEN}`

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
  cookie: string | null = FIRST_COOKIE
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

describe('catalog episodes Worker contract', () => {
  beforeEach(async () => {
    const firstTokenHash = await hashSessionToken(FIRST_SESSION_TOKEN)
    const secondTokenHash = await hashSessionToken(SECOND_SESSION_TOKEN)

    await withClient(async (client) => {
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[FIRST_USER_ID, SECOND_USER_ID]])

      await client.query(`
        INSERT INTO users (id, email)
        VALUES ($1, 'first-episode-api@example.com'), ($2, 'second-episode-api@example.com')
      `, [FIRST_USER_ID, SECOND_USER_ID])

      await client.query(`
        INSERT INTO sessions (user_id, token_hash, expires_at)
        VALUES
          ($1, $2, now() + interval '30 days'),
          ($3, $4, now() + interval '30 days')
      `, [FIRST_USER_ID, firstTokenHash, SECOND_USER_ID, secondTokenHash])
    })
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('serves five ordered Chernobyl episodes publicly without account access', async () => {
    const chernobylId = await findCatalogItemId('Chernobyl')
    const response = await request(`/api/catalog/items/${chernobylId}/episodes`, 'GET', null)
    const body = await response.json<CatalogEpisodesResponse>()

    expect(response.status).toBe(200)
    expectNoStore(response)

    expect(body.items).toStrictEqual([
      {
        id: '30000000-0000-7000-8000-000000000001',
        seasonNumber: 1,
        episodeNumber: 1,
        sourceTitle: '1:23:45',
        airDate: '2019-05-06'
      },
      {
        id: '30000000-0000-7000-8000-000000000002',
        seasonNumber: 1,
        episodeNumber: 2,
        sourceTitle: 'Please Remain Calm',
        airDate: '2019-05-13'
      },
      {
        id: '30000000-0000-7000-8000-000000000003',
        seasonNumber: 1,
        episodeNumber: 3,
        sourceTitle: 'Open Wide, O Earth',
        airDate: '2019-05-20'
      },
      {
        id: '30000000-0000-7000-8000-000000000004',
        seasonNumber: 1,
        episodeNumber: 4,
        sourceTitle: 'The Happiness of All Mankind',
        airDate: '2019-05-27'
      },
      {
        id: '30000000-0000-7000-8000-000000000005',
        seasonNumber: 1,
        episodeNumber: 5,
        sourceTitle: 'Vichnaya Pamyat',
        airDate: '2019-06-03'
      }
    ])
  })

  it('returns empty public lists for a movie and a series without episode data', async () => {
    const movieId = await findCatalogItemId('Dead Man')
    const emptySeriesId = await findCatalogItemId('Spartacus')

    const responses = await Promise.all([
      request(`/api/catalog/items/${movieId}/episodes`, 'GET', null),
      request(`/api/catalog/items/${emptySeriesId}/episodes`, 'GET', null)
    ])

    const bodies = await Promise.all(responses.map(async response => response.json()))

    for (const [index, response] of responses.entries()) {
      expect(response.status).toBe(200)
      expect(bodies[index]).toStrictEqual({ items: [] })
      expectNoStore(response)
    }
  })

  it('returns structured public invalid and missing title errors', async () => {
    const invalid = await request('/api/catalog/items/not-a-uuid/episodes', 'GET', null)
    const missing = await request('/api/catalog/items/01991a00-0000-7000-8000-999999999999/episodes', 'GET', null)

    expect(invalid.status).toBe(400)
    expect(missing.status).toBe(404)
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: 'INVALID_REQUEST' } })

    await expect(missing.json()).resolves.toStrictEqual({ error: {
      code: 'NOT_FOUND',
      message: 'This title could not be found.'
    } })

    expectNoStore(invalid)
    expectNoStore(missing)
  })

  it('authenticates protected requests before validating or revealing episode details', async () => {
    const responses = await Promise.all([
      request('/api/catalog/items/not-a-uuid/episodes/watched', 'GET', null),
      request('/api/catalog/episodes/not-a-uuid/watched', 'PUT', null),
      request('/api/catalog/episodes/not-a-uuid/watched', 'DELETE', null)
    ])

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

  it('loads bulk state and marks or unmarks one account idempotently', async () => {
    const chernobylId = await findCatalogItemId('Chernobyl')
    const episodeId = '30000000-0000-7000-8000-000000000001'
    const listingPath = `/api/catalog/items/${chernobylId}/episodes/watched`
    const mutationPath = `/api/catalog/episodes/${episodeId}/watched`
    const initial = await request(listingPath)
    const marked = await request(mutationPath, 'PUT')
    const markedAgain = await request(mutationPath, 'PUT')
    const firstAccount = await request(listingPath)
    const secondAccount = await request(listingPath, 'GET', SECOND_COOKIE)
    const unmarked = await request(mutationPath, 'DELETE')
    const unmarkedAgain = await request(mutationPath, 'DELETE')

    await expect(initial.json<CatalogEpisodeWatchesResponse>()).resolves.toStrictEqual({ watchedEpisodeIds: [] })
    await expect(marked.json<CatalogWatchedResponse>()).resolves.toStrictEqual({ watched: true })
    await expect(markedAgain.json<CatalogWatchedResponse>()).resolves.toStrictEqual({ watched: true })
    await expect(firstAccount.json<CatalogEpisodeWatchesResponse>()).resolves.toStrictEqual({ watchedEpisodeIds: [episodeId] })
    await expect(secondAccount.json<CatalogEpisodeWatchesResponse>()).resolves.toStrictEqual({ watchedEpisodeIds: [] })
    await expect(unmarked.json<CatalogWatchedResponse>()).resolves.toStrictEqual({ watched: false })
    await expect(unmarkedAgain.json<CatalogWatchedResponse>()).resolves.toStrictEqual({ watched: false })

    for (const response of [initial, marked, markedAgain, firstAccount, secondAccount, unmarked, unmarkedAgain]) {
      expect(response.status).toBe(200)
      expectNoStore(response)
    }
  })

  it('rejects a movie watched list and invalid or missing episode mutations', async () => {
    const movieId = await findCatalogItemId('Dead Man')
    const movie = await request(`/api/catalog/items/${movieId}/episodes/watched`)
    const invalid = await request('/api/catalog/episodes/not-a-uuid/watched', 'PUT')
    const missing = await request('/api/catalog/episodes/01991a00-0000-7000-8000-999999999999/watched', 'DELETE')

    expect(movie.status).toBe(400)
    expect(invalid.status).toBe(400)
    expect(missing.status).toBe(404)
    await expect(movie.json()).resolves.toMatchObject({ error: { code: 'INVALID_REQUEST' } })

    await expect(invalid.json()).resolves.toMatchObject({ error: {
      code: 'INVALID_REQUEST',
      fields: { id: 'Use a valid catalog episode UUID.' }
    } })

    await expect(missing.json()).resolves.toMatchObject({ error: { code: 'NOT_FOUND' } })
  })

  it('returns a safe 503 and keeps the raw database error in structured logs', async () => {
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {
      // Expected failure is inspected below.
    })

    const chernobylId = await findCatalogItemId('Chernobyl')

    await withClient(async (client) => {
      await client.query('ALTER TABLE catalog_episodes RENAME TO catalog_episodes_unavailable')

      try {
        const response = await request(`/api/catalog/items/${chernobylId}/episodes`, 'GET', null)
        const body = await response.json<CatalogErrorEnvelope>()

        expect(response.status).toBe(503)

        expect(body).toStrictEqual({ error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'The catalog is temporarily unavailable.'
        } })

        expectNoStore(response)

        const serialized = JSON.stringify(logs.mock.calls)

        expect(serialized).toContain('catalog_episodes')
        expect(serialized).toContain('does not exist')
        expect(serialized).toContain('requestId')
      } finally {
        await client.query('ALTER TABLE catalog_episodes_unavailable RENAME TO catalog_episodes')
      }
    })
  })
})
