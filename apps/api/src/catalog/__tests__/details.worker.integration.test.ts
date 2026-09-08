import { env, exports } from 'cloudflare:workers'
import { Client } from 'pg'
import type { CatalogDetailsResponse } from '@tv/shared/catalog'
import { afterEach, assert, describe, expect, it, vi } from 'vitest'
import { assertDisposableTestDatabase } from '../../testing/test-database.ts'

async function withClient(run: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client({ connectionString: env.DATABASE.connectionString })

  try {
    await client.connect()
    await assertDisposableTestDatabase(client)
    await run(client)
  } finally {
    await client.end()
  }
}

async function findDeadManId(client: Client): Promise<string> {
  const result = await client.query<{ id: string }>(`
    SELECT id FROM catalog_items JOIN catalog_item_titles ON catalog_item_id = id
    WHERE title = 'Dead Man' AND is_original
  `)

  const id = result.rows[0]?.id

  if (id === undefined) {
    throw new Error('Dead Man is missing from the seeded catalog')
  }

  return id
}

async function request(path: string, cookie?: string): Promise<Response> {
  const headers = new Headers()

  if (cookie !== undefined) {
    headers.set('Cookie', cookie)
  }

  const url = `https://tv-api.test${path}`
  const input = new Request(url, { headers })

  return exports.default.fetch(input)
}

describe('public catalog details Worker contract', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('serves the same details without a cookie and with an invalid cookie while keeping search protected', async () => {
    await withClient(async (client) => {
      const id = await findDeadManId(client)
      const path = `/api/catalog/items/${id}`
      const anonymous = await request(path)
      const malformed = await request(path, '__Host-tv_session=malformed')

      expect(anonymous.status).toBe(200)
      expect(malformed.status).toBe(200)
      expect(anonymous.headers.get('cache-control')).toBe('no-store')
      expect(malformed.headers.get('set-cookie')).toBeNull()

      const body: unknown = await anonymous.json()

      expect(body).toMatchObject({ item: {
        id,
        title: 'Dead Man',
        titleLocale: 'en',
        originalTitle: 'Dead Man',
        originalTitleLocale: 'en',
        type: 'movie',
        releaseYear: 1995,
        descriptionLocale: 'en',
        posterUrl: '/posters/dead-man-1995.webp'
      } })

      await expect(malformed.json()).resolves.toStrictEqual(body)

      const search = await request('/api/catalog/search?query=dead')

      expect(search.status).toBe(401)
    })
  })

  it('serves Russian descriptions and never queries the account tables', async () => {
    await withClient(async (client) => {
      const id = await findDeadManId(client)

      await client.query('ALTER TABLE sessions RENAME TO sessions_unavailable')

      try {
        const cookie = `__Host-tv_session=${'a'.repeat(43)}`
        const response = await request(`/api/catalog/items/${id}?titleLocale=ru-RU`, cookie)

        expect(response.status).toBe(200)

        const body = await response.json<CatalogDetailsResponse>()

        expect(body.item).toMatchObject({
          title: 'Мертвец',
          titleLocale: 'ru',
          descriptionLocale: 'ru'
        })

        expect(body.item.description).toContain('Уильям Блейк')
      } finally {
        await client.query('ALTER TABLE sessions_unavailable RENAME TO sessions')
      }
    })
  })

  it('returns structured validation and not-found errors', async () => {
    const invalid = await request('/api/catalog/items/not-a-uuid')
    const missing = await request('/api/catalog/items/01991a00-0000-7000-8000-999999999999')
    const invalidLocale = await request('/api/catalog/items/01991a00-0000-7000-8000-999999999999?titleLocale=bad_locale')

    expect(invalid.status).toBe(400)
    expect(invalidLocale.status).toBe(400)
    expect(missing.status).toBe(404)

    await expect(invalid.json()).resolves.toMatchObject({ error: {
      code: 'INVALID_REQUEST',
      fields: { id: 'Use a valid catalog item UUID.' }
    } })

    await expect(missing.json()).resolves.toStrictEqual({ error: {
      code: 'NOT_FOUND',
      message: 'This title could not be found.'
    } })

    expect(missing.headers.get('cache-control')).toBe('no-store')
  })

  it('loads an item with no description, poster or release year', async () => {
    await withClient(async (client) => {
      const inserted = await client.query<{ id: string }>('INSERT INTO catalog_items (type) VALUES (\'movie\') RETURNING id')
      const id = inserted.rows[0]?.id

      assert(id !== undefined, 'Optional metadata fixture was not inserted')

      try {
        await client.query('INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original) VALUES ($1, \'fr\', \'Titre original\', true)', [id])

        const response = await request(`/api/catalog/items/${id}?titleLocale=ru`)

        expect(response.status).toBe(200)

        await expect(response.json()).resolves.toStrictEqual({ item: {
          id,
          title: 'Titre original',
          titleLocale: 'fr',
          originalTitle: 'Titre original',
          originalTitleLocale: 'fr',
          type: 'movie',
          releaseYear: null,
          description: null,
          descriptionLocale: null,
          posterUrl: null
        } })
      } finally {
        await client.query('DELETE FROM catalog_items WHERE id = $1', [id])
      }
    })
  })

  it('keeps raw database failures in telemetry and returns a safe recoverable error', async () => {
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {
      // Expected failure is inspected below.
    })

    await withClient(async (client) => {
      const id = await findDeadManId(client)

      await client.query('ALTER TABLE catalog_item_titles RENAME TO catalog_item_titles_unavailable')

      try {
        const response = await request(`/api/catalog/items/${id}`)

        expect(response.status).toBe(503)

        await expect(response.json()).resolves.toStrictEqual({ error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'The catalog is temporarily unavailable.'
        } })

        const serialized = JSON.stringify(logs.mock.calls)

        expect(serialized).toContain('catalog_item_titles')
        expect(serialized).toContain('requestId')
        expect(serialized).toContain('does not exist')
      } finally {
        await client.query('ALTER TABLE catalog_item_titles_unavailable RENAME TO catalog_item_titles')
      }
    })
  })
})
