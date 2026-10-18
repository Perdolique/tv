/* oxlint-disable vitest/no-conditional-in-test -- Disposable migration databases need guarded cleanup. */
import { randomUUID } from 'node:crypto'
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises'
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
const migrationName = '20261017182636_movie-watched-dates'

describe('required movie viewing dates migration', () => {
  it('backfills only missing movie dates and prevents nulls after migration-first rollouts', async () => {
    const adminUrl = new URL(env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://tv:tv@127.0.0.1:5433/postgres')
    const isLoopback = isLoopbackHostname(adminUrl.hostname)

    if (!isLoopback) { throw new Error('Migration tests require loopback PostgreSQL') }

    const databaseId = randomUUID()
    const suffix = databaseId.replaceAll('-', '')
    const databaseName = `tv_test_${suffix}`
    const databaseUrl = new URL(adminUrl)

    databaseUrl.pathname = `/${databaseName}`

    const adminConnectionString = adminUrl.toString()
    const connectionString = databaseUrl.toString()
    const admin = new Client({ connectionString: adminConnectionString })
    const client = new Client({ connectionString })
    const directory = await mkdtemp('/tmp/tv-viewing-dates-migration-')
    let created = false

    try {
      await admin.connect()

      const createQuery = `CREATE DATABASE "${databaseName}"`

      await admin.query(createQuery)

      created = true

      await client.connect()
      await assertDisposableTestDatabase(client)

      const beforeFolder = join(directory, 'before')
      const folders = await readdir(migrationsFolder)
      const earlier = folders.filter(folder => folder < migrationName)

      const copies = earlier.map(async folder => {
        const source = join(migrationsFolder, folder)
        const target = join(beforeFolder, folder)

        await cp(source, target, { recursive: true })
      })

      await Promise.all(copies)

      const afterFolder = join(directory, 'after')
      const applicableFolders = folders.filter(folder => folder <= migrationName)

      const finalCopies = applicableFolders.map(async folder => {
        const source = join(migrationsFolder, folder)
        const target = join(afterFolder, folder)

        await cp(source, target, { recursive: true })
      })

      await Promise.all(finalCopies)

      const database = createDatabase(client)

      await migrate(database, { migrationsFolder: beforeFolder })

      const userId = randomUUID()
      const movieId = randomUUID()
      const seriesId = randomUUID()

      await client.query('INSERT INTO users (id, email) VALUES ($1, \'viewing-date-migration@example.com\')', [userId])
      await client.query('INSERT INTO catalog_items (id, type) VALUES ($1, \'movie\'), ($2, \'series\')', [movieId, seriesId])
      await client.query('SET TIME ZONE \'Pacific/Honolulu\'')

      await client.query(`
        INSERT INTO catalog_viewings (user_id, catalog_item_id, started_on, completed_on, recorded_at)
        VALUES ($1, $2, null, null, '2024-02-03T01:00:00.123456Z'),
          ($1, $2, '2020-02-29', null, '2024-03-04T01:00:00Z'),
          ($1, $2, '2019-01-01', '2019-01-02', '2024-04-05T01:00:00Z'),
          ($1, $3, null, null, '2024-02-03T01:00:00Z')
      `, [userId, movieId, seriesId])

      const original = await client.query<{ id: string; recorded: string }>('SELECT id, recorded_at::text AS recorded FROM catalog_viewings WHERE user_id = $1 ORDER BY recorded_at, id', [userId])
      const movie = await client.query<{ id: string }>('SELECT id FROM catalog_viewings WHERE user_id = $1 AND catalog_item_id = $2 ORDER BY recorded_at LIMIT 1', [userId, movieId])
      const movieViewingId = movie.rows[0]?.id

      await client.query('INSERT INTO catalog_item_ratings (user_id, catalog_item_id, viewing_id, score) VALUES ($1, $2, $3, 8)', [userId, movieId, movieViewingId])
      await client.query('INSERT INTO catalog_viewing_contexts (user_id, catalog_item_id, current_viewing_id, context_version) VALUES ($1, $2, $3, 4)', [userId, movieId, movieViewingId])
      await migrate(database, { migrationsFolder: afterFolder })

      const dates = await client.query<{ completed: string | null }>('SELECT completed_on::text AS completed FROM catalog_viewings WHERE user_id = $1 AND catalog_item_id = $2 ORDER BY recorded_at', [userId, movieId])

      expect(dates.rows).toStrictEqual([{ completed: '2024-02-03' }, { completed: '2020-02-29' }, { completed: '2019-01-02' }])

      const unchanged = await client.query('SELECT id, recorded_at::text AS recorded FROM catalog_viewings WHERE user_id = $1 ORDER BY recorded_at, id', [userId])
      const series = await client.query('SELECT completed_on FROM catalog_viewings WHERE user_id = $1 AND catalog_item_id = $2', [userId, seriesId])
      const context = await client.query('SELECT current_viewing_id, context_version FROM catalog_viewing_contexts WHERE user_id = $1', [userId])
      const ratings = await client.query('SELECT viewing_id, score FROM catalog_item_ratings WHERE user_id = $1', [userId])

      expect(unchanged.rows).toStrictEqual(original.rows)
      expect(series.rows).toStrictEqual([{ completed_on: null }])

      expect(context.rows).toStrictEqual([{
        current_viewing_id: movieViewingId,
        context_version: 4
      }])

      expect(ratings.rows).toStrictEqual([{
        viewing_id: movieViewingId,
        score: 8
      }])

      const legacy = await client.query<{ id: string; completed: string }>('INSERT INTO catalog_viewings (user_id, catalog_item_id, recorded_at) VALUES ($1, $2, \'2025-06-07T01:00:00Z\') RETURNING id, completed_on::text AS completed', [userId, movieId])

      expect(legacy.rows[0]?.completed).toBe('2025-06-07')

      const clearing = client.query('UPDATE catalog_viewings SET completed_on = null WHERE id = $1', [legacy.rows[0]?.id])

      await expect(clearing).rejects.toMatchObject({
        code: '23514',
        constraint: 'catalog_viewings_movie_watched_date'
      })

      await migrate(database, { migrationsFolder: afterFolder })
    } finally {
      await client.end()

      if (created) {
        const dropQuery = `DROP DATABASE "${databaseName}" WITH (FORCE)`

        await admin.query(dropQuery)
      }

      await admin.end()

      await rm(directory, {
        recursive: true,
        force: true
      })
    }
  })
})
