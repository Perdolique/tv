import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { env } from 'cloudflare:workers'
import { Client } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { hashSessionToken } from '../../../auth/session.ts'
import { smallPosterPng } from '../../../testing/import-fixtures.ts'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'
import { createCatalogApp } from '../../routes.ts'
import { uploadPreparedPoster } from '../hosted-poster.ts'
import { preparePoster } from '../poster.ts'

const USER_ID = '40000000-0000-4000-8000-000000000065'
const PREVIEW_ID = '50000000-0000-4000-8000-000000000065'
const OPERATION_ID = '60000000-0000-4000-8000-000000000065'
const TOKEN = 'i'.repeat(43)
const COOKIE = `__Host-tv_session=${TOKEN}`

const protectedRequests = [
  {
    method: 'GET',
    path: '/api/catalog/imports/access'
  },
  {
    method: 'GET',
    path: '/api/catalog/imports/search?type=movie&query=Test'
  },
  {
    method: 'GET',
    path: '/api/catalog/imports/shows?query=Test'
  },
  {
    method: 'POST',
    path: '/api/catalog/imports/previews'
  },
  {
    method: 'GET',
    path: `/api/catalog/imports/previews/${PREVIEW_ID}`
  },
  {
    method: 'GET',
    path: `/api/catalog/imports/previews/${PREVIEW_ID}/poster`
  },
  {
    method: 'POST',
    path: `/api/catalog/imports/previews/${PREVIEW_ID}/apply`
  },
  {
    method: 'GET',
    path: '/api/catalog/imports/operations'
  },
  {
    method: 'GET',
    path: `/api/catalog/imports/operations/${OPERATION_ID}`
  }
] as const

async function requestImport(app: ReturnType<typeof createCatalogApp>, spec: typeof protectedRequests[number], cookie?: string): Promise<Response> {
  return app.request(`https://tv-api.test${spec.path}`, {
    method: spec.method,
    ...(cookie === undefined ? {} : { headers: { Cookie: cookie } }),

    ...(spec.method === 'POST' ? { body: JSON.stringify({
      type: 'movie',
      tmdbId: 603
    }) } : {})
  }, env)
}

describe('catalog import HTTP access', () => {
  it.each([
    '/api/catalog/imports/previews',
    `/api/catalog/imports/previews/${PREVIEW_ID}/apply`
  ])('bounds JSON request bytes before parsing %s', async (path) => {
    // Arrange
    const client = new Client({ connectionString: env.DATABASE.connectionString })
    const app = createCatalogApp()
    const tokenHash = await hashSessionToken(TOKEN)
    const oversizedValue = 'é'.repeat(8192)
    const oversizedJson = JSON.stringify(oversizedValue)
    const encoder = new TextEncoder()
    const oversizedBytes = encoder.encode(oversizedJson)
    const contentLength = String(oversizedBytes.byteLength)
    const url = `https://tv-api.test${path}`

    const requestHeaders: HeadersInit[] = [
      {
        Cookie: COOKIE,
        'Content-Length': contentLength
      },
      { Cookie: COOKIE },
      {
        Cookie: COOKIE,
        'Transfer-Encoding': 'chunked'
      }
    ]

    await client.connect()

    try {
      await assertDisposableTestDatabase(client)
      await client.query('DELETE FROM users WHERE id = $1', [USER_ID])
      await client.query('INSERT INTO users (id, email) VALUES ($1, $2)', [USER_ID, 'import-routes@example.com'])
      await client.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'1 day\')', [USER_ID, tokenHash])

      const anonymous = await app.request(url, {
        method: 'POST',
        body: oversizedJson
      }, env)

      const denied = await app.request(url, {
        method: 'POST',
        headers: { Cookie: COOKIE },
        body: oversizedJson
      }, env)

      expect(anonymous.status).toBe(401)
      expect(denied.status).toBe(403)
      await client.query('INSERT INTO user_permissions (user_id, permission) VALUES ($1, \'catalog.manage\')', [USER_ID])

      for (const headers of requestHeaders) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            const firstChunk = oversizedBytes.subarray(0, 8192)
            const secondChunk = oversizedBytes.subarray(8192)

            controller.enqueue(firstChunk)
            controller.enqueue(secondChunk)
            controller.close()
          }
        })

        // Act
        // oxlint-disable-next-line eslint/no-await-in-loop -- Each transfer mode must exercise the same authorized HTTP boundary.
        const response = await app.request(url, {
          method: 'POST',
          headers,
          body
        }, env)

        // Assert
        expect.soft(response.status).toBe(413)
        expect(response.headers.get('cache-control')).toBe('no-store')

        // oxlint-disable-next-line eslint/no-await-in-loop -- The response is consumed before testing the next transfer mode.
        await expect(response.json()).resolves.toStrictEqual({
          error: {
            code: 'INVALID_REQUEST',
            message: 'The request is invalid.'
          }
        })
      }

      const boundaryValue = 'é'.repeat(8191)
      const boundaryBody = JSON.stringify(boundaryValue)

      const boundaryResponse = await app.request(url, {
        method: 'POST',
        headers: { Cookie: COOKIE },
        body: boundaryBody
      }, env)

      expect(boundaryResponse.status).toBe(400)
    } finally {
      await client.query('DELETE FROM users WHERE id = $1', [USER_ID])
      await client.end()
    }
  })

  it('returns 401 or 403 on every protected handler and checks a revoked grant again', async () => {
    const client = new Client({ connectionString: env.DATABASE.connectionString })
    const app = createCatalogApp()

    await client.connect()

    try {
      await assertDisposableTestDatabase(client)
      await client.query('DELETE FROM users WHERE id = $1', [USER_ID])
      await client.query('INSERT INTO users (id, email) VALUES ($1, $2)', [USER_ID, 'import-routes@example.com'])
      await client.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'1 day\')', [USER_ID, await hashSessionToken(TOKEN)])

      const navigationUrl = 'https://tv-api.test/api/catalog/imports/navigation'
      const anonymousNavigation = await app.request(navigationUrl, {}, env)

      expect(anonymousNavigation.status).toBe(200)
      expect(anonymousNavigation.headers.get('cache-control')).toBe('no-store')
      await expect(anonymousNavigation.json()).resolves.toStrictEqual({ allowed: false })

      const deniedNavigation = await app.request(navigationUrl, { headers: { Cookie: COOKIE } }, env)

      expect(deniedNavigation.status).toBe(200)
      await expect(deniedNavigation.json()).resolves.toStrictEqual({ allowed: false })

      for (const spec of protectedRequests) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Each handler is checked in sequence against the same disposable session.
        const anonymous = await requestImport(app, spec)

        expect(anonymous.status).toBe(401)
        expect(anonymous.headers.get('cache-control')).toBe('no-store')

        // oxlint-disable-next-line eslint/no-await-in-loop -- Each handler is checked in sequence against the same disposable session.
        const denied = await requestImport(app, spec, COOKIE)

        expect(denied.status).toBe(403)
        expect(denied.headers.get('cache-control')).toBe('no-store')
      }

      await client.query('INSERT INTO user_permissions (user_id, permission) VALUES ($1, \'catalog.manage\')', [USER_ID])

      const allowed = await requestImport(app, protectedRequests[0], COOKIE)

      expect(allowed.status).toBe(200)

      const allowedNavigation = await app.request(navigationUrl, { headers: { Cookie: COOKIE } }, env)

      await expect(allowedNavigation.json()).resolves.toStrictEqual({ allowed: true })
      await client.query('DELETE FROM user_permissions WHERE user_id = $1 AND permission = \'catalog.manage\'', [USER_ID])

      const revokedNavigation = await app.request(navigationUrl, { headers: { Cookie: COOKIE } }, env)

      await expect(revokedNavigation.json()).resolves.toStrictEqual({ allowed: false })

      for (const spec of protectedRequests) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- A second pass proves each handler sees the revoked grant.
        const revoked = await requestImport(app, spec, COOKIE)

        expect(revoked.status).toBe(403)
      }

      await client.query('UPDATE sessions SET expires_at = now() - interval \'1 day\' WHERE user_id = $1', [USER_ID])

      const expiredNavigation = await app.request(navigationUrl, { headers: { Cookie: COOKIE } }, env)

      expect(expiredNavigation.status).toBe(200)
      expect(expiredNavigation.headers.get('cache-control')).toBe('no-store')
      await expect(expiredNavigation.json()).resolves.toStrictEqual({ allowed: false })
    } finally {
      await client.query('DELETE FROM users WHERE id = $1', [USER_ID])
      await client.end()
    }
  })

  it('serves only hosted WebP posters in this environment under an immutable public URL', async () => {
    const app = createCatalogApp()
    const source = Buffer.from(smallPosterPng, 'base64')

    const prepared = await preparePoster('/test.png', env.IMAGES, {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(source))
    })

    const namespace = new URL(env.WEB_ORIGIN).hostname.replaceAll('.', '-')

    const selection = {
      type: 'movie',
      tmdbId: Number.parseInt(randomUUID().replaceAll('-', '').slice(0, 8), 16)
    } as const

    const uploaded = await uploadPreparedPoster({
      hosted: env.IMAGES.hosted,
      namespace,
      selection,
      poster: prepared.metadata,
      bytes: prepared.bytes
    })

    try {
      const response = await app.request(`https://tv-api.test${uploaded.path}`, {}, env)

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('image/webp')
      expect(response.headers.get('cache-control')).toContain('immutable')
      expect(Buffer.from(await response.arrayBuffer())).toStrictEqual(prepared.bytes)

      const foreign = await app.request(`https://tv-api.test${uploaded.path.replace(namespace, 'another-environment')}`, {}, env)

      expect(foreign.status).toBe(404)

      const malformed = await app.request('https://tv-api.test/api/posters/traversal.webp', {}, env)

      expect(malformed.status).toBe(404)
    } finally {
      await env.IMAGES.hosted.image(uploaded.id).delete()
    }
  })
})
