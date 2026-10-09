/* oxlint-disable vitest/no-conditional-in-test, eslint/max-lines -- One disposable migration fixture keeps rollback, exact legacy marks and every owner assignment together. */
import { randomUUID } from 'node:crypto'
import { appendFile, cp, mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { createDatabase } from '@tv/database'
import { isLoopbackHostname } from '@tv/shared/network'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'
import { describe, expect, it } from 'vitest'
import { assertDisposableTestDatabase } from '../../testing/test-database.ts'

const migrationsUrl = new URL('../../../../../packages/database/migrations', import.meta.url)
const migrationsFolder = fileURLToPath(migrationsUrl)
const migrationName = '20261008043331_series_timeline'

interface LegacyEpisodeMark {
  userId: string;
  catalogItemId: string;
  catalogEpisodeId: string;
  markedAt: string;
}

interface MigratedEpisodeMark extends LegacyEpisodeMark {
  id: string;
  viewingId: string;
  version: number;
}

interface MigratedSeriesViewing {
  id: string;
  userId: string;
  catalogItemId: string;
  status: string;
  recordedAt: string;
  startedOn: string | null;
  completedOn: string | null;
}

interface LegacyRating {
  id: string;
  userId: string;
  catalogItemId: string;
  score: number;
}

interface MigratedTimelineEvent {
  userId: string;
  catalogItemId: string;
  catalogEpisodeId: string | null;
  kind: string;
  occurredAt: string;
}

function ownerItemOrder(first: Pick<LegacyEpisodeMark, 'userId' | 'catalogItemId'>, second: Pick<LegacyEpisodeMark, 'userId' | 'catalogItemId'>): number {
  const firstKey = `${first.userId}:${first.catalogItemId}`
  const secondKey = `${second.userId}:${second.catalogItemId}`
  const order = firstKey.localeCompare(secondKey)

  return order
}

describe('filled series timeline migration', () => {
  it('preserves exact legacy recording times and opinions without inventing starts or achievements', async () => {
    const adminUrl = new URL(env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://tv:tv@127.0.0.1:5433/postgres')
    const loopbackServer = isLoopbackHostname(adminUrl.hostname)

    if (!loopbackServer) {
      throw new Error('Migration tests require a loopback PostgreSQL server')
    }

    const databaseId = randomUUID()
    const databaseSuffix = databaseId.replaceAll('-', '')
    const databaseName = `tv_test_${databaseSuffix}`
    const databaseUrl = new URL(adminUrl)
    const databasePath = `/${databaseName}`

    databaseUrl.pathname = databasePath

    const adminConnectionString = adminUrl.toString()
    const databaseConnectionString = databaseUrl.toString()
    const admin = new Client({ connectionString: adminConnectionString })
    const client = new Client({ connectionString: databaseConnectionString })
    const directory = await mkdtemp('/tmp/tv-series-migration-')
    let created = false

    try {
      await admin.connect()

      const createDatabaseQuery = `CREATE DATABASE "${databaseName}"`

      await admin.query(createDatabaseQuery)

      created = true

      await client.connect()
      await assertDisposableTestDatabase(client)

      const beforeFolder = join(directory, 'before')
      const folders = await readdir(migrationsFolder)
      const earlierFolders = folders.filter(folder => folder < migrationName)

      const copies = earlierFolders.map(async folder => {
        const sourceFolder = join(migrationsFolder, folder)
        const targetFolder = join(beforeFolder, folder)

        await cp(sourceFolder, targetFolder, { recursive: true })
      })

      await Promise.all(copies)

      const database = createDatabase(client)

      await migrate(database, { migrationsFolder: beforeFolder })

      const userId = randomUUID()
      const secondUserId = randomUUID()
      const seriesId = randomUUID()
      const secondSeriesId = randomUUID()
      const movieId = randomUUID()
      const episodeId = randomUUID()
      const secondEpisodeId = randomUUID()
      const thirdEpisodeId = randomUUID()
      const otherSeriesEpisodeId = randomUUID()
      const movieViewingId = randomUUID()
      const userIds = [userId, secondUserId]
      const firstRatingId = randomUUID()
      const secondRatingId = randomUUID()
      const otherUserRatingId = randomUUID()

      const legacyMarks: LegacyEpisodeMark[] = [
        {
          userId,
          catalogItemId: seriesId,
          catalogEpisodeId: episodeId,
          markedAt: '2020-01-02T03:04:05.123456Z'
        },
        {
          userId,
          catalogItemId: seriesId,
          catalogEpisodeId: secondEpisodeId,
          markedAt: '2019-01-02T03:04:05.111222Z'
        },
        {
          userId,
          catalogItemId: seriesId,
          catalogEpisodeId: thirdEpisodeId,
          markedAt: '2020-01-02T03:04:05.223344Z'
        },
        {
          userId: secondUserId,
          catalogItemId: seriesId,
          catalogEpisodeId: secondEpisodeId,
          markedAt: '2022-01-02T03:04:05.222333Z'
        },
        {
          userId: secondUserId,
          catalogItemId: seriesId,
          catalogEpisodeId: thirdEpisodeId,
          markedAt: '2022-01-02T03:04:05.444555Z'
        },
        {
          userId,
          catalogItemId: secondSeriesId,
          catalogEpisodeId: otherSeriesEpisodeId,
          markedAt: '2023-01-02T03:04:05.333444Z'
        },
        {
          userId: secondUserId,
          catalogItemId: secondSeriesId,
          catalogEpisodeId: otherSeriesEpisodeId,
          markedAt: '2024-01-02T03:04:05.444555Z'
        }
      ]

      const legacyRatings: LegacyRating[] = [
        {
          id: firstRatingId,
          userId,
          catalogItemId: seriesId,
          score: 8
        },
        {
          id: secondRatingId,
          userId,
          catalogItemId: secondSeriesId,
          score: 6
        },
        {
          id: otherUserRatingId,
          userId: secondUserId,
          catalogItemId: seriesId,
          score: 9
        }
      ]

      const seriesViewingStates = [
        {
          userId,
          catalogItemId: seriesId,
          status: 'watching',
          recordedAt: '2019-01-02T03:04:05.111222Z',
          startedOn: null,
          completedOn: null
        },
        {
          userId: secondUserId,
          catalogItemId: seriesId,
          status: 'watching',
          recordedAt: '2022-01-02T03:04:05.222333Z',
          startedOn: null,
          completedOn: null
        },
        {
          userId,
          catalogItemId: secondSeriesId,
          status: 'watching',
          recordedAt: '2023-01-02T03:04:05.333444Z',
          startedOn: null,
          completedOn: null
        },
        {
          userId: secondUserId,
          catalogItemId: secondSeriesId,
          status: 'watching',
          recordedAt: '2024-01-02T03:04:05.444555Z',
          startedOn: null,
          completedOn: null
        }
      ]

      const expectedSeriesViewings = seriesViewingStates.toSorted(ownerItemOrder)

      const expectedMarks = legacyMarks.toSorted((first, second) => {
        const order = first.markedAt.localeCompare(second.markedAt)

        return order
      })

      const expectedRatings = legacyRatings.toSorted((first, second) => {
        const order = first.id.localeCompare(second.id)

        return order
      })

      await client.query('INSERT INTO users (id, email) VALUES ($1, \'series-migration@example.com\'), ($2, \'second-series-migration@example.com\')', userIds)
      await client.query('INSERT INTO catalog_items (id, type) VALUES ($1, \'series\'), ($2, \'series\'), ($3, \'movie\')', [seriesId, secondSeriesId, movieId])

      await client.query(`INSERT INTO catalog_episodes (id, catalog_item_id, season_number, episode_number)
        VALUES ($1, $5, 1, 1), ($2, $5, 1, 2), ($3, $5, 2, 1), ($4, $6, 1, 1)`, [episodeId, secondEpisodeId, thirdEpisodeId, otherSeriesEpisodeId, seriesId, secondSeriesId])

      const legacyMarksJson = JSON.stringify(legacyMarks)

      await client.query(`INSERT INTO catalog_episode_watches (user_id, catalog_episode_id, marked_at)
        SELECT "userId", "catalogEpisodeId", "markedAt" FROM jsonb_to_recordset($1::jsonb)
        AS marks("userId" uuid, "catalogEpisodeId" uuid, "markedAt" timestamptz)`, [legacyMarksJson])

      await client.query(`INSERT INTO catalog_viewings (id, user_id, catalog_item_id, recorded_at) VALUES ($1, $2, $3, '2021-02-03 04:05:06.654321+00')`, [movieViewingId, userId, movieId])

      const legacyRatingsJson = JSON.stringify(legacyRatings)

      await client.query(`INSERT INTO catalog_item_ratings (id, user_id, catalog_item_id, score)
        SELECT id, "userId", "catalogItemId", score FROM jsonb_to_recordset($1::jsonb)
        AS ratings(id uuid, "userId" uuid, "catalogItemId" uuid, score integer)`, [legacyRatingsJson])

      const failedFolder = join(directory, 'failed')

      await cp(migrationsFolder, failedFolder, { recursive: true })

      const failedMigrationFile = join(failedFolder, migrationName, 'migration.sql')

      await appendFile(failedMigrationFile, '\n--> statement-breakpoint\nSELECT 1 / 0;\n')
      await expect(migrate(database, { migrationsFolder: failedFolder })).rejects.toThrow('SELECT 1 / 0')

      const legacyAfterRollback = await client.query<LegacyEpisodeMark>(`SELECT watches.user_id AS "userId", episodes.catalog_item_id AS "catalogItemId", watches.catalog_episode_id AS "catalogEpisodeId",
        to_char(watches.marked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "markedAt"
        FROM catalog_episode_watches watches JOIN catalog_episodes episodes ON episodes.id = watches.catalog_episode_id
        WHERE watches.user_id = ANY($1::uuid[]) ORDER BY watches.marked_at`, [userIds])

      expect(legacyAfterRollback.rows).toStrictEqual(expectedMarks)

      const newTable = await client.query('SELECT to_regclass(\'catalog_viewing_episode_watches\') AS name')

      expect(newTable.rows).toStrictEqual([{ name: null }])
      await migrate(database, { migrationsFolder })

      const viewings = await client.query<MigratedSeriesViewing>(`SELECT viewings.id, viewings.user_id AS "userId", viewings.catalog_item_id AS "catalogItemId", viewings.status,
        to_char(viewings.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "recordedAt",
        viewings.started_on AS "startedOn", viewings.completed_on AS "completedOn"
        FROM catalog_viewings viewings JOIN catalog_items items ON items.id = viewings.catalog_item_id
        WHERE viewings.user_id = ANY($1::uuid[]) AND items.type = 'series' ORDER BY viewings.user_id, viewings.catalog_item_id`, [userIds])

      const actualViewingStates = viewings.rows.map(viewing => {
        return {
          userId: viewing.userId,
          catalogItemId: viewing.catalogItemId,
          status: viewing.status,
          recordedAt: viewing.recordedAt,
          startedOn: viewing.startedOn,
          completedOn: viewing.completedOn
        }
      })

      expect(actualViewingStates).toStrictEqual(expectedSeriesViewings)

      const contexts = await client.query(`SELECT user_id AS "userId", catalog_item_id AS "catalogItemId", current_viewing_id AS "currentViewingId", context_version AS "contextVersion"
        FROM catalog_viewing_contexts WHERE user_id = ANY($1::uuid[]) AND catalog_item_id = ANY($2::uuid[]) ORDER BY user_id, catalog_item_id`, [userIds, [seriesId, secondSeriesId]])

      const expectedContexts = viewings.rows.map(viewing => {
        return {
          userId: viewing.userId,
          catalogItemId: viewing.catalogItemId,
          currentViewingId: viewing.id,
          contextVersion: 1
        }
      })

      expect(contexts.rows).toStrictEqual(expectedContexts)

      const viewingIds = viewings.rows.map(viewing => viewing.id)
      const distinctViewingIds = new Set(viewingIds)

      expect(distinctViewingIds.size).toBe(4)

      const watches = await client.query<MigratedEpisodeMark>(`SELECT id, user_id AS "userId", catalog_item_id AS "catalogItemId", catalog_episode_id AS "catalogEpisodeId", viewing_id AS "viewingId",
        to_char(marked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "markedAt", (get_byte(uuid_send(id), 6) >> 4) AS version
        FROM catalog_viewing_episode_watches WHERE user_id = ANY($1::uuid[]) ORDER BY marked_at`, [userIds])

      const actualMarks = watches.rows.map(watch => {
        return {
          userId: watch.userId,
          catalogItemId: watch.catalogItemId,
          catalogEpisodeId: watch.catalogEpisodeId,
          markedAt: watch.markedAt
        }
      })

      expect(actualMarks).toStrictEqual(expectedMarks)

      const watchVersions = watches.rows.map(watch => watch.version)

      expect(watchVersions).toStrictEqual([7, 7, 7, 7, 7, 7, 7])

      const actualWatchAssignments = watches.rows.map(watch => watch.viewingId)

      const expectedWatchAssignments = expectedMarks.map(mark => {
        const viewing = viewings.rows.find(candidate => {
          const sameViewing = candidate.userId === mark.userId && candidate.catalogItemId === mark.catalogItemId

          return sameViewing
        })

        return viewing?.id
      })

      expect(actualWatchAssignments).toStrictEqual(expectedWatchAssignments)

      const timeline = await client.query(`SELECT user_id AS "userId", catalog_item_id AS "catalogItemId", catalog_episode_id AS "catalogEpisodeId", kind,
        to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "occurredAt"
        FROM catalog_timeline_events WHERE user_id = ANY($1::uuid[]) ORDER BY occurred_at`, [userIds])

      const expectedTimeline: MigratedTimelineEvent[] = legacyMarks.map(mark => {
        return {
          userId: mark.userId,
          catalogItemId: mark.catalogItemId,
          catalogEpisodeId: mark.catalogEpisodeId,
          kind: 'episode_watched',
          occurredAt: mark.markedAt
        }
      })

      expectedTimeline.push({
        userId,
        catalogItemId: movieId,
        catalogEpisodeId: null,
        kind: 'movie_viewing',
        occurredAt: '2021-02-03T04:05:06.654321Z'
      })

      const orderedExpectedTimeline = expectedTimeline.toSorted((first, second) => {
        const order = first.occurredAt.localeCompare(second.occurredAt)

        return order
      })

      expect(timeline.rows).toStrictEqual(orderedExpectedTimeline)

      const ratings = await client.query<LegacyRating>('SELECT id, user_id AS "userId", catalog_item_id AS "catalogItemId", score FROM catalog_item_ratings WHERE user_id = ANY($1::uuid[]) ORDER BY id', [userIds])

      expect(ratings.rows).toStrictEqual(expectedRatings)

      const movies = await client.query('SELECT catalog_item_id FROM catalog_movie_watches WHERE user_id = $1', [userId])

      expect(movies.rows).toStrictEqual([{ catalog_item_id: movieId }])
      await client.query('UPDATE catalog_viewings SET status = \'completed\' WHERE user_id = ANY($1::uuid[]) AND catalog_item_id = ANY($2::uuid[])', [userIds, [seriesId, secondSeriesId]])

      const filteredMovies = await client.query('SELECT catalog_item_id FROM catalog_movie_watches WHERE user_id = $1', [userId])

      expect(filteredMovies.rows).toStrictEqual([{ catalog_item_id: movieId }])

      const legacyRead = await client.query<LegacyEpisodeMark>(`SELECT watches.user_id AS "userId", episodes.catalog_item_id AS "catalogItemId", watches.catalog_episode_id AS "catalogEpisodeId",
        to_char(watches.marked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "markedAt"
        FROM catalog_episode_watches watches JOIN catalog_episodes episodes ON episodes.id = watches.catalog_episode_id
        WHERE watches.user_id = ANY($1::uuid[]) ORDER BY watches.marked_at`, [userIds])

      expect(legacyRead.rows).toStrictEqual(expectedMarks)
      await expect(client.query('DELETE FROM catalog_episode_watches WHERE user_id = $1', [userId])).rejects.toMatchObject({ code: '55000' })
    } finally {
      await client.end()

      if (created) {
        const dropDatabaseQuery = `DROP DATABASE "${databaseName}" WITH (FORCE)`

        await admin.query(dropDatabaseQuery)
      }

      await admin.end()

      await rm(directory, {
        recursive: true,
        force: true
      })
    }
  })
})
