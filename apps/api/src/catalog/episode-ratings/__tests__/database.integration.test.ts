import { URL } from 'node:url'
import { env } from 'node:process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'

import {
  findCatalogEpisodeRatings,
  findCatalogEpisodeRatingSummaries,
  setCatalogEpisodeRating
} from '../../episode-ratings-repository.ts'

import { findCatalogItemRating, findCatalogItemRatingSummary, setCatalogItemRating } from '../../ratings-repository.ts'

const client = new Client({ connectionString: env.TEST_DATABASE_URL })
const database = createDatabase(client)
const userId = randomUUID()
const otherUserId = randomUUID()
const seriesId = randomUUID()
const otherSeriesId = randomUUID()
const episodeId = randomUUID()
const nextEpisodeId = randomUUID()
const otherSeasonEpisodeId = randomUUID()
const otherSeriesEpisodeId = randomUUID()

const scope = {
  catalogItemId: seriesId,
  seasonNumber: 1
}

async function storedRatings() {
  const result = await client.query<{ id: string; catalog_episode_id: string | null; score: number }>('SELECT id, catalog_episode_id, score FROM catalog_item_ratings WHERE user_id = $1 ORDER BY id', [userId])

  return result.rows
}

describe('episode rating persistence', () => {
  beforeAll(async () => {
    await client.connect()
    await assertDisposableTestDatabase(client)
    await client.query('INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)', [userId, `${userId}@example.com`, otherUserId, `${otherUserId}@example.com`])
    await client.query('INSERT INTO catalog_items (id, type) VALUES ($1, \'series\'), ($2, \'series\')', [seriesId, otherSeriesId])
    await client.query('INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original) VALUES ($1, \'en\', \'Episode ratings\', true), ($2, \'en\', \'Other episode ratings\', true)', [seriesId, otherSeriesId])
    await client.query('INSERT INTO catalog_episodes (id, catalog_item_id, season_number, episode_number) VALUES ($1, $5, 1, 1), ($2, $5, 1, 2), ($3, $5, 2, 1), ($4, $6, 1, 1)', [episodeId, nextEpisodeId, otherSeasonEpisodeId, otherSeriesEpisodeId, seriesId, otherSeriesId])
  })

  beforeEach(async () => {
    await client.query('DELETE FROM catalog_item_ratings WHERE user_id = ANY($1::uuid[])', [[userId, otherUserId]])
  })

  afterAll(async () => {
    await client.query('DELETE FROM catalog_items WHERE id = ANY($1::uuid[])', [[seriesId, otherSeriesId]])
    await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId, otherUserId]])
    await client.end()
  })

  it('keeps stable identities across updates, but creates a new row after removal', async () => {
    await expect(setCatalogEpisodeRating(database, userId, {
      episodeId,
      score: 1
    })).resolves.toBe(true)

    const first = await storedRatings()

    await setCatalogEpisodeRating(database, userId, {
      episodeId,
      score: 10
    })

    await setCatalogEpisodeRating(database, userId, {
      episodeId,
      score: 10
    })

    const updated = await storedRatings()

    expect(updated).toStrictEqual([{
      id: first[0]?.id,
      catalog_episode_id: episodeId,
      score: 10
    }])

    await setCatalogEpisodeRating(database, userId, {
      episodeId,
      score: null
    })

    await setCatalogEpisodeRating(database, userId, {
      episodeId,
      score: null
    })

    await expect(storedRatings()).resolves.toStrictEqual([])

    await setCatalogEpisodeRating(database, userId, {
      episodeId,
      score: 6
    })

    const recreated = await storedRatings()

    expect(recreated).toHaveLength(1)
    expect(recreated[0]?.id).not.toBe(first[0]?.id)
  })

  it('lists explicit unrated entries and aggregates only direct current votes', async () => {
    await setCatalogEpisodeRating(database, userId, {
      episodeId,
      score: 5
    })

    await setCatalogEpisodeRating(database, otherUserId, {
      episodeId,
      score: 8
    })

    await setCatalogEpisodeRating(database, userId, {
      episodeId: otherSeasonEpisodeId,
      score: 1
    })

    await setCatalogEpisodeRating(database, userId, {
      episodeId: otherSeriesEpisodeId,
      score: 2
    })

    await expect(findCatalogEpisodeRatings(database, userId, scope)).resolves.toStrictEqual([
      {
        episodeId,
        score: 5
      }, {
        episodeId: nextEpisodeId,
        score: null
      }
    ])

    await expect(findCatalogEpisodeRatingSummaries(database, scope)).resolves.toStrictEqual([
      {
        episodeId,
        averageScore: 6.5,
        ratingCount: 2
      },
      {
        episodeId: nextEpisodeId,
        averageScore: null,
        ratingCount: 0
      }
    ])

    await setCatalogEpisodeRating(database, userId, {
      episodeId,
      score: 7
    })

    await expect(findCatalogEpisodeRatingSummaries(database, { episodeId })).resolves.toStrictEqual([{
      episodeId,
      averageScore: 7.5,
      ratingCount: 2
    }])

    await setCatalogEpisodeRating(database, userId, {
      episodeId,
      score: null
    })

    await expect(findCatalogEpisodeRatingSummaries(database, { episodeId })).resolves.toStrictEqual([{
      episodeId,
      averageScore: 8,
      ratingCount: 1
    }])

    await setCatalogEpisodeRating(database, otherUserId, {
      episodeId,
      score: null
    })

    await expect(findCatalogEpisodeRatingSummaries(database, { episodeId })).resolves.toStrictEqual([{
      episodeId,
      averageScore: null,
      ratingCount: 0
    }])
  })

  it.each([null, 1])('never mixes episode votes with parent target season %s', async seasonNumber => {
    await setCatalogEpisodeRating(database, userId, {
      episodeId,
      score: 4
    })

    const saved = await storedRatings()

    await expect(findCatalogItemRating(database, userId, {
      catalogItemId: seriesId,
      seasonNumber
    })).resolves.toStrictEqual({ score: null })

    await expect(findCatalogItemRatingSummary(database, seriesId, seasonNumber)).resolves.toStrictEqual({
      averageScore: null,
      ratingCount: 0
    })

    await setCatalogItemRating(database, userId, {
      catalogItemId: seriesId,
      seasonNumber,
      score: 9
    })

    await expect(findCatalogItemRating(database, userId, {
      catalogItemId: seriesId,
      seasonNumber
    })).resolves.toStrictEqual({ score: 9 })

    await expect(findCatalogItemRatingSummary(database, seriesId, seasonNumber)).resolves.toStrictEqual({
      averageScore: 9,
      ratingCount: 1
    })

    await expect(findCatalogEpisodeRatingSummaries(database, { episodeId })).resolves.toStrictEqual([{
      episodeId,
      averageScore: 4,
      ratingCount: 1
    }])

    await setCatalogItemRating(database, userId, {
      catalogItemId: seriesId,
      seasonNumber,
      score: null
    })

    await expect(storedRatings()).resolves.toStrictEqual(saved)

    const watches = await client.query('SELECT * FROM catalog_episode_watches WHERE user_id = $1', [userId])

    expect(watches.rows).toStrictEqual([])
  })

  it('enforces ownership, bounds, unique votes and matching episode parents in the database', async () => {
    await setCatalogEpisodeRating(database, userId, {
      episodeId,
      score: 6
    })

    const insert = 'INSERT INTO catalog_item_ratings (user_id, catalog_item_id, season_number, catalog_episode_id, score) VALUES ($1, $2, $3, $4, $5)'

    await expect(client.query(insert, [userId, seriesId, null, episodeId, 6])).rejects.toMatchObject({ code: '23505' })
    await expect(client.query(insert, [otherUserId, otherSeriesId, null, episodeId, 6])).rejects.toMatchObject({ code: '23503' })
    await expect(client.query(insert, [otherUserId, seriesId, 1, episodeId, 6])).rejects.toMatchObject({ code: '23514' })
    await expect(client.query(insert, [otherUserId, seriesId, null, episodeId, 11])).rejects.toMatchObject({ code: '23514' })
    await expect(client.query(insert, [otherUserId, seriesId, null, randomUUID(), 6])).rejects.toMatchObject({ code: '23503' })
    await expect(client.query(insert, [randomUUID(), seriesId, null, episodeId, 6])).rejects.toMatchObject({ code: '23503' })

    await expect(findCatalogEpisodeRatings(database, otherUserId, { episodeId })).resolves.toStrictEqual([{
      episodeId,
      score: null
    }])

    await setCatalogEpisodeRating(database, otherUserId, {
      episodeId,
      score: null
    })

    await expect(findCatalogEpisodeRatings(database, userId, { episodeId })).resolves.toStrictEqual([{
      episodeId,
      score: 6
    }])
  })

  it('handles concurrent first saves without adding a vote', async () => {
    const writes = [3, 9].map(async score => {
      const connection = new Client({ connectionString: env.TEST_DATABASE_URL })

      try {
        await connection.connect()

        const concurrentDatabase = createDatabase(connection)

        return await setCatalogEpisodeRating(concurrentDatabase, userId, {
          episodeId,
          score
        })
      } finally {
        await connection.end()
      }
    })

    await expect(Promise.all(writes)).resolves.toStrictEqual([true, true])

    const rows = await storedRatings()

    expect(rows).toHaveLength(1)
    expect([3, 9]).toContain(rows[0]?.score)
    await expect(findCatalogEpisodeRatingSummaries(database, { episodeId })).resolves.toMatchObject([{ ratingCount: 1 }])
  })

  it('rejects missing episodes and seasons without storing anything', async () => {
    const missingId = randomUUID()

    await expect(setCatalogEpisodeRating(database, userId, {
      episodeId: missingId,
      score: 8
    })).resolves.toBe(false)

    await expect(findCatalogEpisodeRatings(database, userId, { episodeId: missingId })).resolves.toBeNull()

    await expect(findCatalogEpisodeRatingSummaries(database, {
      catalogItemId: seriesId,
      seasonNumber: 99
    })).resolves.toBeNull()

    await expect(storedRatings()).resolves.toStrictEqual([])
  })

  it('migrates populated title and season ratings without changing their IDs or scores', async () => {
    const migrationUrl = new URL('../../../../../../packages/database/migrations/20261004161458_episode_ratings/migration.sql', import.meta.url)
    const migration = await readFile(migrationUrl, 'utf8')

    await client.query('BEGIN')

    try {
      await client.query('ALTER TABLE catalog_item_ratings DROP COLUMN catalog_episode_id CASCADE')
      await client.query('ALTER TABLE catalog_episodes DROP CONSTRAINT catalog_episodes_id_item_unique')
      await client.query('ALTER TABLE catalog_item_ratings ADD CONSTRAINT catalog_item_ratings_user_target_unique UNIQUE NULLS NOT DISTINCT (user_id, catalog_item_id, season_number)')

      const before = await client.query('INSERT INTO catalog_item_ratings (user_id, catalog_item_id, season_number, score) VALUES ($1, $2, NULL, 7), ($1, $2, 1, 8) RETURNING id, user_id, catalog_item_id, season_number, score', [userId, seriesId])

      await client.query(migration)

      const after = await client.query('SELECT id, user_id, catalog_item_id, season_number, score FROM catalog_item_ratings WHERE user_id = $1 ORDER BY season_number NULLS FIRST', [userId])

      expect(after.rows).toStrictEqual(before.rows)

      await expect(findCatalogItemRatingSummary(database, seriesId)).resolves.toStrictEqual({
        averageScore: 7,
        ratingCount: 1
      })
    } finally {
      await client.query('ROLLBACK')
    }
  })
})
