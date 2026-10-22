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
const migrationName = '20261022174249_series-viewing-statuses'

async function diary(client: Client, userId: string) {
  return client.query(`SELECT jsonb_build_object(
    'account', (SELECT to_jsonb(row) FROM users row WHERE id=$1),
    'catalog', (SELECT jsonb_agg(to_jsonb(row) ORDER BY id) FROM catalog_items row WHERE id IN (SELECT catalog_item_id FROM catalog_viewings WHERE user_id=$1)),
    'viewings', (SELECT jsonb_agg(to_jsonb(row) ORDER BY id) FROM catalog_viewings row WHERE user_id=$1),
    'ratings', (SELECT jsonb_agg(to_jsonb(row) ORDER BY id) FROM catalog_item_ratings row WHERE user_id=$1),
    'votes', (SELECT jsonb_agg(to_jsonb(row) ORDER BY id) FROM catalog_rating_votes row WHERE user_id=$1),
    'marks', (SELECT jsonb_agg(to_jsonb(row) ORDER BY id) FROM catalog_viewing_episode_watches row WHERE user_id=$1),
    'events', (SELECT jsonb_agg(to_jsonb(row) ORDER BY id) FROM catalog_timeline_events row WHERE user_id=$1),
    'context', (SELECT jsonb_agg(to_jsonb(row) ORDER BY catalog_item_id) FROM catalog_viewing_contexts row WHERE user_id=$1),
    'follows', (SELECT jsonb_agg(to_jsonb(row) ORDER BY catalog_item_id) FROM catalog_item_follows row WHERE user_id=$1)
  ) AS data`, [userId])
}

describe('series pause and drop migration', () => {
  it('preserves a populated diary and enforces dates, movie states and one watching series', async () => {
    const adminUrl = new URL(env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://tv:tv@127.0.0.1:5433/postgres')

    if (!isLoopbackHostname(adminUrl.hostname)) { throw new Error('Migration tests require loopback PostgreSQL') }

    const databaseId = randomUUID()
    const suffix = databaseId.replaceAll('-', '')
    const databaseName = `tv_test_${suffix}`
    const databaseUrl = new URL(adminUrl)

    databaseUrl.pathname = `/${databaseName}`

    const adminConnectionString = adminUrl.toString()
    const connectionString = databaseUrl.toString()
    const admin = new Client({ connectionString: adminConnectionString })
    const client = new Client({ connectionString })
    const directory = await mkdtemp('/tmp/tv-series-status-migration-')
    let created = false

    try {
      await admin.connect()
      await admin.query(`CREATE DATABASE "${databaseName}"`)

      created = true

      await client.connect()
      await assertDisposableTestDatabase(client)

      const folders = await readdir(migrationsFolder)
      const earlier = folders.filter(folder => folder < migrationName)
      const beforeFolder = join(directory, 'before')

      const copies = earlier.map(async folder => {
        const source = join(migrationsFolder, folder)
        const target = join(beforeFolder, folder)

        await cp(source, target, { recursive: true })
      })

      await Promise.all(copies)

      const database = createDatabase(client)

      await migrate(database, { migrationsFolder: beforeFolder })

      const userId = randomUUID()
      const movieId = randomUUID()
      const seriesId = randomUUID()
      const movieViewingId = randomUUID()
      const seriesViewingId = randomUUID()
      const earlierViewingId = randomUUID()
      const episodeId = randomUUID()

      await client.query('INSERT INTO users (id,email) VALUES ($1,\'status-migration@example.com\')', [userId])
      await client.query('INSERT INTO catalog_items (id,type) VALUES ($1,\'movie\'),($2,\'series\')', [movieId, seriesId])

      await client.query(`INSERT INTO catalog_viewings (id,user_id,catalog_item_id,status,started_on,completed_on) VALUES
        ($1,$4,$5,'completed',NULL,'2026-01-02'),($2,$4,$6,'watching','2026-01-01',NULL),($3,$4,$6,'completed','2025-01-01','2025-01-02')`, [movieViewingId, seriesViewingId, earlierViewingId, userId, movieId, seriesId])

      await client.query('INSERT INTO catalog_episodes (id,catalog_item_id,season_number,episode_number,air_date) VALUES ($1,$2,1,1,\'2000-01-01\')', [episodeId, seriesId])
      await client.query('INSERT INTO catalog_viewing_episode_watches (user_id,catalog_item_id,viewing_id,catalog_episode_id) VALUES ($1,$2,$3,$4)', [userId, seriesId, seriesViewingId, episodeId])
      await client.query('INSERT INTO catalog_item_ratings (user_id,catalog_item_id,viewing_id,score) VALUES ($1,$2,$3,8)', [userId, movieId, movieViewingId])
      await client.query('INSERT INTO catalog_rating_votes (user_id,catalog_item_id,source_viewing_id,score) VALUES ($1,$2,$3,8)', [userId, movieId, movieViewingId])
      await client.query('INSERT INTO catalog_viewing_contexts (user_id,catalog_item_id,current_viewing_id,context_version) VALUES ($1,$2,$3,4)', [userId, seriesId, seriesViewingId])
      await client.query('INSERT INTO catalog_timeline_events (user_id,catalog_item_id,viewing_id,kind) VALUES ($1,$2,$3,\'series_started\')', [userId, seriesId, seriesViewingId])
      await client.query('INSERT INTO catalog_item_follows (user_id,catalog_item_id) VALUES ($1,$2)', [userId, seriesId])

      const before = await diary(client, userId)

      await migrate(database, { migrationsFolder })

      const after = await diary(client, userId)

      expect(after.rows).toStrictEqual(before.rows)
      await client.query('UPDATE catalog_viewings SET status=\'paused\' WHERE id=$1', [seriesViewingId])
      await client.query('UPDATE catalog_viewings SET status=\'dropped\' WHERE id=$1', [seriesViewingId])

      const invalidCompletion = client.query('UPDATE catalog_viewings SET completed_on=\'2026-01-03\' WHERE id=$1', [seriesViewingId])

      await expect(invalidCompletion).rejects.toMatchObject({ code: '23514' })

      const missingStart = client.query('UPDATE catalog_viewings SET started_on=NULL WHERE id=$1', [seriesViewingId])

      await expect(missingStart).rejects.toMatchObject({ code: '23514' })

      const pausedMovie = client.query('UPDATE catalog_viewings SET status=\'paused\',completed_on=NULL WHERE id=$1', [movieViewingId])

      await expect(pausedMovie).rejects.toMatchObject({ code: '23514' })

      const unknownStatus = client.query('UPDATE catalog_viewings SET status=\'unknown\' WHERE id=$1', [seriesViewingId])

      await expect(unknownStatus).rejects.toMatchObject({ code: '23514' })
      await client.query('UPDATE catalog_viewings SET status=\'watching\',completed_on=NULL WHERE id=$1', [earlierViewingId])

      const duplicateWatching = client.query('UPDATE catalog_viewings SET status=\'watching\' WHERE id=$1', [seriesViewingId])

      await expect(duplicateWatching).rejects.toMatchObject({
        code: '23505',
        constraint: 'catalog_viewings_one_watching_unique'
      })
    } finally {
      await client.end()

      if (created) { await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`) }

      await admin.end()

      await rm(directory, {
        recursive: true,
        force: true
      })
    }
  })
})
