import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { env } from 'cloudflare:workers'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { assert, describe, expect, it, vi } from 'vitest'
import * as v from 'valibot'
import { hashSessionToken } from '../../../auth/session.ts'
import { smallPosterPng, movieResponse } from '../../../testing/import-fixtures.ts'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'
import { createCatalogApp } from '../../routes.ts'
import { createImportPreview } from '../service.ts'

const targetResponseSchema = v.object({
  preview: v.object({
    id: v.pipe(v.string(), v.uuid()),
    status: v.literal('ready'),
    expiresAt: v.string(),
    posterUrl: v.string(),

    data: v.object({
      version: v.literal(3),
      candidates: v.array(v.object({ id: v.string() })),

      target: v.object({
        kind: v.literal('existing'),
        catalogItemId: v.string()
      }),

      additions: v.object({
        createItem: v.literal(false),
        catalogItemId: v.string()
      })
    })
  })
})

describe('saved target HTTP contract', () => {
  it('returns a new owner-checked review and serves the same saved WebP bytes', async () => {
    const client = new Client({ connectionString: env.DATABASE.connectionString })
    const database = createDatabase(client)

    const user = {
      id: randomUUID(),
      email: 'target-http@example.com'
    }

    const catalogItemId = randomUUID()
    const token = 't'.repeat(43)
    const tokenHash = await hashSessionToken(token)
    const app = createCatalogApp()

    const source = {
      ...movieResponse(),
      poster_path: '/test.png'
    }

    const image = Buffer.from(smallPosterPng, 'base64')
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(source)).mockResolvedValueOnce(new Response(image))

    await client.connect()

    try {
      await assertDisposableTestDatabase(client)
      await client.query('INSERT INTO users (id, email) VALUES ($1, $2)', [user.id, user.email])
      await client.query('INSERT INTO user_permissions (user_id, permission) VALUES ($1, \'catalog.manage\')', [user.id])
      await client.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'1 day\')', [user.id, tokenHash])
      await client.query('INSERT INTO catalog_items (id, type) VALUES ($1, \'movie\')', [catalogItemId])
      await client.query('INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original) VALUES ($1, \'ja\', $2, true)', [catalogItemId, source.original_title])

      const original = await createImportPreview({
        database,
        user
      }, {
        type: 'movie',
        tmdbId: 603
      }, {
        token: 'test',
        images: env.IMAGES,
        fetch: fetcher
      })

      assert(original.status === 'blocked')

      const response = await app.request(`https://tv-api.test/api/catalog/imports/previews/${original.preview.id}/target`, {
        method: 'POST',

        headers: {
          Cookie: `__Host-tv_session=${token}`,
          'Content-Type': 'application/json'
        },

        body: JSON.stringify({
          kind: 'existing',
          catalogItemId
        })
      }, env)

      const raw: unknown = await response.json()
      const body = v.parse(targetResponseSchema, raw)

      expect(response.status).toBe(201)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(body.preview.id).not.toBe(original.preview.id)
      expect(body.preview.data.target.catalogItemId).toBe(catalogItemId)
      expect(body.preview.data.additions.catalogItemId).toBe(catalogItemId)
      expect(body.preview.data.candidates).toStrictEqual([{ id: catalogItemId }])
      expect(body.preview.expiresAt).toBe(original.preview.expiresAt.toISOString())
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(JSON.stringify(raw)).not.toContain('posterBytes')

      const poster = await app.request(`https://tv-api.test${body.preview.posterUrl}`, { headers: { Cookie: `__Host-tv_session=${token}` } }, env)
      const bytes = await poster.arrayBuffer()

      expect(poster.status).toBe(200)
      expect(poster.headers.get('cache-control')).toBe('no-store')
      expect(Buffer.from(bytes)).toStrictEqual(original.preview.posterBytes)

      const links = await client.query('SELECT * FROM catalog_external_links WHERE catalog_item_id = $1', [catalogItemId])

      expect(links.rows).toStrictEqual([])
    } finally {
      await client.query('DELETE FROM catalog_items WHERE id = $1', [catalogItemId])
      await client.query('DELETE FROM users WHERE id = $1', [user.id])
      await client.end()
    }
  })
})
