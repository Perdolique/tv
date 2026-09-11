import { env } from 'node:process'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { afterAll, assert, describe, expect, it } from 'vitest'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'
import { findCatalogItemFollowed, followCatalogItem, unfollowCatalogItem } from '../../repository.ts'

const databaseUrl = env.TEST_DATABASE_URL

if (databaseUrl === undefined || databaseUrl === '') {
  throw new Error('TEST_DATABASE_URL is required for database integration tests')
}

const client = new Client({ connectionString: databaseUrl })

await client.connect()

describe('postgreSQL catalog follows', () => {
  afterAll(async () => {
    await client.end()
  })

  it('keeps repeated follows idempotent and isolated by account', async () => {
    await assertDisposableTestDatabase(client)

    const firstUserId = '30000000-0000-4000-8000-000000000005'
    const secondUserId = '30000000-0000-4000-8000-000000000006'
    const database = createDatabase(client)

    try {
      const seeded = await client.query<{ id: string }>(`
        SELECT id FROM catalog_items JOIN catalog_item_titles ON catalog_item_id = id
        WHERE title = 'Dead Man' AND is_original
      `)

      const catalogItemId = seeded.rows[0]?.id

      assert(catalogItemId !== undefined, 'Dead Man is missing from the seeded catalog')

      await client.query(`
        INSERT INTO users (id, email)
        VALUES ($1, 'first-follow@example.com'), ($2, 'second-follow@example.com')
      `, [firstUserId, secondUserId])

      await expect(findCatalogItemFollowed(database, firstUserId, catalogItemId)).resolves.toBe(false)
      await expect(findCatalogItemFollowed(database, secondUserId, catalogItemId)).resolves.toBe(false)
      await expect(followCatalogItem(database, firstUserId, catalogItemId)).resolves.toBe(true)
      await expect(followCatalogItem(database, secondUserId, catalogItemId)).resolves.toBe(true)

      const firstFollow = await client.query<{ followed_at: Date }>(`
        SELECT followed_at FROM catalog_item_follows
        WHERE user_id = $1 AND catalog_item_id = $2
      `, [firstUserId, catalogItemId])

      await client.query('SELECT pg_sleep(0.01)')
      await expect(followCatalogItem(database, firstUserId, catalogItemId)).resolves.toBe(true)

      const repeatedFollow = await client.query<{ followed_at: Date }>(`
        SELECT followed_at FROM catalog_item_follows
        WHERE user_id = $1 AND catalog_item_id = $2
      `, [firstUserId, catalogItemId])

      expect(repeatedFollow.rows).toHaveLength(1)
      expect(repeatedFollow.rows[0]?.followed_at).toStrictEqual(firstFollow.rows[0]?.followed_at)

      await expect(client.query(`
        INSERT INTO catalog_item_follows (user_id, catalog_item_id)
        VALUES ($1, $2)
      `, [firstUserId, catalogItemId])).rejects.toMatchObject({ code: '23505' })

      await unfollowCatalogItem(database, firstUserId, catalogItemId)
      await expect(findCatalogItemFollowed(database, firstUserId, catalogItemId)).resolves.toBe(false)
      await expect(findCatalogItemFollowed(database, secondUserId, catalogItemId)).resolves.toBe(true)
      await client.query('SELECT pg_sleep(0.01)')
      await expect(followCatalogItem(database, firstUserId, catalogItemId)).resolves.toBe(true)

      const renewedFollow = await client.query<{ followed_at: Date }>(`
        SELECT followed_at FROM catalog_item_follows
        WHERE user_id = $1 AND catalog_item_id = $2
      `, [firstUserId, catalogItemId])

      const firstTimestamp = firstFollow.rows[0]?.followed_at
      const renewedTimestamp = renewedFollow.rows[0]?.followed_at

      assert(firstTimestamp !== undefined, 'The initial follow timestamp is missing')
      assert(renewedTimestamp !== undefined, 'The renewed follow timestamp is missing')
      expect(renewedTimestamp.getTime()).toBeGreaterThan(firstTimestamp.getTime())
    } finally {
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[firstUserId, secondUserId]])
    }
  })

  it('cascades follows when either parent is deleted', async () => {
    await assertDisposableTestDatabase(client)

    const itemFollowUserId = '30000000-0000-4000-8000-000000000005'
    const userFollowUserId = '30000000-0000-4000-8000-000000000006'
    const disposableItemId = '30000000-0000-4000-8000-000000000007'
    const database = createDatabase(client)

    try {
      const seeded = await client.query<{ id: string }>(`
        SELECT id FROM catalog_items JOIN catalog_item_titles ON catalog_item_id = id
        WHERE title = 'Dead Man' AND is_original
      `)

      const catalogItemId = seeded.rows[0]?.id

      assert(catalogItemId !== undefined, 'Dead Man is missing from the seeded catalog')

      await client.query(`
        INSERT INTO users (id, email)
        VALUES ($1, 'item-cascade@example.com'), ($2, 'user-cascade@example.com')
      `, [itemFollowUserId, userFollowUserId])

      await client.query(`
        INSERT INTO catalog_items (id, type)
        VALUES ($1, 'movie')
      `, [disposableItemId])

      await client.query(`
        INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original)
        VALUES ($1, 'en', 'Follow cascade fixture', true)
      `, [disposableItemId])

      await expect(followCatalogItem(database, itemFollowUserId, disposableItemId)).resolves.toBe(true)
      await expect(followCatalogItem(database, userFollowUserId, catalogItemId)).resolves.toBe(true)
      await client.query('DELETE FROM catalog_items WHERE id = $1', [disposableItemId])

      const itemCascade = await client.query<{ count: string }>(`
        SELECT count(*) FROM catalog_item_follows WHERE catalog_item_id = $1
      `, [disposableItemId])

      expect(itemCascade.rows[0]?.count).toBe('0')
      await client.query('DELETE FROM users WHERE id = $1', [userFollowUserId])

      const userCascade = await client.query<{ count: string }>(`
        SELECT count(*) FROM catalog_item_follows WHERE user_id = $1
      `, [userFollowUserId])

      expect(userCascade.rows[0]?.count).toBe('0')
    } finally {
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[itemFollowUserId, userFollowUserId]])
      await client.query('DELETE FROM catalog_items WHERE id = $1', [disposableItemId])
    }
  })

  it('does not follow catalog items without title metadata', async () => {
    await assertDisposableTestDatabase(client)

    const userId = '30000000-0000-4000-8000-000000000005'
    const catalogItemId = '30000000-0000-4000-8000-000000000007'
    const database = createDatabase(client)

    try {
      await client.query(`
        INSERT INTO users (id, email)
        VALUES ($1, 'missing-title-metadata@example.com')
      `, [userId])

      await client.query(`
        INSERT INTO catalog_items (id, type)
        VALUES ($1, 'movie')
      `, [catalogItemId])

      await expect(findCatalogItemFollowed(database, userId, catalogItemId)).resolves.toBeNull()
      await expect(followCatalogItem(database, userId, catalogItemId)).resolves.toBe(false)

      const follows = await client.query<{ count: string }>(`
        SELECT count(*) FROM catalog_item_follows
        WHERE user_id = $1 AND catalog_item_id = $2
      `, [userId, catalogItemId])

      expect(follows.rows[0]?.count).toBe('0')
    } finally {
      await client.query('DELETE FROM users WHERE id = $1', [userId])
      await client.query('DELETE FROM catalog_items WHERE id = $1', [catalogItemId])
    }
  })

  it('serializes follow creation with concurrent title deletion', async () => {
    await assertDisposableTestDatabase(client)

    const userId = '30000000-0000-4000-8000-000000000008'
    const catalogItemId = '30000000-0000-4000-8000-000000000009'
    const advisoryLockId = 370_037
    const deletionClient = new Client({ connectionString: databaseUrl })
    const database = createDatabase(client)

    try {
      await deletionClient.connect()

      await client.query(`
        INSERT INTO users (id, email)
        VALUES ($1, 'concurrent-follow@example.com')
      `, [userId])

      await client.query(`
        INSERT INTO catalog_items (id, type)
        VALUES ($1, 'movie')
      `, [catalogItemId])

      await client.query(`
        INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original)
        VALUES ($1, 'en', 'Concurrent follow fixture', true)
      `, [catalogItemId])

      await client.query(`
        CREATE FUNCTION delay_catalog_follow_insert() RETURNS trigger AS $$
        BEGIN
          PERFORM pg_advisory_xact_lock(0, ${advisoryLockId});
          PERFORM pg_sleep(0.5);
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `)

      await client.query(`
        CREATE TRIGGER delay_catalog_follow_insert
        BEFORE INSERT ON catalog_item_follows
        FOR EACH ROW EXECUTE FUNCTION delay_catalog_follow_insert()
      `)

      const follow = followCatalogItem(database, userId, catalogItemId)

      await expect.poll(async () => {
        const locks = await deletionClient.query<{ locked: boolean }>(`
          SELECT EXISTS (
            SELECT FROM pg_locks
            WHERE locktype = 'advisory'
              AND classid = 0
              AND objid = $1
              AND granted
          ) AS locked
        `, [advisoryLockId])

        return locks.rows[0]?.locked
      }).toBe(true)

      const deletion = deletionClient.query(
        'DELETE FROM catalog_items WHERE id = $1',
        [catalogItemId]
      )

      await expect(follow).resolves.toBe(true)

      await deletion

      const follows = await client.query<{ count: string }>(`
        SELECT count(*) FROM catalog_item_follows
        WHERE user_id = $1 AND catalog_item_id = $2
      `, [userId, catalogItemId])

      expect(follows.rows[0]?.count).toBe('0')
    } finally {
      await deletionClient.end()
      await client.query('DROP TRIGGER IF EXISTS delay_catalog_follow_insert ON catalog_item_follows')
      await client.query('DROP FUNCTION IF EXISTS delay_catalog_follow_insert()')
      await client.query('DELETE FROM users WHERE id = $1', [userId])
      await client.query('DELETE FROM catalog_items WHERE id = $1', [catalogItemId])
    }
  })
})
