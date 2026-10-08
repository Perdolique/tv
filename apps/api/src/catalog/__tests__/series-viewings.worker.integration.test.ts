import { env, exports } from 'cloudflare:workers'
import { Client } from 'pg'
import type { CatalogSeriesWatchesResponse } from '@tv/shared/catalog-series'
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
    timeZone: 'Europe/Tallinn'
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

  it('authenticates every private endpoint before parsing target IDs and request bodies', async () => {
    const targets: [string, string][] = [
      ['GET', '/api/catalog/items/invalid/episodes/watched'],
      ['PUT', '/api/catalog/episodes/invalid/watched'],
      ['DELETE', '/api/catalog/episodes/invalid/watched'],
      ['POST', '/api/catalog/items/invalid/seasons/invalid/watched'],
      ['POST', '/api/catalog/items/invalid/episodes/watched'],
      ['POST', '/api/catalog/items/invalid/rewatch'],
      ['DELETE', '/api/catalog/items/invalid/rewatch']
    ]

    const protectedRequests = targets.map(async ([method, path]) => {
      const response = await request(path, {
        method,
        body: { invalid: true },
        authenticated: false
      })

      expect(response.status).toBe(401)
    })

    await Promise.all(protectedRequests)
  })

  it('rejects old clients without creating any viewing and validates time zones and obsolete close choices', async () => {
    const episodeWatchedPath = `/api/catalog/episodes/${firstEpisodeId}/watched`
    const listingPath = `/api/catalog/items/${catalogItemId}/episodes/watched`
    const rewatchPath = `/api/catalog/items/${catalogItemId}/rewatch`
    const oldMark = await request(episodeWatchedPath, { method: 'PUT' })

    expect(oldMark.status).toBe(409)

    const emptyRead = await request(listingPath)
    const emptyReadBody = emptyRead.json<unknown>()

    await expect(emptyReadBody).resolves.toStrictEqual({
      watches: [],
      watchedEpisodeIds: [],
      currentViewing: null,
      contextVersion: 0
    })

    const initialZoneInput = initialInput()

    const invalidZoneInput = {
      ...initialZoneInput,
      timeZone: 'Not/AZone'
    }

    const invalidZone = await request(episodeWatchedPath, {
      method: 'PUT',
      body: invalidZoneInput
    })

    expect(invalidZone.status).toBe(400)

    const firstMarkInput = initialInput()

    const firstMark = await request(episodeWatchedPath, {
      method: 'PUT',
      body: firstMarkInput
    })

    expect(firstMark.status).toBe(200)

    const first = await firstMark.json<CatalogSeriesWatchesResponse>()
    const closeRequestId = crypto.randomUUID()

    const incompleteCloseInput = {
      requestId: closeRequestId,
      currentViewingId: first.currentViewing?.id,
      contextVersion: first.contextVersion,
      timeZone: 'UTC'
    }

    const incompleteClose = await request(rewatchPath, {
      method: 'POST',

      body: {
        ...incompleteCloseInput,
        closeStatus: 'paused'
      }
    })

    expect(incompleteClose.status).toBe(400)

    const incompleteCloseBody = incompleteClose.json<unknown>()

    await expect(incompleteCloseBody).resolves.toHaveProperty('error')
  })

  it('cancels only an owned empty rewatch and restores the earlier marks through HTTP', async () => {
    const episodePath = `/api/catalog/episodes/${firstEpisodeId}/watched`
    const rewatchPath = `/api/catalog/items/${catalogItemId}/rewatch`

    const firstMark = await request(episodePath, {
      method: 'PUT',
      body: initialInput()
    })

    const first = await firstMark.json<CatalogSeriesWatchesResponse>()

    const input = {
      requestId: crypto.randomUUID(),
      currentViewingId: first.currentViewing?.id,
      contextVersion: first.contextVersion,
      timeZone: 'UTC'
    }

    const start = await request(rewatchPath, {
      method: 'POST',
      body: input
    })

    const next = await start.json<CatalogSeriesWatchesResponse>()

    expect(start.status).toBe(200)
    expect(next.currentViewing?.isRewatch).toBe(true)

    const cancellation = {
      currentViewingId: next.currentViewing?.id,
      contextVersion: next.contextVersion
    }

    const otherCancellation = await request(rewatchPath, {
      method: 'DELETE',
      body: cancellation,
      cookie: `__Host-tv_session=${otherSessionToken}`
    })

    expect(otherCancellation.status).toBe(200)

    await expect(otherCancellation.json<unknown>()).resolves.toStrictEqual({
      watches: [],
      watchedEpisodeIds: [],
      currentViewing: null,
      contextVersion: 0
    })

    const stillCurrent = await request(`/api/catalog/items/${catalogItemId}/episodes/watched`)

    await expect(stillCurrent.json<unknown>()).resolves.toStrictEqual(next)

    const canceled = await request(rewatchPath, {
      method: 'DELETE',
      body: cancellation
    })

    const restored = await canceled.json<CatalogSeriesWatchesResponse>()

    expect(canceled.status).toBe(200)
    expect(restored.watches).toStrictEqual(first.watches)
    expect(restored.currentViewing?.id).toBe(first.currentViewing?.id)
    expect(restored.contextVersion).toBe(3)

    const retry = await request(rewatchPath, {
      method: 'DELETE',
      body: cancellation
    })

    await expect(retry.json<unknown>()).resolves.toStrictEqual(restored)
  })

  it('bulk marks only released episodes, starts an empty rewatch, and returns current state on late retry', async () => {
    const bulkInput = initialInput()
    const bulkPath = `/api/catalog/items/${catalogItemId}/seasons/1/watched`
    const rewatchPath = `/api/catalog/items/${catalogItemId}/rewatch`
    const firstEpisodeWatchedPath = `/api/catalog/episodes/${firstEpisodeId}/watched`
    const futureEpisodeWatchedPath = `/api/catalog/episodes/${futureEpisodeId}/watched`

    const bulk = await request(bulkPath, {
      method: 'POST',
      body: bulkInput
    })

    expect(bulk.status).toBe(200)

    const first = await bulk.json<CatalogSeriesWatchesResponse>()

    expect(first.watchedEpisodeIds).toStrictEqual([firstEpisodeId])

    const rewatchRequestId = crypto.randomUUID()

    const rewatchInput = {
      requestId: rewatchRequestId,
      currentViewingId: first.currentViewing?.id,
      contextVersion: first.contextVersion,
      timeZone: 'UTC'
    }

    const rewatch = await request(rewatchPath, {
      method: 'POST',
      body: rewatchInput
    })

    expect(rewatch.status).toBe(200)

    const second = await rewatch.json<CatalogSeriesWatchesResponse>()

    expect(second.watches).toStrictEqual([])
    expect(second.contextVersion).toBe(2)
    expect(second.currentViewing?.id).not.toBe(first.currentViewing?.id)

    const bulkReplay = await request(bulkPath, {
      method: 'POST',
      body: bulkInput
    })

    const bulkReplayBody = bulkReplay.json<unknown>()

    await expect(bulkReplayBody).resolves.toStrictEqual(second)

    const lateDeleteInput = {
      currentViewingId: first.currentViewing?.id,
      contextVersion: first.contextVersion,
      watchId: first.watches[0]?.id
    }

    const lateDelete = await request(firstEpisodeWatchedPath, {
      method: 'DELETE',
      body: lateDeleteInput
    })

    expect(lateDelete.status).toBe(409)

    const futureMarkRequestId = crypto.randomUUID()

    const futureMarkInput = {
      requestId: futureMarkRequestId,
      currentViewingId: second.currentViewing?.id,
      contextVersion: second.contextVersion,
      timeZone: 'UTC'
    }

    const markFuture = await request(futureEpisodeWatchedPath, {
      method: 'PUT',
      body: futureMarkInput
    })

    expect(markFuture.status).toBe(200)

    const marked = await markFuture.json<CatalogSeriesWatchesResponse>()

    expect(marked.watchedEpisodeIds).toStrictEqual([futureEpisodeId])
  })
})
