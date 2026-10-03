import { env } from 'node:process'
import { randomUUID } from 'node:crypto'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'
import { findCatalogItemRating, setCatalogItemRating } from '../../ratings-repository.ts'

const databaseUrl = env.TEST_DATABASE_URL
const client = new Client({ connectionString: databaseUrl })
const userId = randomUUID()
const otherUserId = randomUUID()

await client.connect()

async function itemId(title: string): Promise<string> {
  const result = await client.query<{ id: string }>(`
    SELECT catalog_item_id AS id FROM catalog_item_titles WHERE title = $1 AND is_original
  `, [title])

  const id = result.rows[0]?.id

  if (id === undefined) { throw new Error(`Missing seeded title: ${title}`) }

  return id
}

async function readRating(catalogItemId: string) {
  const result = await client.query<{ id: string; score: number }>(`
    SELECT id, score FROM catalog_item_ratings WHERE user_id = $1 AND catalog_item_id = $2
  `, [userId, catalogItemId])

  return result.rows
}

async function concurrentWrite(catalogItemId: string, score: number | null): Promise<boolean> {
  const connection = new Client({
    connectionString: databaseUrl,
    application_name: 'rating-concurrent-save'
  })

  try {
    await connection.connect()

    const database = createDatabase(connection)

    return await setCatalogItemRating(database, userId, {
      catalogItemId,
      score
    })
  } finally {
    await connection.end()
  }
}

describe('catalog rating persistence', () => {
  beforeAll(async () => {
    await assertDisposableTestDatabase(client)

    await client.query('INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)', [
      userId, `${userId}@example.com`, otherUserId, `${otherUserId}@example.com`
    ])
  })

  beforeEach(async () => {
    await client.query('DELETE FROM catalog_item_ratings WHERE user_id = ANY($1::uuid[])', [[userId, otherUserId]])
  })

  afterAll(async () => {
    await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId, otherUserId]])
    await client.end()
  })

  it.each(['Dead Man', 'Spartacus'])('preserves the ID on corrections but not after removal for %s', async (title) => {
    const id = await itemId(title)
    const database = createDatabase(client)

    await expect(findCatalogItemRating(database, userId, id)).resolves.toStrictEqual({ score: null })

    await expect(setCatalogItemRating(database, userId, {
      catalogItemId: id,
      score: 7
    })).resolves.toBe(true)

    const first = await readRating(id)

    expect(first).toHaveLength(1)
    expect(first[0]?.id).toBeTypeOf('string')

    await setCatalogItemRating(database, userId, {
      catalogItemId: id,
      score: 9
    })

    await setCatalogItemRating(database, userId, {
      catalogItemId: id,
      score: 9
    })

    await expect(readRating(id)).resolves.toStrictEqual([{
      id: first[0]?.id,
      score: 9
    }])

    await setCatalogItemRating(database, otherUserId, {
      catalogItemId: id,
      score: 3
    })

    await setCatalogItemRating(database, userId, {
      catalogItemId: id,
      score: null
    })

    await setCatalogItemRating(database, userId, {
      catalogItemId: id,
      score: null
    })

    await expect(readRating(id)).resolves.toStrictEqual([])
    await expect(findCatalogItemRating(database, userId, id)).resolves.toStrictEqual({ score: null })
    await expect(findCatalogItemRating(database, otherUserId, id)).resolves.toStrictEqual({ score: 3 })

    await setCatalogItemRating(database, userId, {
      catalogItemId: id,
      score: 9
    })

    const restored = await readRating(id)

    expect(restored).toHaveLength(1)
    expect(restored[0]?.id).not.toBe(first[0]?.id)
    expect(restored[0]?.score).toBe(9)
  })

  it('enforces bounds, ownership, target references and uniqueness in PostgreSQL', async () => {
    const id = await itemId('Dead Man')
    const database = createDatabase(client)

    await setCatalogItemRating(database, userId, {
      catalogItemId: id,
      score: 7
    })

    const before = await readRating(id)

    const invalidUpdates = [0, 11].map(async score => {
      await expect(client.query('UPDATE catalog_item_ratings SET score = $1 WHERE user_id = $2', [score, userId]))
        .rejects.toMatchObject({ code: '23514' })
    })

    await Promise.all(invalidUpdates)

    await expect(client.query('UPDATE catalog_item_ratings SET score = $1 WHERE user_id = $2', ['7.5', userId]))
      .rejects.toMatchObject({ code: '22P02' })

    await expect(client.query('INSERT INTO catalog_item_ratings (user_id, catalog_item_id, score) VALUES ($1, $2, 5)', [userId, id]))
      .rejects.toMatchObject({ code: '23505' })

    const missingUserId = randomUUID()

    await expect(client.query('INSERT INTO catalog_item_ratings (user_id, catalog_item_id, score) VALUES ($1, $2, 5)', [missingUserId, id]))
      .rejects.toMatchObject({ code: '23503' })

    const missingItemId = randomUUID()

    await expect(client.query('INSERT INTO catalog_item_ratings (user_id, catalog_item_id, score) VALUES ($1, $2, 5)', [userId, missingItemId]))
      .rejects.toMatchObject({ code: '23503' })

    await expect(readRating(id)).resolves.toStrictEqual(before)
  })

  it('lets overlapping first saves succeed with one persisted rating', async () => {
    const id = await itemId('Dead Man')

    await expect(readRating(id)).resolves.toStrictEqual([])
    await client.query('BEGIN')

    // Block writes while allowing reads, so both independent saves reach persistence before either inserts.
    await client.query('LOCK TABLE catalog_item_ratings IN SHARE MODE')

    const pendingSaves = [concurrentWrite(id, 3), concurrentWrite(id, 9)]
    const settled = Promise.allSettled(pendingSaves)

    try {
      await vi.waitFor(async () => {
        await client.query('SELECT pg_stat_clear_snapshot()')

        const waiting = await client.query<{ count: number }>(`
          SELECT count(*)::integer AS count FROM pg_stat_activity
          WHERE datname = current_database()
            AND application_name = 'rating-concurrent-save'
            AND wait_event_type = 'Lock'
        `)

        expect(waiting.rows[0]?.count).toBe(2)
      }, { timeout: 5000 })
    } finally {
      await client.query('COMMIT')

      await settled
    }

    const results = await settled
    const after = await readRating(id)

    expect(results).toStrictEqual([
      {
        status: 'fulfilled',
        value: true
      },
      {
        status: 'fulfilled',
        value: true
      }
    ])

    expect(after).toHaveLength(1)
    expect([3, 9]).toContain(after[0]?.score)
  })

  it('keeps one stable rating under concurrent saves and no duplicate under save/remove races', async () => {
    const id = await itemId('Dead Man')
    const database = createDatabase(client)

    await setCatalogItemRating(database, userId, {
      catalogItemId: id,
      score: 7
    })

    const before = await readRating(id)
    const scores = [1, 2, 3, 4, 5, 6]
    const pendingSaves = scores.map(async score => concurrentWrite(id, score))
    const results = await Promise.all(pendingSaves)
    const after = await readRating(id)

    expect(results).toStrictEqual([true, true, true, true, true, true])
    expect(after).toHaveLength(1)
    expect(after[0]?.id).toBe(before[0]?.id)
    expect(scores).toContain(after[0]?.score)
    await Promise.all([concurrentWrite(id, null), concurrentWrite(id, 8)])

    const raced = await readRating(id)

    expect(raced.length).toBeLessThanOrEqual(1)

    const onlySavedScore = raced.every(row => row.score === 8)

    expect(onlySavedScore).toBe(true)
    await concurrentWrite(id, null)
    await expect(readRating(id)).resolves.toStrictEqual([])
  })

  it('does not rate a missing title or an item without original title metadata', async () => {
    const database = createDatabase(client)
    const id = randomUUID()

    await expect(findCatalogItemRating(database, userId, id)).resolves.toBeNull()

    await expect(setCatalogItemRating(database, userId, {
      catalogItemId: id,
      score: 7
    })).resolves.toBe(false)

    await client.query('INSERT INTO catalog_items (id, type) VALUES ($1, $2)', [id, 'series'])

    try {
      await expect(setCatalogItemRating(database, userId, {
        catalogItemId: id,
        score: 7
      })).resolves.toBe(false)

      await expect(setCatalogItemRating(database, userId, {
        catalogItemId: id,
        score: null
      })).resolves.toBe(false)

      await expect(readRating(id)).resolves.toStrictEqual([])
    } finally {
      await client.query('DELETE FROM catalog_items WHERE id = $1', [id])
    }
  })
})
