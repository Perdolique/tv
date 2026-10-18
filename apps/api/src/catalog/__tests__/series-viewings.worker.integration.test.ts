import { env, exports } from 'cloudflare:workers'
import { Client } from 'pg'
import { catalogSeriesWatchesResponseSchema } from '@tv/shared/catalog-series'
import { catalogRatingMutationResponseSchema, catalogViewingMutationResponseSchema } from '@tv/shared/catalog-viewings'
import * as v from 'valibot'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashSessionToken } from '../../auth/session.ts'
import { assertDisposableTestDatabase } from '../../testing/test-database.ts'

const sessionToken = 'p'.repeat(43)
const otherSessionToken = 'q'.repeat(43)
const userId = crypto.randomUUID()
const otherUserId = crypto.randomUUID()
const catalogItemId = crypto.randomUUID()
const firstEpisodeId = crypto.randomUUID()
const futureEpisodeId = crypto.randomUUID()
const cookie = `__Host-tv_session=${sessionToken}`

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

interface SeriesRequestOptions {
  method?: string;
  body?: unknown;
  authenticated?: boolean;
  cookie?: string;
}

async function request(path: string, options: SeriesRequestOptions = {}): Promise<Response> {
  const headers = new Headers()

  if (options.authenticated !== false) {
    headers.set('Cookie', options.cookie ?? cookie)
  }

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  const method = options.method ?? 'GET'
  const body = options.body === undefined || method === 'GET' ? null : JSON.stringify(options.body)
  const url = `https://tv-api.test${path}`

  const upstream = new Request(url, {
    method,
    headers,
    body
  })

  const response = await exports.default.fetch(upstream)

  expect(response.headers.get('cache-control')).toBe('no-store')

  return response
}

function initialInput() {
  const requestId = crypto.randomUUID()

  return {
    requestId,
    currentViewingId: null,
    contextVersion: 0,
    timeZone: 'Europe/Tallinn',
    viewingDate: '2000-01-01'
  }
}

describe('series viewing Worker transport', () => {
  beforeEach(async () => {
    const tokenHash = await hashSessionToken(sessionToken)
    const otherTokenHash = await hashSessionToken(otherSessionToken)

    await withClient(async client => {
      const email = `${userId}@example.com`
      const otherEmail = `${otherUserId}@example.com`

      await client.query('INSERT INTO users (id, email) VALUES ($1, $2)', [userId, email])
      await client.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'1 day\')', [userId, tokenHash])
      await client.query('INSERT INTO users (id, email) VALUES ($1, $2)', [otherUserId, otherEmail])
      await client.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'1 day\')', [otherUserId, otherTokenHash])
      await client.query('INSERT INTO catalog_items (id, type) VALUES ($1, \'series\')', [catalogItemId])
      await client.query('INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original) VALUES ($1, \'en\', \'Series Worker fixture\', true)', [catalogItemId])
      await client.query('INSERT INTO catalog_episodes (id, catalog_item_id, season_number, episode_number, air_date) VALUES ($1, $3, 1, 1, \'2000-01-01\'), ($2, $3, 1, 2, \'9999-01-01\')', [firstEpisodeId, futureEpisodeId, catalogItemId])
    })
  })

  afterEach(async () => {
    await withClient(async client => {
      await client.query('DELETE FROM users WHERE id = $1', [userId])
      await client.query('DELETE FROM users WHERE id = $1', [otherUserId])
      await client.query('DELETE FROM catalog_items WHERE id = $1', [catalogItemId])
    })
  })

  it('authenticates all series mutations and selected reads before IDs or bodies', async () => {
    const targets = [
      ['GET', '/api/catalog/items/invalid/episodes/watched?viewingId=invalid'],
      ['PUT', '/api/catalog/episodes/invalid/watched'],
      ['DELETE', '/api/catalog/episodes/invalid/watched'],
      ['POST', '/api/catalog/items/invalid/seasons/invalid/watched'],
      ['POST', '/api/catalog/items/invalid/episodes/watched'],
      ['POST', '/api/catalog/items/invalid/viewings'],
      ['DELETE', '/api/catalog/items/invalid/rewatch']
    ] as const

    for (const [method, path] of targets) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each independent route must reject before parsing its input.
      const response = await request(path, {
        method,
        body: {},
        authenticated: false
      })

      expect(response.status).toBe(401)
    }
  })

  it('validates operation context, dates, timezone and owner without creating diary data', async () => {
    const path = `/api/catalog/episodes/${firstEpisodeId}/watched`
    const input = initialInput()

    const invalidInputs = [{}, {
      ...input,
      requestId: undefined
    }, {
      ...input,
      contextVersion: -1
    }, {
      ...input,
      timeZone: 'invalid/zone'
    }, {
      ...input,
      userId
    }, {
      ...input,
      viewingDate: '2023-02-29'
    }]

    for (const body of invalidInputs) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each invalid transport contract has the same observable rejection.
      const response = await request(path, {
        method: 'PUT',
        body
      })

      expect(response.status).toBe(400)
    }

    const unavailable = await request(`/api/catalog/episodes/${futureEpisodeId}/watched`, {
      method: 'PUT',
      body: input
    })

    const response = await request(`/api/catalog/items/${catalogItemId}/episodes/watched`)
    const stateRaw: unknown = await response.json()
    const state = v.parse(catalogSeriesWatchesResponseSchema, stateRaw)

    expect(unavailable.status).toBe(400)
    expect(state.viewing).toBeNull()
    expect(state.watches).toHaveLength(0)
  })

  it('keeps historical marks scoped and cancels a combined rewatch through the confirmed context', async () => {
    const firstInput = initialInput()

    const firstResponse = await request(`/api/catalog/episodes/${firstEpisodeId}/watched`, {
      method: 'PUT',
      body: firstInput
    })

    const firstRaw: unknown = await firstResponse.json()
    const first = v.parse(catalogSeriesWatchesResponseSchema, firstRaw)

    expect(firstResponse.status).toBe(200)
    expect(first.viewing?.startedOn).toBe('2000-01-01')

    const creationRequestId = crypto.randomUUID()

    const createInput = {
      requestId: creationRequestId,
      mode: 'current',
      currentViewingId: first.viewing?.id,
      contextVersion: first.summary.contextVersion,
      status: 'watching',
      startedOn: '2000-01-03',
      completedOn: null,
      completeCurrentOn: '2000-01-02'
    }

    const nextResponse = await request(`/api/catalog/items/${catalogItemId}/viewings`, {
      method: 'POST',
      body: createInput
    })

    const nextRaw: unknown = await nextResponse.json()
    const next = v.parse(catalogViewingMutationResponseSchema, nextRaw)

    expect(nextResponse.status).toBe(200)

    expect(next.viewing).toMatchObject({
      score: null,
      isRewatch: true,
      canCancelRewatch: true
    })

    const selectedResponse = await request(`/api/catalog/items/${catalogItemId}/episodes/watched?viewingId=${first.viewing?.id}`)
    const selectedRaw: unknown = await selectedResponse.json()
    const selected = v.parse(catalogSeriesWatchesResponseSchema, selectedRaw)

    expect(selected.viewing?.id).toBe(first.viewing?.id)
    expect(selected.summary.currentViewingId).toBe(next.viewing.id)

    const selectedEpisodeIds = selected.watches.map(mark => mark.catalogEpisodeId)

    expect(selectedEpisodeIds).toStrictEqual([firstEpisodeId])

    const other = await request(`/api/catalog/items/${catalogItemId}/episodes/watched?viewingId=${first.viewing?.id}`, { cookie: `__Host-tv_session=${otherSessionToken}` })

    expect(other.status).toBe(404)

    const cancellationRequestId = crypto.randomUUID()

    const canceled = await request(`/api/catalog/items/${catalogItemId}/rewatch`, {
      method: 'DELETE',

      body: {
        requestId: cancellationRequestId,
        currentViewingId: next.viewing.id,
        contextVersion: next.summary.contextVersion
      }
    })

    expect(canceled.status).toBe(200)

    const restoredResponse = await request(`/api/catalog/items/${catalogItemId}/episodes/watched`)
    const restoredRaw: unknown = await restoredResponse.json()
    const restored = v.parse(catalogSeriesWatchesResponseSchema, restoredRaw)

    expect(restored.viewing).toMatchObject({
      id: first.viewing?.id,
      status: 'watching',
      completedOn: null
    })

    expect(restored.watches).toStrictEqual(first.watches)

    const late = await request(`/api/catalog/items/${catalogItemId}/viewings`, {
      method: 'POST',
      body: createInput
    })

    expect(late.status).toBe(409)
  })

  it('requires rated-unwatch confirmation and returns the atomically corrected marks and vote', async () => {
    const response = await request(`/api/catalog/episodes/${firstEpisodeId}/rating`, {
      method: 'PUT',

      body: {
        ...initialInput(),
        score: 8
      }
    })

    const ratedRaw: unknown = await response.json()
    const rated = v.parse(catalogRatingMutationResponseSchema, ratedRaw)
    const watch = rated.watches?.[0]

    expect(response.status).toBe(200)
    expect(watch).toBeDefined()

    const unwatchRequestId = crypto.randomUUID()

    const input = {
      requestId: unwatchRequestId,
      currentViewingId: rated.viewing?.id,
      contextVersion: rated.summary.contextVersion,
      watchId: watch?.id
    }

    const refused = await request(`/api/catalog/episodes/${firstEpisodeId}/watched`, {
      method: 'DELETE',
      body: input
    })

    expect(refused.status).toBe(409)

    const confirmed = await request(`/api/catalog/episodes/${firstEpisodeId}/watched`, {
      method: 'DELETE',

      body: {
        ...input,
        confirmRatingRemoval: true
      }
    })

    const removedRaw: unknown = await confirmed.json()
    const removed = v.parse(catalogSeriesWatchesResponseSchema, removedRaw)

    expect(confirmed.status).toBe(200)
    expect(removed.watches).toHaveLength(0)

    const rating = await request(`/api/catalog/episodes/${firstEpisodeId}/rating`)
    const currentRaw: unknown = await rating.json()
    const current = v.parse(catalogRatingMutationResponseSchema, currentRaw)

    expect(current.score).toBeNull()

    await withClient(async client => {
      const votes = await client.query('SELECT id FROM catalog_rating_votes WHERE user_id=$1 AND catalog_episode_id=$2', [userId, firstEpisodeId])

      expect(votes.rows).toHaveLength(0)
    })
  })
})
