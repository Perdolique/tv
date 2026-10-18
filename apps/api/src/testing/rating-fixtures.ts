/* oxlint-disable import/no-relative-parent-imports -- Shared integration fixtures use the real catalog and authentication boundaries. */
import { randomUUID } from 'node:crypto'
import { env } from 'node:process'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { assertDisposableTestDatabase } from './test-database.ts'
import { setCurrentCatalogRating, type CurrentRatingChange } from '../catalog/rating-mutations.ts'
import type { RatingTarget } from '../catalog/rating-writes.ts'
import type { CatalogRatingMutationResponse } from '@tv/shared/catalog-viewings'
import { readViewingSummary } from '../catalog/viewings-repository.ts'

const titleTarget: RatingTarget = {
  seasonNumber: null,
  catalogEpisodeId: null
}

const seasonTarget: RatingTarget = {
  seasonNumber: 1,
  catalogEpisodeId: null
}

function ratingFixture() {
  const client = new Client({ connectionString: env.TEST_DATABASE_URL })
  const database = createDatabase(client)
  const userId = randomUUID()
  const otherUserId = randomUUID()
  const thirdUserId = randomUUID()
  const movieId = randomUUID()
  const seriesId = randomUUID()
  const otherSeriesId = randomUUID()
  const episodeId = randomUUID()
  const nextEpisodeId = randomUUID()
  const futureEpisodeId = randomUUID()
  const unknownEpisodeId = randomUUID()

  const episodeTarget: RatingTarget = {
    seasonNumber: null,
    catalogEpisodeId: episodeId
  }

  const userIds = [userId, otherUserId, thirdUserId]

  async function setup(): Promise<void> {
    await client.connect()
    await assertDisposableTestDatabase(client)
    await client.query('INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4), ($5, $6)', [userId, `${userId}@example.com`, otherUserId, `${otherUserId}@example.com`, thirdUserId, `${thirdUserId}@example.com`])
    await client.query('INSERT INTO catalog_items (id, type) VALUES ($1, \'movie\'), ($2, \'series\'), ($3, \'series\')', [movieId, seriesId, otherSeriesId])
    await client.query('INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original) VALUES ($1, \'en\', \'Rating movie\', true), ($2, \'en\', \'Rating series\', true), ($3, \'en\', \'Other rating series\', true)', [movieId, seriesId, otherSeriesId])

    await client.query(`INSERT INTO catalog_episodes (id, catalog_item_id, season_number, episode_number, air_date) VALUES
      ($1, $2, 1, 1, '2000-01-01'), ($3, $2, 1, 2, '2000-01-02'), ($4, $2, 2, 1, '9999-01-01'), ($5, $2, 3, 1, NULL)`, [episodeId, seriesId, nextEpisodeId, futureEpisodeId, unknownEpisodeId])

    await client.query('INSERT INTO catalog_episodes (catalog_item_id, season_number, episode_number, air_date) VALUES ($1, 1, 1, \'2000-01-01\')', [otherSeriesId])
  }

  async function reset(): Promise<void> {
    await client.query('DELETE FROM catalog_viewing_contexts WHERE user_id = ANY($1::uuid[])', [userIds])
    await client.query('DELETE FROM catalog_viewings WHERE user_id = ANY($1::uuid[])', [userIds])
    await client.query('DELETE FROM catalog_viewing_requests WHERE user_id = ANY($1::uuid[])', [userIds])
  }

  async function cleanup(): Promise<void> {
    await client.query('DELETE FROM catalog_items WHERE id = ANY($1::uuid[])', [[movieId, seriesId, otherSeriesId]])
    await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds])
    await client.end()
  }

  async function input(catalogItemId: string, score: number | null, ownerId = userId): Promise<CurrentRatingChange> {
    const summary = await readViewingSummary(database, {
      userId: ownerId,
      catalogItemId
    })

    const requestId = randomUUID()

    return {
      requestId,
      currentViewingId: summary.currentViewingId,
      contextVersion: summary.contextVersion,
      viewingDate: '2026-01-15',
      timeZone: 'Europe/Tallinn',
      score
    }
  }

  // oxlint-disable-next-line eslint/max-params -- Test cases name the title, target, score and optional account explicitly.
  async function save(catalogItemId: string, target: RatingTarget, score: number | null, ownerId = userId) {
    const change = await input(catalogItemId, score, ownerId)

    return setCurrentCatalogRating(database, {
      userId: ownerId,
      catalogItemId
    }, target, change)
  }

  return {
    client,
    database,
    userId,
    otherUserId,
    thirdUserId,
    movieId,
    seriesId,
    otherSeriesId,
    episodeId,
    nextEpisodeId,
    futureEpisodeId,
    unknownEpisodeId,
    episodeTarget,
    setup,
    reset,
    cleanup,
    input,
    save
  }
}


function requireRatingViewing(response: CatalogRatingMutationResponse) {
  if (response.viewing === null) { throw new Error('Expected a confirmed viewing') }

  return response.viewing
}

function requireTestValue<Value>(value: Value | null | undefined): Value {
  if (value === null || value === undefined) { throw new Error('Expected a fixture value') }

  return value
}

export { ratingFixture, seasonTarget, titleTarget, requireRatingViewing, requireTestValue }
