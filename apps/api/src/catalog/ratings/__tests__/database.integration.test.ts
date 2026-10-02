import { env } from 'node:process'
import { randomUUID } from 'node:crypto'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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
  const connection = new Client({ connectionString: databaseUrl })

  try {
    await connection.connect()

    return await setCatalogItemRating(createDatabase(connection), userId, {
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

    await setCatalogItemRating(createDatabase(client), userId, {
      catalogItemId: id,
      score: 7
    })

    const before = await readRating(id)

    await Promise.all([0, 11].map(async score => {
      await expect(client.query('UPDATE catalog_item_ratings SET score = $1 WHERE user_id = $2', [score, userId]))
        .rejects.toMatchObject({ code: '23514' })
    }))

    await expect(client.query('UPDATE catalog_item_ratings SET score = $1 WHERE user_id = $2', ['7.5', userId]))
      .rejects.toMatchObject({ code: '22P02' })

    await expect(client.query('INSERT INTO catalog_item_ratings (user_id, catalog_item_id, score) VALUES ($1, $2, 5)', [userId, id]))
      .rejects.toMatchObject({ code: '23505' })

    await expect(client.query('INSERT INTO catalog_item_ratings (user_id, catalog_item_id, score) VALUES ($1, $2, 5)', [randomUUID(), id]))
      .rejects.toMatchObject({ code: '23503' })

    await expect(client.query('INSERT INTO catalog_item_ratings (user_id, catalog_item_id, score) VALUES ($1, $2, 5)', [userId, randomUUID()]))
      .rejects.toMatchObject({ code: '23503' })

    await expect(readRating(id)).resolves.toStrictEqual(before)
  })

  it('keeps one stable rating under concurrent saves and no duplicate under save/remove races', async () => {
    const id = await itemId('Dead Man')

    await setCatalogItemRating(createDatabase(client), userId, {
      catalogItemId: id,
      score: 7
    })

    const before = await readRating(id)
    const scores = [1, 2, 3, 4, 5, 6]
    const results = await Promise.all(scores.map(async score => concurrentWrite(id, score)))
    const after = await readRating(id)

    expect(results).toStrictEqual([true, true, true, true, true, true])
    expect(after).toHaveLength(1)
    expect(after[0]?.id).toBe(before[0]?.id)
    expect(scores).toContain(after[0]?.score)
    await Promise.all([concurrentWrite(id, null), concurrentWrite(id, 8)])

    const raced = await readRating(id)

    expect(raced.length).toBeLessThanOrEqual(1)
    expect(raced.every(row => row.score === 8)).toBe(true)
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
