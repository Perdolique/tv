import { env } from 'node:process'
import { randomUUID } from 'node:crypto'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'
import { findCatalogItemRating, findCatalogItemRatingSummary, setCatalogItemRating } from '../../ratings-repository.ts'

const client = new Client({ connectionString: env.TEST_DATABASE_URL })
const userId = randomUUID()
const otherUserId = randomUUID()
const thirdUserId = randomUUID()
const seriesId = randomUUID()
const otherSeriesId = randomUUID()
const database = createDatabase(client)

interface StoredRating {
  id: string;
  user_id: string;
  catalog_item_id: string;
  season_number: number | null;
  score: number;
}

interface SaveOptions {
  owner?: string;
  catalogItemId?: string;
}

async function rows() {
  const result = await client.query<StoredRating>('SELECT id, user_id, catalog_item_id, season_number, score FROM catalog_item_ratings WHERE user_id = $1 ORDER BY catalog_item_id, season_number NULLS FIRST', [userId])

  return result.rows
}

async function save(seasonNumber: number | null, score: number | null, { owner = userId, catalogItemId = seriesId }: SaveOptions = {}) {
  return setCatalogItemRating(database, owner, {
    catalogItemId,
    seasonNumber,
    score
  })
}

describe('season rating persistence', () => {
  beforeAll(async () => {
    await client.connect()
    await assertDisposableTestDatabase(client)

    const email = `${userId}@example.com`
    const otherEmail = `${otherUserId}@example.com`
    const thirdEmail = `${thirdUserId}@example.com`

    await client.query('INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4), ($5, $6)', [userId, email, otherUserId, otherEmail, thirdUserId, thirdEmail])
    await client.query('INSERT INTO catalog_items (id, type) VALUES ($1, \'series\'), ($2, \'series\')', [seriesId, otherSeriesId])
    await client.query('INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original) VALUES ($1, \'en\', \'Rating series\', true), ($2, \'en\', \'Other rating series\', true)', [seriesId, otherSeriesId])
    await client.query('INSERT INTO catalog_episodes (catalog_item_id, season_number, episode_number) VALUES ($1, 1, 1), ($1, 1, 2), ($1, 2, 1), ($2, 1, 1)', [seriesId, otherSeriesId])
  })

  beforeEach(async () => {
    await client.query('DELETE FROM catalog_item_ratings WHERE user_id = ANY($1::uuid[])', [[userId, otherUserId, thirdUserId]])
  })

  afterAll(async () => {
    await client.query('DELETE FROM catalog_items WHERE id = ANY($1::uuid[])', [[seriesId, otherSeriesId]])
    await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId, otherUserId, thirdUserId]])
    await client.end()
  })

  it('isolates season votes from whole-title reads, updates and removal', async () => {
    await save(1, 6)
    await save(2, 10)
    await save(1, 4, { catalogItemId: otherSeriesId })

    const titleRating = await findCatalogItemRating(database, userId, {
      catalogItemId: seriesId,
      seasonNumber: null
    })

    expect(titleRating).toStrictEqual({ score: null })

    const titleSummary = await findCatalogItemRatingSummary(database, seriesId)

    expect(titleSummary).toStrictEqual({
      averageScore: null,
      ratingCount: 0
    })

    await save(null, 2)
    await save(null, 3)
    await save(null, null)

    const firstSeasonRating = await findCatalogItemRating(database, userId, {
      catalogItemId: seriesId,
      seasonNumber: 1
    })

    expect(firstSeasonRating).toStrictEqual({ score: 6 })

    const secondSeasonRating = await findCatalogItemRating(database, userId, {
      catalogItemId: seriesId,
      seasonNumber: 2
    })

    expect(secondSeasonRating).toStrictEqual({ score: 10 })

    const otherSeriesSummary = await findCatalogItemRatingSummary(database, otherSeriesId, 1)

    expect(otherSeriesSummary).toStrictEqual({
      averageScore: 4,
      ratingCount: 1
    })

    const persisted = await rows()

    expect(persisted).toHaveLength(3)
  })

  it('preserves IDs on repeated updates and creates a new ID after removal', async () => {
    await save(1, 7)

    const initial = await rows()

    await save(1, 9)
    await save(1, 9)

    const updated = await rows()

    expect(updated).toHaveLength(1)
    expect(updated[0]?.id).toBe(initial[0]?.id)
    expect(updated[0]?.score).toBe(9)
    await save(1, null)
    await save(1, null)

    const removed = await rows()

    expect(removed).toStrictEqual([])
    await save(1, 9)

    const recreated = await rows()

    expect(recreated[0]?.id).not.toBe(initial[0]?.id)
  })

  it('counts direct account votes without multiplying them by episode count', async () => {
    const emptySummary = await findCatalogItemRatingSummary(database, seriesId, 1)

    expect(emptySummary).toStrictEqual({
      averageScore: null,
      ratingCount: 0
    })

    await save(1, 6)
    await save(1, 6, { owner: otherUserId })
    await save(1, 9, { owner: thirdUserId })
    await save(2, 1)
    await save(null, 1)

    const threeVoteSummary = await findCatalogItemRatingSummary(database, seriesId, 1)

    expect(threeVoteSummary).toStrictEqual({
      averageScore: 7,
      ratingCount: 3
    })

    await save(1, 7)
    await save(1, 7)

    const updatedSummary = await findCatalogItemRatingSummary(database, seriesId, 1)

    expect(updatedSummary).toStrictEqual({
      averageScore: 22 / 3,
      ratingCount: 3
    })

    await save(1, null)

    const remainingSummary = await findCatalogItemRatingSummary(database, seriesId, 1)

    expect(remainingSummary).toStrictEqual({
      averageScore: 7.5,
      ratingCount: 2
    })

    const otherUserRating = await findCatalogItemRating(database, otherUserId, {
      catalogItemId: seriesId,
      seasonNumber: 1
    })

    expect(otherUserRating).toStrictEqual({ score: 6 })
    await save(1, null, { owner: otherUserId })
    await save(1, null, { owner: thirdUserId })

    const clearedSummary = await findCatalogItemRatingSummary(database, seriesId, 1)

    expect(clearedSummary).toStrictEqual({
      averageScore: null,
      ratingCount: 0
    })
  })

  it('enforces one whole-title and one season score per account in the database', async () => {
    await save(null, 7)
    await save(1, 8)
    await save(2, 9)

    const insert = 'INSERT INTO catalog_item_ratings (user_id, catalog_item_id, season_number, score) VALUES ($1, $2, $3, $4)'
    const duplicateTitle = client.query(insert, [userId, seriesId, null, 5])

    await expect(duplicateTitle).rejects.toMatchObject({ code: '23505' })

    const duplicateSeason = client.query(insert, [userId, seriesId, 1, 5])

    await expect(duplicateSeason).rejects.toMatchObject({ code: '23505' })

    const invalidSeason = client.query(insert, [userId, seriesId, 0, 5])

    await expect(invalidSeason).rejects.toMatchObject({ code: '23514' })

    const invalidScore = client.query(insert, [otherUserId, seriesId, 1, 11])

    await expect(invalidScore).rejects.toMatchObject({ code: '23514' })

    const fractionalSeason = client.query(insert, [otherUserId, seriesId, '1.5', 5])

    await expect(fractionalSeason).rejects.toMatchObject({ code: '22P02' })

    const persisted = await rows()

    expect(persisted).toHaveLength(3)
  })

  it('handles concurrent first saves without a second vote', async () => {
    const writes = [6, 9].map(async score => {
      const connection = new Client({ connectionString: env.TEST_DATABASE_URL })

      try {
        await connection.connect()

        const concurrentDatabase = createDatabase(connection)

        return await setCatalogItemRating(concurrentDatabase, userId, {
          catalogItemId: seriesId,
          seasonNumber: 1,
          score
        })
      } finally {
        await connection.end()
      }
    })

    const results = await Promise.all(writes)

    expect(results).toStrictEqual([true, true])

    const persisted = await rows()

    expect(persisted).toHaveLength(1)
    expect([6, 9]).toContain(persisted[0]?.score)

    const summary = await findCatalogItemRatingSummary(database, seriesId, 1)

    expect(summary).toMatchObject({ ratingCount: 1 })
  })

  it('rejects a season with no catalog episodes', async () => {
    const saved = await save(99, 7)

    expect(saved).toBe(false)

    const rating = await findCatalogItemRating(database, userId, {
      catalogItemId: seriesId,
      seasonNumber: 99
    })

    expect(rating).toBeNull()

    const summary = await findCatalogItemRatingSummary(database, seriesId, 99)

    expect(summary).toBeNull()

    const persisted = await rows()

    expect(persisted).toStrictEqual([])
  })
})
