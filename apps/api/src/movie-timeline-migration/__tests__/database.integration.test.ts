/* oxlint-disable vitest/no-conditional-in-test -- The disposable migration fixture must guard cleanup and refuse remote PostgreSQL servers. */
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
const migrationName = '20261015123156_movie_timeline_invariant'

interface MovieTimelineEvent {
  id: string;
  viewingId: string;
  occurredAt: string;
}

async function movieEvents(client: Client, userId: string): Promise<MovieTimelineEvent[]> {
  const result = await client.query<MovieTimelineEvent>(`SELECT id, viewing_id AS "viewingId",
    to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "occurredAt"
    FROM catalog_timeline_events WHERE user_id = $1 AND kind = 'movie_viewing' ORDER BY occurred_at, id`, [userId])

  return result.rows
}

describe('movie timeline reconciliation migration', () => {
  it('repairs the deployment gap and keeps old and new writers idempotent without changing existing events', async () => {
    const adminUrl = new URL(env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://tv:tv@127.0.0.1:5433/postgres')
    const isLoopback = isLoopbackHostname(adminUrl.hostname)

    if (!isLoopback) { throw new Error('Migration tests require a loopback PostgreSQL server') }

    const databaseId = randomUUID()
    const suffix = databaseId.replaceAll('-', '')
    const databaseName = `tv_test_${suffix}`
    const databaseUrl = new URL(adminUrl)

    databaseUrl.pathname = `/${databaseName}`

    const adminConnectionString = adminUrl.toString()
    const connectionString = databaseUrl.toString()
    const admin = new Client({ connectionString: adminConnectionString })
    const client = new Client({ connectionString })
    const directory = await mkdtemp('/tmp/tv-movie-timeline-migration-')
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
      const earlierFolders = folders.filter(folder => folder < migrationName)

      const copies = earlierFolders.map(async folder => {
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
      const catalogItemId = randomUUID()

      await client.query('INSERT INTO users (id, email) VALUES ($1, \'movie-timeline-migration@example.com\')', [userId])
      await client.query('INSERT INTO catalog_items (id, type) VALUES ($1, \'movie\')', [catalogItemId])
      await client.query('INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original) VALUES ($1, \'en\', \'Movie timeline migration fixture\', true)', [catalogItemId])

      const existingViewingId = randomUUID()

      // Seed the historical writer's rows without calling code that requires later migrations.
      await client.query('BEGIN')
      await client.query('INSERT INTO catalog_viewings (id, user_id, catalog_item_id, recorded_at) VALUES ($1, $2, $3, \'2023-02-03 04:05:06.654321+00\')', [existingViewingId, userId, catalogItemId])
      await client.query('INSERT INTO catalog_timeline_events (user_id, catalog_item_id, kind, viewing_id, occurred_at) VALUES ($1, $2, \'movie_viewing\', $3, \'2023-02-03 04:05:06.654321+00\')', [userId, catalogItemId, existingViewingId])
      await client.query('COMMIT')

      const existingEvents = await movieEvents(client, userId)

      expect(existingEvents).toHaveLength(1)

      const gapViewingId = randomUUID()

      const gapInput = {
        requestId: randomUUID(),
        mode: 'history',
        startedOn: null,
        completedOn: '2026-10-17'
      }

      const gapInputJson = JSON.stringify(gapInput)

      // The deployed movie writer stores the viewing and retry key, without a timeline event.
      await client.query('BEGIN')
      await client.query('INSERT INTO catalog_viewings (id, user_id, catalog_item_id, recorded_at) VALUES ($1, $2, $3, \'2024-03-04 05:06:07.123456+00\')', [gapViewingId, userId, catalogItemId])
      await client.query('INSERT INTO catalog_viewing_creations (user_id, request_id, catalog_item_id, input, viewing_id) VALUES ($1, $2, $3, $4::jsonb, $5)', [userId, gapInput.requestId, catalogItemId, gapInputJson, gapViewingId])
      await client.query('COMMIT')

      const eventsDuringGap = await movieEvents(client, userId)

      expect(eventsDuringGap).toStrictEqual(existingEvents)
      await migrate(database, { migrationsFolder: afterFolder })

      const reconciled = await movieEvents(client, userId)
      const gapEvent = reconciled.find(event => event.viewingId === gapViewingId)

      expect(gapEvent).toMatchObject({
        viewingId: gapViewingId,
        occurredAt: '2024-03-04T05:06:07.123456Z'
      })

      expect(reconciled).toHaveLength(2)
      expect(reconciled).toContainEqual(existingEvents[0])

      const oldWriterViewingId = randomUUID()

      await client.query('INSERT INTO catalog_viewings (id, user_id, catalog_item_id, recorded_at) VALUES ($1, $2, $3, \'2025-04-05 06:07:08.654321+00\')', [oldWriterViewingId, userId, catalogItemId])

      const afterOldWriter = await movieEvents(client, userId)
      const oldWriterEvent = afterOldWriter.find(event => event.viewingId === oldWriterViewingId)

      expect(oldWriterEvent).toMatchObject({
        viewingId: oldWriterViewingId,
        occurredAt: '2025-04-05T06:07:08.654321Z'
      })

      expect(afterOldWriter).toHaveLength(3)

      const newWriterViewingId = randomUUID()

      // Reproduce the historical writer that inserts its event before the deferred trigger runs.
      await client.query('BEGIN')
      await client.query('INSERT INTO catalog_viewings (id, user_id, catalog_item_id, recorded_at) VALUES ($1, $2, $3, \'2026-04-05 06:07:08.654321+00\')', [newWriterViewingId, userId, catalogItemId])
      await client.query('INSERT INTO catalog_timeline_events (user_id, catalog_item_id, kind, viewing_id, occurred_at) VALUES ($1, $2, \'movie_viewing\', $3, \'2026-04-05 06:07:08.654321+00\')', [userId, catalogItemId, newWriterViewingId])
      await client.query('COMMIT')

      const afterNewWriter = await movieEvents(client, userId)
      const currentEvent = afterNewWriter.find(event => event.viewingId === newWriterViewingId)

      expect(currentEvent).toMatchObject({
        viewingId: newWriterViewingId,
        occurredAt: '2026-04-05T06:07:08.654321Z'
      })

      expect(afterNewWriter).toHaveLength(4)
      await migrate(database, { migrationsFolder: afterFolder })

      const eventsAfterRepeatMigration = await movieEvents(client, userId)

      expect(eventsAfterRepeatMigration).toStrictEqual(afterNewWriter)

      const deletedViewingId = randomUUID()

      await client.query('BEGIN')
      await client.query('INSERT INTO catalog_viewings (id, user_id, catalog_item_id) VALUES ($1, $2, $3)', [deletedViewingId, userId, catalogItemId])
      await client.query('DELETE FROM catalog_viewings WHERE id = $1', [deletedViewingId])
      await client.query('COMMIT')

      const eventsAfterSameTransactionDelete = await movieEvents(client, userId)

      expect(eventsAfterSameTransactionDelete).toStrictEqual(afterNewWriter)
      await client.query('DELETE FROM catalog_viewings WHERE id = $1', [oldWriterViewingId])

      const afterDelete = await movieEvents(client, userId)

      expect(afterDelete).toHaveLength(3)
      expect(afterDelete).not.toContainEqual(oldWriterEvent)
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
