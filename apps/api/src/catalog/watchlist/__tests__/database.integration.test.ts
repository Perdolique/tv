import { env } from 'node:process'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { afterAll, assert, describe, expect, it } from 'vitest'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'
import { findCatalogWatchlistRows, followCatalogItem, unfollowCatalogItem } from '../../repository.ts'
import { createCatalogWatchlistItems } from '../../watchlist.ts'

const databaseUrl = env.TEST_DATABASE_URL

if (databaseUrl === undefined || databaseUrl === '') {
  throw new Error('TEST_DATABASE_URL is required for database integration tests')
}

const client = new Client({ connectionString: databaseUrl })

await client.connect()

async function findCatalogItemId(title: string): Promise<string> {
  const result = await client.query<{ id: string }>(`
    SELECT id FROM catalog_items JOIN catalog_item_titles ON catalog_item_id = id
    WHERE title = $1 AND is_original
  `, [title])

  const id = result.rows[0]?.id

  assert(id !== undefined, `${title} is missing from the seeded catalog`)

  return id
}

describe('postgreSQL catalog watchlist', () => {
  afterAll(async () => {
    await client.end()
  })

  it('returns one localized item per follow for the current account, newest first', async () => {
    await assertDisposableTestDatabase(client)

    const firstUserId = '50000000-0000-4000-8000-000000000001'
    const secondUserId = '50000000-0000-4000-8000-000000000002'
    const database = createDatabase(client)
    const deadManId = await findCatalogItemId('Dead Man')
    const duneId = await findCatalogItemId('Dune')
    const wireId = await findCatalogItemId('The Wire')
    const tiedIds = [duneId, wireId].toSorted()

    try {
      await client.query(`
        INSERT INTO users (id, email)
        VALUES ($1, 'first-watchlist@example.com'), ($2, 'second-watchlist@example.com')
      `, [firstUserId, secondUserId])

      await client.query(`
        INSERT INTO catalog_item_follows (user_id, catalog_item_id, followed_at)
        VALUES
          ($1, $2, '2026-09-09T12:00:00Z'),
          ($1, $4, '2026-09-10T12:00:00Z'),
          ($1, $3, '2026-09-10T12:00:00Z'),
          ($5, $2, '2026-09-11T12:00:00Z')
      `, [firstUserId, deadManId, duneId, wireId, secondUserId])

      const rows = await findCatalogWatchlistRows(database, firstUserId)
      const items = createCatalogWatchlistItems(rows, 'ru-RU')

      expect(items.map(item => item.id)).toStrictEqual([
        ...tiedIds,
        deadManId
      ])

      expect(items).toHaveLength(3)

      expect(items.find(item => item.id === deadManId)).toMatchObject({
        posterUrl: '/posters/dead-man-1995.webp',
        title: 'Мертвец',
        titleLocale: 'ru'
      })

      await unfollowCatalogItem(database, firstUserId, deadManId)
      await expect(followCatalogItem(database, firstUserId, deadManId)).resolves.toBe(true)

      const refreshedRows = await findCatalogWatchlistRows(database, firstUserId)
      const refreshedItems = createCatalogWatchlistItems(refreshedRows, 'en')

      expect(refreshedItems[0]?.id).toBe(deadManId)
      expect(refreshedItems).toHaveLength(3)
    } finally {
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[firstUserId, secondUserId]])
    }
  })
})
