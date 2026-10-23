/* oxlint-disable typescript/require-await -- HTTP and binding stubs preserve asynchronous interfaces without artificial waits. */
/* oxlint-disable eslint/max-lines -- Request source, authorization, and persistence scenarios share one disposable database and session fixture. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from 'node:process'
import * as v from 'valibot'
import { titleRequestPageSchema, titleRequestPreviewSchema, titleRequestSchema } from '@tv/shared/catalog-requests'
import { discoveryFixture } from '../../discovery/fixture.ts'
import { createCatalogApp } from '../../routes.ts'
import { hashSessionToken } from '../../../auth/session.ts'
import { movieResponse, seriesResponse } from '../../../testing/import-fixtures.ts'

const fixture = discoveryFixture()
const app = createCatalogApp()
const movieId = 2_000_001
const seriesId = 2_000_002
const firstToken = 'd'.repeat(43)
const secondToken = 's'.repeat(43)

const bindings = {
  DATABASE: { connectionString: env.TEST_DATABASE_URL },
  TMDB_READ_ACCESS_TOKEN: 'test-source-token',
  CATALOG_REQUEST_RATE_LIMITER: { limit: vi.fn<RateLimit['limit']>(async () => { return { success: true } }) }
}

const submitSchema = v.object({
  request: v.nullable(titleRequestSchema),
  catalogItemId: v.nullable(v.string())
})

async function request(path: string, token = firstToken, body?: unknown): Promise<Response> {
  const headers = new Headers()

  if (token !== '') { headers.set('Cookie', `__Host-tv_session=${token}`) }

  if (body !== undefined) { headers.set('Content-Type', 'application/json') }

  const payload = body === undefined ? null : JSON.stringify(body)
  const url = `https://tv-api.test/api/catalog/${path}`
  const method = body === undefined ? 'GET' : 'POST'

  return app.request(url, {
    method,
    headers,
    body: payload
  }, bindings)
}
async function read<Schema extends v.GenericSchema>(response: Response, schema: Schema): Promise<v.InferOutput<Schema>> {
  const raw: unknown = await response.json()

  return v.parse(schema, raw)
}
async function cleanRequests(): Promise<void> {
  await fixture.client.query('DELETE FROM catalog_title_requests WHERE tmdb_id = ANY($1::int[]) OR tmdb_id BETWEEN 2001001 AND 2013025', [[movieId, seriesId]])
}

describe('missing title requests', () => {
  beforeAll(fixture.setup)

  beforeEach(async () => {
    await cleanRequests()
    await fixture.reset()

    const hash = await hashSessionToken(secondToken)

    await fixture.client.query('INSERT INTO sessions(user_id, token_hash, expires_at) VALUES ($1,$2,now()+interval \'1 day\')', [fixture.secondUserId, hash])
    bindings.CATALOG_REQUEST_RATE_LIMITER.limit.mockReset()
    bindings.CATALOG_REQUEST_RATE_LIMITER.limit.mockResolvedValue({ success: true })

    const sourceFetch = vi.fn(async (input: string | URL | Request) => {
      const address = input instanceof Request ? input.url : input.toString()
      const url = new URL(address)

      if (url.pathname.startsWith('/3/search/')) {
        const series = url.pathname.endsWith('/tv')

        const result = series ? {
          id: seriesId,
          name: 'Original test series',
          original_name: 'Original test series',
          first_air_date: '2022-09-13',
          poster_path: '/series123.jpg'
        } : {
          id: movieId,
          title: 'English test title',
          original_title: 'Original test title',
          release_date: '2026-01-02',
          poster_path: '/movie123.jpg'
        }

        return Response.json({
          page: 1,
          total_pages: 1,
          results: [result]
        })
      }

      const series = url.pathname.includes('/tv/')
      const card = series ? seriesResponse() : movieResponse()
      const id = series ? seriesId : movieId

      const source = {
        ...card,
        id
      }

      return Response.json(source)
    })

    vi.stubGlobal('fetch', sourceFetch)
  })

  afterEach(vi.unstubAllGlobals)

  afterAll(async () => {
    await cleanRequests()
    await fixture.cleanup()
  })

  it('authenticates source access, isolates accounts and checks the operator grant on every read', async () => {
    const previewPath = `requests/preview?type=movie&tmdbId=${movieId}`
    const paths = ['requests', 'requests/search?type=movie&query=Title', previewPath, 'manage/requests']

    for (const path of paths) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Check each protected operation independently.
      const response = await request(path, '')

      expect(response.status).toBe(401)
    }

    const denied = await request('manage/requests', secondToken)

    expect(denied.status).toBe(403)

    const invalid = await request('requests', firstToken, {
      type: 'movie',
      tmdbId: movieId,
      title: 'Forged'
    })

    expect(invalid.status).toBe(400)
    await fixture.client.query('DELETE FROM user_permissions WHERE user_id=$1', [fixture.userId])

    const revoked = await request('manage/requests')

    expect(revoked.status).toBe(403)
  })

  it.each([
    {
      type: 'movie',
      id: movieId,
      title: 'English test title',
      originalTitle: 'Original test title',
      year: 2026,
      poster: 'movie123.jpg'
    },
    {
      type: 'series',
      id: seriesId,
      title: 'Original test series',
      originalTitle: 'Original test series',
      year: 2022,
      poster: 'series123.jpg'
    }
  ] as const)('allows an ordinary account to search and review a $type without an operator grant', async ({ type, id, title, originalTitle, year, poster }) => {
    const searchPath = `requests/search?type=${type}&query=Title`
    const searchResponse = await request(searchPath, secondToken)

    expect(searchResponse.status).toBe(200)

    const search: unknown = await searchResponse.json()
    const posterUrl = `https://image.tmdb.org/t/p/w500/${poster}`

    expect(search).toStrictEqual({
      items: [{
        id,
        type,
        title,
        originalTitle,
        year,
        posterUrl
      }],

      nextPage: null
    })

    const previewPath = `requests/preview?type=${type}&tmdbId=${id}`
    const previewResponse = await request(previewPath, secondToken)

    expect(previewResponse.status).toBe(200)

    const preview = await read(previewResponse, titleRequestPreviewSchema)

    expect(preview.card).toMatchObject({
      type,
      tmdbId: id,
      title,
      originalTitle,
      year
    })

    expect(preview.catalogItemId).toBeNull()
  })

  it.each([
    {
      operation: 'search',
      path: 'requests/search?type=movie&query=Title',
      body: undefined
    },
    {
      operation: 'preview',
      path: `requests/preview?type=movie&tmdbId=${movieId}`,
      body: undefined
    },
    {
      operation: 'create',
      path: 'requests',

      body: {
        type: 'movie',
        tmdbId: movieId
      }
    }
  ])('rejects a rate-limited $operation before source access or persistence', async ({ path, body }) => {
    bindings.CATALOG_REQUEST_RATE_LIMITER.limit.mockResolvedValue({ success: false })

    const response = await request(path, secondToken, body)
    const retryAfter = response.headers.get('retry-after')

    expect(response.status).toBe(429)
    expect(retryAfter).toBe('60')

    const error: unknown = await response.json()

    expect(error).toStrictEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Try again in a minute.'
      }
    })

    expect(fetch).not.toHaveBeenCalled()

    const ownResponse = await request('requests', secondToken)
    const own = await read(ownResponse, titleRequestPageSchema)

    expect(own.items).toStrictEqual([])
  })

  it('shares one user limiter key across source operations and keeps different users separate', async () => {
    const input = {
      type: 'movie',
      tmdbId: movieId
    }

    const previewPath = `requests/preview?type=movie&tmdbId=${movieId}`

    const pending = [
      request('requests/search?type=movie&query=Title', firstToken),
      request(previewPath, firstToken),
      request('requests', firstToken, input),
      request('requests/search?type=movie&query=Title', secondToken),
      request(previewPath, secondToken),
      request('requests', secondToken, input)
    ]

    const responses = await Promise.all(pending)
    const statuses = responses.map(response => response.status)
    const keys = bindings.CATALOG_REQUEST_RATE_LIMITER.limit.mock.calls.map(([options]) => options.key)
    const firstKeys = keys.filter(key => key === fixture.userId)
    const secondKeys = keys.filter(key => key === fixture.secondUserId)

    expect(statuses).toStrictEqual([200, 200, 201, 200, 200, 201])
    expect(keys).toHaveLength(6)
    expect(firstKeys).toHaveLength(3)
    expect(secondKeys).toHaveLength(3)
  })

  it('keeps same-title candidates separate from an exact source and permits a request for a similar title', async () => {
    const [similarId, , exactId] = fixture.ids

    await fixture.client.query('UPDATE catalog_items SET release_year = 2020 WHERE id = ANY($1::uuid[])', [[similarId, exactId]])
    await fixture.client.query('UPDATE catalog_item_titles SET title = \'Original test title\' WHERE catalog_item_id = $1', [similarId])

    const path = `requests/preview?type=movie&tmdbId=${movieId}`
    const possibleResponse = await request(path, secondToken)
    const possible = await read(possibleResponse, titleRequestPreviewSchema)

    expect(possible.catalogItemId).toBeNull()

    expect(possible.similar).toStrictEqual([{
      id: similarId,
      title: 'Original test title',
      year: 2020,
      type: 'movie'
    }])

    const input = {
      type: 'movie',
      tmdbId: movieId
    }

    const submitResponse = await request('requests', secondToken, input)
    const submitted = await read(submitResponse, submitSchema)

    expect(submitResponse.status).toBe(201)
    expect(submitted.request?.status).toBe('pending')
    expect(submitted.catalogItemId).toBeNull()
    await fixture.client.query('UPDATE catalog_item_titles SET title = \'Original test title\' WHERE catalog_item_id = $1', [exactId])

    const externalId = String(movieId)

    await fixture.client.query('INSERT INTO catalog_external_links(provider,entity_type,external_id,catalog_item_id) VALUES (\'tmdb\',\'movie\',$1,$2)', [externalId, exactId])

    const exactResponse = await request(path, firstToken)
    const exact = await read(exactResponse, titleRequestPreviewSchema)

    expect(exact.catalogItemId).toBe(exactId)
    expect(exact.similar).toStrictEqual(possible.similar)

    const availableResponse = await request('requests', firstToken, input)
    const available = await read(availableResponse, submitSchema)

    expect(availableResponse.status).toBe(200)
    expect(available.request).toBeNull()
    expect(available.catalogItemId).toBe(exactId)
  })

  it('groups concurrent accounts, replays membership and resolves every requester through an exact imported source', async () => {
    const previewPath = `requests/preview?type=movie&tmdbId=${movieId}`
    const previewResponse = await request(previewPath)

    expect(previewResponse.status).toBe(200)

    const preview = await read(previewResponse, titleRequestPreviewSchema)

    expect(preview.card.title).toBe('English test title')

    const input = {
      type: 'movie',
      tmdbId: movieId
    }

    const pending = [request('requests', firstToken, input), request('requests', secondToken, input), request('requests', firstToken, input)]
    const responses = await Promise.all(pending)
    const pendingOutcomes = responses.map(async response => read(response, submitSchema))
    const outcomes = await Promise.all(pendingOutcomes)
    const requestIds = outcomes.map(outcome => outcome.request?.id)
    const uniqueIds = new Set(requestIds)

    expect(uniqueIds.size).toBe(1)

    const queueResponse = await request('manage/requests')
    const queue = await read(queueResponse, titleRequestPageSchema)
    const entry = queue.items.find(item => item.card.tmdbId === movieId)

    expect(entry?.requesterCount).toBe(2)

    const ownResponse = await request('requests', secondToken)
    const own = await read(ownResponse, titleRequestPageSchema)

    expect(own.items).toHaveLength(1)
    expect(own.items[0]?.status).toBe('pending')

    const externalId = String(movieId)

    await fixture.client.query('INSERT INTO catalog_external_links(provider,entity_type,external_id,catalog_item_id) VALUES (\'tmdb\',\'movie\',$1,$2)', [externalId, fixture.ids[0]])

    const addedResponse = await request('requests', secondToken)
    const added = await read(addedResponse, titleRequestPageSchema)

    expect(added.items[0]?.status).toBe('available')
    expect(added.items[0]?.catalogItemId).toBe(fixture.ids[0])

    const fulfilledResponse = await request('manage/requests')
    const fulfilled = await read(fulfilledResponse, titleRequestPageSchema)
    const stillPending = fulfilled.items.some(item => item.card.tmdbId === movieId)

    expect(stillPending).toBe(false)

    const failedFetch = vi.fn(async () => { throw new Error('Source unavailable after commit') })

    vi.stubGlobal('fetch', failedFetch)

    const retry = await request('requests', firstToken, input)

    expect(retry.status).toBe(200)

    const replay = await read(retry, submitSchema)

    expect(replay.request?.status).toBe('available')
  })

  it('accepts a series card without episode source selection and exposes no other account membership', async () => {
    const response = await request('requests', firstToken, {
      type: 'series',
      tmdbId: seriesId
    })

    expect(response.status).toBe(201)

    const saved = await read(response, submitSchema)

    expect(saved.request?.card.originalTitle).toBe('Original test series')

    const otherResponse = await request('requests', secondToken)
    const other = await read(otherResponse, titleRequestPageSchema)

    expect(other.items).toStrictEqual([])
  })

  it('keeps failed source operations out of persistence and hides private source diagnostics', async () => {
    const failedFetch = vi.fn(async () => {
      const response = new Response('Private source diagnostic', { status: 404 })

      return response
    })

    vi.stubGlobal('fetch', failedFetch)

    const failed = await request('requests', firstToken, {
      type: 'movie',
      tmdbId: movieId
    })

    expect(failed.status).toBe(503)

    const message = failed.text()

    await expect(message).resolves.not.toContain('Private source diagnostic')

    const ownResponse = await request('requests')
    const own = await read(ownResponse, titleRequestPageSchema)

    expect(own.items).toStrictEqual([])
  })

  it('returns an available title when a manual import commits while source metadata is loading', async () => {
    const entered = Promise.withResolvers<null>()
    const release = Promise.withResolvers<null>()
    const card = movieResponse()

    const source = {
      ...card,
      id: movieId
    }

    const delayedFetch = vi.fn(async () => {
      entered.resolve(null)

      await release.promise

      return Response.json(source)
    })

    vi.stubGlobal('fetch', delayedFetch)

    const pending = request('requests', firstToken, {
      type: 'movie',
      tmdbId: movieId
    })

    await entered.promise

    const externalId = String(movieId)

    await fixture.client.query('INSERT INTO catalog_external_links(provider,entity_type,external_id,catalog_item_id) VALUES (\'tmdb\',\'movie\',$1,$2)', [externalId, fixture.ids[0]])
    release.resolve(null)

    const response = await pending
    const saved = await read(response, submitSchema)

    expect(saved.catalogItemId).toBe(fixture.ids[0])

    const queueResponse = await request('manage/requests')
    const queue = await read(queueResponse, titleRequestPageSchema)
    const stillPending = queue.items.some(item => item.card.tmdbId === movieId)

    expect(stillPending).toBe(false)
  })

  it('orders personal history by membership dates and the grouped pending queue by its first requester', async () => {
    await fixture.client.query(`INSERT INTO catalog_title_requests(type,tmdb_id,card,created_at)
      SELECT 'movie', 2001000+n, jsonb_build_object('type','movie','tmdbId',2001000+n,
        'title','Requested '||n,'originalTitle','Requested '||n,'year',null,'description',null,'posterUrl',null),
        '2020-02-01'::timestamptz - n * interval '1 day' FROM generate_series(1,27) n`)

    await fixture.client.query(`INSERT INTO catalog_title_requesters(request_id,user_id,created_at)
      SELECT id,$1,'2021-01-01'::timestamptz + (tmdb_id-2001000) * interval '1 day'
      FROM catalog_title_requests WHERE tmdb_id BETWEEN 2001001 AND 2001027`, [fixture.userId])

    await fixture.client.query(`INSERT INTO catalog_title_requesters(request_id,user_id,created_at)
      SELECT id,$1,'2020-03-01'::timestamptz + (tmdb_id-2001000) * interval '1 day'
      FROM catalog_title_requests WHERE tmdb_id BETWEEN 2001001 AND 2001027`, [fixture.secondUserId])

    const firstResponse = await request('requests')
    const first = await read(firstResponse, titleRequestPageSchema)

    expect(first.items).toHaveLength(24)
    expect(first.items[0]?.card.tmdbId).toBe(2_001_027)
    expect(first.items[0]?.createdAt).toBe('2021-01-28T00:00:00.000Z')
    expect(first.nextPage).toBe(2)

    const secondResponse = await request('requests?page=2')
    const second = await read(secondResponse, titleRequestPageSchema)

    expect(second.items).toHaveLength(3)
    expect(second.items[2]?.card.tmdbId).toBe(2_001_001)
    expect(second.items[2]?.createdAt).toBe('2021-01-02T00:00:00.000Z')
    expect(second.nextPage).toBeNull()

    const queueResponse = await request('manage/requests')
    const queue = await read(queueResponse, titleRequestPageSchema)

    expect(queue.items[0]?.card.tmdbId).toBe(2_001_001)
    expect(queue.items[0]?.createdAt).toBe('2020-03-02T00:00:00.000Z')
    expect(queue.items[0]?.requesterCount).toBe(2)
  })

  it('reads stored personal and incoming pages beyond the TMDB page limit', async () => {
    await fixture.client.query(`INSERT INTO catalog_title_requests(type,tmdb_id,card,created_at)
      SELECT 'movie', 2001000+n, jsonb_build_object('type','movie','tmdbId',2001000+n,
        'title','Requested '||n,'originalTitle','Requested '||n,'year',null,'description',null,'posterUrl',null),
        '2019-01-01'::timestamptz
      FROM generate_series(1,12025) n`)

    await fixture.client.query(`INSERT INTO catalog_title_requesters(request_id,user_id,created_at)
      SELECT id,$1,'2020-01-01'::timestamptz + (tmdb_id-2001000) * interval '1 second'
      FROM catalog_title_requests WHERE tmdb_id BETWEEN 2001001 AND 2013025`, [fixture.userId])

    const ownResponse = await request('requests?page=501')

    expect(ownResponse.status).toBe(200)

    const own = await read(ownResponse, titleRequestPageSchema)

    expect(own.items).toHaveLength(24)
    expect(own.items[0]?.card.tmdbId).toBe(2_001_025)
    expect(own.nextPage).toBe(502)

    const finalResponse = await request('requests?page=502')
    const final = await read(finalResponse, titleRequestPageSchema)

    expect(final.items).toHaveLength(1)
    expect(final.items[0]?.card.tmdbId).toBe(2_001_001)
    expect(final.nextPage).toBeNull()

    const queueResponse = await request('manage/requests?page=501')

    expect(queueResponse.status).toBe(200)

    const queue = await read(queueResponse, titleRequestPageSchema)

    expect(queue.items).toHaveLength(24)
    expect(queue.items[0]?.card.tmdbId).toBe(2_013_001)
    expect(queue.nextPage).toBe(502)

    const searchResponse = await request('requests/search?type=movie&query=Title&page=501')

    expect(searchResponse.status).toBe(400)
  })
})
