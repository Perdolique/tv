import { randomUUID } from 'node:crypto'
import { env } from 'node:process'
import { createDatabase } from '@tv/database'
import { collectionPageSchema, type CatalogCollection } from '@tv/shared/catalog-discovery'
import * as v from 'valibot'
import { Client, type QueryConfig, type QueryResult } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { hashSessionToken } from '../../../auth/session.ts'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'
import { saveCollection } from '../../collections-repository.ts'
import { createCatalogApp } from '../../routes.ts'

const connectionString = env.TEST_DATABASE_URL

if (connectionString === undefined || connectionString === '') { throw new Error('TEST_DATABASE_URL is required') }

const client = new Client({ connectionString })
const database = createDatabase(client)
const userId = randomUUID()
const ids = Array.from({ length: 4 }, () => randomUUID())
const token = 's'.repeat(43)
const cookie = `__Host-tv_session=${token}`
const bindings = { DATABASE: { connectionString } }
const app = createCatalogApp()

// Drizzle uses node-postgres's promise overload; callback and stream overloads are not intercepted.
interface PromiseQueryClient {
  query: (queryConfig: string | QueryConfig, values?: unknown[]) => Promise<QueryResult>;
}

interface SnapshotCase {
  surface: 'collection' | 'editor' | 'home' | 'related' | 'recent';
  table: string;
}

async function clean(): Promise<void> {
  await client.query('DELETE FROM catalog_collections WHERE title LIKE \'Snapshot test %\'')
  await client.query('DELETE FROM users WHERE id = $1', [userId])
  await client.query('DELETE FROM catalog_items WHERE id = ANY($1::uuid[])', [ids])
}

function publishAfterFirstRead(reader: Client, collection: CatalogCollection, table: string): () => boolean {
  const queryClient: PromiseQueryClient = reader
  const query = queryClient.query.bind(reader)
  let published = false

  queryClient.query = async (queryConfig, values) => {
    const result = await query(queryConfig, values)
    const statement = typeof queryConfig === 'string' ? queryConfig : queryConfig.text
    const tableRead = `from "${table}"`
    const readsSnapshot = statement.startsWith('select ') && statement.includes(tableRead)

    if (!published && readsSnapshot) {
      published = true

      const originalIds = ids.slice(0, 2)
      const itemIds = originalIds.toReversed()

      await saveCollection(database, {
        title: 'Snapshot test republished',
        description: 'A new published version.',
        isFeatured: true,
        revision: collection.revision,
        itemIds
      }, collection.id)

      await client.query(`UPDATE catalog_item_titles SET title = title || ' changed'
        WHERE catalog_item_id = ANY($1::uuid[])`, [ids])
    }

    return result
  }

  return () => published
}

const cases: SnapshotCase[] = [
  {
    surface: 'collection',
    table: 'catalog_collections'
  },
  {
    surface: 'editor',
    table: 'catalog_collections'
  },
  {
    surface: 'home',
    table: 'catalog_collections'
  },
  {
    surface: 'related',
    table: 'catalog_collections'
  },
  {
    surface: 'recent',
    table: 'catalog_items'
  }
]

describe('catalog collection transactions and read snapshots', () => {
  beforeAll(async () => {
    await client.connect()
    await assertDisposableTestDatabase(client)
  })

  beforeEach(async () => {
    await clean()
    await client.query('INSERT INTO users (id, email) VALUES ($1, \'snapshot-test@example.com\')', [userId])

    const hash = await hashSessionToken(token)

    await client.query('INSERT INTO sessions(user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'1 day\')', [userId, hash])
    await client.query('INSERT INTO user_permissions(user_id, permission) VALUES ($1, \'catalog.manage\')', [userId])

    await client.query(`INSERT INTO catalog_items(id, type, added_at)
      SELECT unnest($1::uuid[]), 'movie', '2099-01-01'`, [ids])

    await client.query(`INSERT INTO catalog_item_titles(catalog_item_id, locale, title, is_original)
      SELECT unnest($1::uuid[]), 'en', 'Snapshot test title', true`, [ids])
  })

  afterAll(async () => {
    try { await clean() } finally { await client.end() }
  })

  it('rolls back metadata, revision and deleted members when the replacement insert fails', async () => {
    // Arrange
    const itemIds = ids.slice(0, 2)

    const collection = await saveCollection(database, {
      title: 'Snapshot test collection',
      description: 'The original version.',
      isFeatured: true,
      itemIds
    })

    const replacementIds = ids.slice(2, 4)

    await client.query(`CREATE FUNCTION pg_temp.fail_discovery_membership() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM catalog_collections
          WHERE id = NEW.collection_id AND revision = 2 AND description = 'Must roll back'
        ) OR EXISTS (
          SELECT 1 FROM catalog_collection_items WHERE collection_id = NEW.collection_id
        ) THEN
          RAISE EXCEPTION 'Failure fixture did not reach the replacement insert';
        END IF;
        RAISE EXCEPTION 'Forced membership insert failure' USING ERRCODE = '23514';
      END
    $$`)

    await client.query(`CREATE TRIGGER discovery_membership_failure BEFORE INSERT ON catalog_collection_items
      FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_discovery_membership()`)

    try {
      // Act
      const save = saveCollection(database, {
        title: 'Snapshot test replacement',
        description: 'Must roll back',
        isFeatured: false,
        revision: collection.revision,
        itemIds: replacementIds
      }, collection.id)

      // Assert
      await expect(save).rejects.toMatchObject({
        cause: {
          code: '23514',
          message: 'Forced membership insert failure'
        }
      })
    } finally {
      await client.query('DROP TRIGGER discovery_membership_failure ON catalog_collection_items')
      await client.query('DROP FUNCTION pg_temp.fail_discovery_membership()')
    }

    const url = `https://tv-api.test/api/catalog/collections/${collection.id}`
    const unchangedResponse = await app.request(url, {}, bindings)
    const raw: unknown = await unchangedResponse.json()
    const unchanged = v.parse(collectionPageSchema, raw)
    const unchangedIds = unchanged.items.map(item => item.id)
    const originalIds = ids.slice(0, 2)

    expect(unchanged.collection).toStrictEqual(collection)
    expect(unchangedIds).toStrictEqual(originalIds)
  })

  it.each(cases)('keeps the $surface response in one snapshot across a concurrent publication', async ({ surface, table }) => {
    // Arrange
    const itemIds = ids.slice(0, 2)

    const collection = await saveCollection(database, {
      title: 'Snapshot test collection',
      description: 'The original version.',
      isFeatured: true,
      itemIds
    })

    const paths = {
      collection: `collections/${collection.id}`,
      editor: `manage/collections/${collection.id}`,
      home: 'discovery',
      related: `items/${ids[0]}/collections`,
      recent: 'discovery/recent'
    }

    const path = paths[surface]
    const url = `https://tv-api.test/api/catalog/${path}`
    const headers = new Headers({ Cookie: cookie })
    const options = { headers }
    const beforeResponse = await app.request(url, options, bindings)
    const before: unknown = await beforeResponse.json()
    const reader = new Client({ connectionString })
    const readerDatabase = createDatabase(reader)

    await reader.connect()

    const wasPublished = publishAfterFirstRead(reader, collection, table)

    const adapter = {
      client: reader,
      database: readerDatabase
    }

    const snapshotApp = createCatalogApp({
      // oxlint-disable-next-line typescript/require-await -- The dependency contract is async; this connected adapter is ready.
      connectDatabase: async () => adapter
    })

    try {
      // Act
      const snapshotResponse = await snapshotApp.request(url, options, bindings)
      const snapshot: unknown = await snapshotResponse.json()
      const published = wasPublished()

      // Assert
      expect(snapshotResponse.status).toBe(200)
      expect(published).toBe(true)
      expect(snapshot).toStrictEqual(before)
    } finally {
      await reader.end()
    }

    const currentResponse = await app.request(url, options, bindings)
    const current: unknown = await currentResponse.json()

    expect(currentResponse.status).toBe(200)
    expect(current).not.toStrictEqual(before)
  })
})
