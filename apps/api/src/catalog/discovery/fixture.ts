/* oxlint-disable import/no-relative-parent-imports -- Integration fixtures use the real catalog and authentication boundaries. */
import { env } from 'node:process'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import * as v from 'valibot'
import { strictEqual } from 'node:assert'
import { collectionSchema } from '@tv/shared/catalog-discovery'
import { assertDisposableTestDatabase } from '../../testing/test-database.ts'
import { hashSessionToken } from '../../auth/session.ts'
import { createCatalogApp } from '../routes.ts'

interface RequestOptions {
  method?: string;
  body?: unknown;
  authenticated?: boolean;
}

async function read<Schema extends v.GenericSchema>(response: Response, schema: Schema): Promise<v.InferOutput<Schema>> {
  const raw: unknown = await response.json()

  return v.parse(schema, raw)
}

function discoveryFixture() {
  const connectionString = env.TEST_DATABASE_URL

  if (connectionString === undefined || connectionString === '') { throw new Error('TEST_DATABASE_URL is required') }

  const client = new Client({ connectionString })
  const userId = randomUUID()
  const secondUserId = randomUUID()
  const ids = Array.from({ length: 30 }, () => randomUUID())
  const defaultItemIds = ids.slice(0, 2)
  const token = 'd'.repeat(43)
  const cookie = `__Host-tv_session=${token}`
  const bindings = { DATABASE: { connectionString } }
  const app = createCatalogApp()
  const collectionResponseSchema = v.object({ collection: collectionSchema })

  async function request(path: string, { method = 'GET', body, authenticated = false }: RequestOptions = {}): Promise<Response> {
    const headers = new Headers()
    let payload: string | null = null

    if (authenticated) { headers.set('Cookie', cookie) }

    if (body !== undefined) {
      headers.set('Content-Type', 'application/json')

      if (method !== 'GET') { payload = JSON.stringify(body) }
    }

    const url = `https://tv-api.test/api/catalog/${path}`

    return app.request(url, {
      method,
      body: payload,
      headers
    }, bindings)
  }

  async function clean(): Promise<void> {
    await client.query('DELETE FROM catalog_collections WHERE title LIKE \'Discovery test %\'')
    await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId, secondUserId]])
    await client.query('DELETE FROM catalog_items WHERE id = ANY($1::uuid[])', [ids])
  }

  async function createCollection(itemIds = defaultItemIds) {
    const body = {
      title: 'Discovery test collection',
      description: 'A mixed collection.',
      isFeatured: true,
      itemIds
    }

    const response = await request('manage/collections', {
      method: 'POST',
      body,
      authenticated: true
    })

    strictEqual(response.status, 201)

    const result = await read(response, collectionResponseSchema)

    return result.collection
  }

  async function setup(): Promise<void> {
    await client.connect()
    await assertDisposableTestDatabase(client)
  }

  async function reset(): Promise<void> {
    await clean()
    await client.query('INSERT INTO users (id, email) VALUES ($1, \'discovery-test@example.com\'), ($2, \'discovery-second@example.com\')', [userId, secondUserId])

    const hash = await hashSessionToken(token)

    await client.query('INSERT INTO sessions(user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'1 day\')', [userId, hash])
    await client.query('INSERT INTO user_permissions(user_id, permission) VALUES ($1, \'catalog.manage\')', [userId])

    await client.query(`INSERT INTO catalog_items(id, type, added_at)
      SELECT id, CASE WHEN ordinality % 2 = 0 THEN 'series' ELSE 'movie' END::catalog_item_type,
        '2099-01-01'::timestamptz + ordinality * interval '1 day'
      FROM unnest($1::uuid[]) WITH ORDINALITY AS titles(id, ordinality)`, [ids])

    await client.query(`INSERT INTO catalog_item_titles(catalog_item_id, locale, title, is_original)
      SELECT id, 'en', 'Discovery test title ' || ordinality, true FROM unnest($1::uuid[]) WITH ORDINALITY AS titles(id, ordinality)`, [ids])
  }


  async function cleanup(): Promise<void> {
    try { await clean() } finally { await client.end() }
  }

  return {
    client,
    userId,
    secondUserId,
    ids,
    defaultItemIds,
    request,
    read,
    createCollection,
    setup,
    reset,
    cleanup
  }
}

export { discoveryFixture }
