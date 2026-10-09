/* oxlint-disable eslint/max-lines -- Public episode lists and private watch contracts share one Worker session fixture. */
import { env, exports } from 'cloudflare:workers'
import { Client } from 'pg'
import type { CatalogEpisodesResponse, CatalogErrorEnvelope } from '@tv/shared/catalog'
import type { CatalogSeriesWatchesResponse } from '@tv/shared/catalog-series'
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest'
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

interface EpisodeRequestOptions {
  cookie?: string | null;
  body?: unknown;
}

async function request(
  path: string,
  method = 'GET',
  { cookie = FIRST_COOKIE, body }: EpisodeRequestOptions = {}
): Promise<Response> {
  const headers = new Headers()

  if (cookie !== null) {
    headers.set('Cookie', cookie)
  }

  const init: RequestInit = {
    headers,
    method
  }

  if (body !== undefined && method !== 'GET') {
    headers.set('Content-Type', 'application/json')

    init.body = JSON.stringify(body)
  }

  const apiUrl = `https://tv-api.test${path}`
  const apiRequest = new Request(apiUrl, init)

  return exports.default.fetch(apiRequest)
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
    const episodesPath = `/api/catalog/items/${chernobylId}/episodes`
    const response = await request(episodesPath, 'GET', { cookie: null })
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
    const emptySeriesId = '71000000-0000-7000-8000-000000000003'

    await withClient(async (client) => {
      await client.query(`
        INSERT INTO catalog_items (id, type, release_year) VALUES ($1, 'series', 2099)
      `, [emptySeriesId])

      await client.query(`
        INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original)
        VALUES ($1, 'en', 'Series without an episode snapshot', true)
      `, [emptySeriesId])
    })

    try {
      const movieEpisodesPath = `/api/catalog/items/${movieId}/episodes`
      const emptySeriesEpisodesPath = `/api/catalog/items/${emptySeriesId}/episodes`
      const movieEpisodesRequest = request(movieEpisodesPath, 'GET', { cookie: null })
      const emptySeriesEpisodesRequest = request(emptySeriesEpisodesPath, 'GET', { cookie: null })
      const responses = await Promise.all([movieEpisodesRequest, emptySeriesEpisodesRequest])
      const bodyReads = responses.map(async response => response.json())
      const bodies = await Promise.all(bodyReads)

      for (const [index, response] of responses.entries()) {
        expect(response.status).toBe(200)
        expect(bodies[index]).toStrictEqual({ items: [] })
        expectNoStore(response)
      }
    } finally {
      await withClient(async (client) => {
        await client.query('DELETE FROM catalog_items WHERE id = $1', [emptySeriesId])
      })
    }
  })

  it('returns structured public invalid and missing title errors', async () => {
    const invalid = await request('/api/catalog/items/not-a-uuid/episodes', 'GET', { cookie: null })
    const missing = await request('/api/catalog/items/01991a00-0000-7000-8000-999999999999/episodes', 'GET', { cookie: null })

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
    const watchedListingRequest = request('/api/catalog/items/not-a-uuid/episodes/watched', 'GET', { cookie: null })
    const markRequest = request('/api/catalog/episodes/not-a-uuid/watched', 'PUT', { cookie: null })
    const unmarkRequest = request('/api/catalog/episodes/not-a-uuid/watched', 'DELETE', { cookie: null })
    const responses = await Promise.all([watchedListingRequest, markRequest, unmarkRequest])
    const bodyReads = responses.map(async response => response.json())
    const bodies = await Promise.all(bodyReads)

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
    const requestId = crypto.randomUUID()

    const input = {
      requestId,
      currentViewingId: null,
      contextVersion: 0,
      timeZone: 'UTC'
    }

    const marked = await request(mutationPath, 'PUT', { body: input })
    const markedBody = await marked.json<CatalogSeriesWatchesResponse>()
    const viewingId = markedBody.currentViewing?.id
    const watchId = markedBody.watches[0]?.id

    assert(viewingId !== undefined)
    assert(watchId !== undefined)

    const markedAgain = await request(mutationPath, 'PUT', { body: input })
    const firstAccount = await request(listingPath)
    const secondAccount = await request(listingPath, 'GET', { cookie: SECOND_COOKIE })

    const unwatch = {
      currentViewingId: viewingId,
      contextVersion: markedBody.contextVersion,
      watchId
    }

    const unmarked = await request(mutationPath, 'DELETE', { body: unwatch })
    const unmarkedAgain = await request(mutationPath, 'DELETE', { body: unwatch })

    const emptyState = {
      watchedEpisodeIds: [],
      watches: [],
      currentViewing: null,
      contextVersion: 0
    }

    await expect(initial.json<CatalogSeriesWatchesResponse>()).resolves.toStrictEqual(emptyState)
    expect(markedBody.watchedEpisodeIds).toStrictEqual([episodeId])
    expect(markedBody.watches).toHaveLength(1)

    expect(markedBody.watches[0]).toMatchObject({
      id: watchId,
      catalogEpisodeId: episodeId,
      viewingId
    })

    expect(markedBody.watches[0]?.markedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u)

    expect(markedBody.currentViewing).toMatchObject({
      id: viewingId,
      catalogItemId: chernobylId,
      status: 'watching',
      revision: 1
    })

    expect(markedBody.contextVersion).toBe(1)
    await expect(markedAgain.json<CatalogSeriesWatchesResponse>()).resolves.toStrictEqual(markedBody)
    await expect(firstAccount.json<CatalogSeriesWatchesResponse>()).resolves.toStrictEqual(markedBody)
    await expect(secondAccount.json<CatalogSeriesWatchesResponse>()).resolves.toStrictEqual(emptyState)

    const unmarkedBody = await unmarked.json<CatalogSeriesWatchesResponse>()

    expect(unmarkedBody).toStrictEqual({
      watchedEpisodeIds: [],
      watches: [],
      currentViewing: markedBody.currentViewing,
      contextVersion: markedBody.contextVersion
    })

    await expect(unmarkedAgain.json<CatalogSeriesWatchesResponse>()).resolves.toStrictEqual(unmarkedBody)

    for (const response of [initial, marked, markedAgain, firstAccount, secondAccount, unmarked, unmarkedAgain]) {
      expect(response.status).toBe(200)
      expectNoStore(response)
    }
  })

  it('rejects a movie watched list and invalid or missing episode mutations', async () => {
    const movieId = await findCatalogItemId('Dead Man')
    const movieWatchedPath = `/api/catalog/items/${movieId}/episodes/watched`
    const movie = await request(movieWatchedPath)
    const invalid = await request('/api/catalog/episodes/not-a-uuid/watched', 'PUT')

    const missing = await request('/api/catalog/episodes/01991a00-0000-7000-8000-999999999999/watched', 'DELETE', { body: {
      currentViewingId: '71000000-0000-7000-8000-000000000004',
      contextVersion: 1,
      watchId: '71000000-0000-7000-8000-000000000005'
    } })

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

  it.each(['PUT', 'DELETE'])('rejects a legacy bodyless %s before changing episode watches', async (method) => {
    const chernobylId = await findCatalogItemId('Chernobyl')
    const episodeId = '30000000-0000-7000-8000-000000000001'
    const mutationPath = `/api/catalog/episodes/${episodeId}/watched`
    const listingPath = `/api/catalog/items/${chernobylId}/episodes/watched`
    const response = await request(mutationPath, method)
    const state = await request(listingPath)

    expect(response.status).toBe(409)
    expectNoStore(response)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'CONFLICT' } })

    await expect(state.json<CatalogSeriesWatchesResponse>()).resolves.toStrictEqual({
      watchedEpisodeIds: [],
      watches: [],
      currentViewing: null,
      contextVersion: 0
    })
  })

  it('returns a safe 503 and keeps the raw database error in structured logs', async () => {
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {
      // Expected failure is inspected below.
    })

    const chernobylId = await findCatalogItemId('Chernobyl')

    await withClient(async (client) => {
      await client.query('ALTER TABLE catalog_episodes RENAME TO catalog_episodes_unavailable')

      try {
        const episodesPath = `/api/catalog/items/${chernobylId}/episodes`
        const response = await request(episodesPath, 'GET', { cookie: null })
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
