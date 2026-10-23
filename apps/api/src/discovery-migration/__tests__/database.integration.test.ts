/* oxlint-disable vitest/no-conditional-in-test -- Disposable migration setup needs guarded cleanup and an explicit migration boundary. */
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

const migrationName = '20261022195616_catalog_discovery'
const migrationsUrl = new URL('../../../../../packages/database/migrations', import.meta.url)
const migrationsFolder = fileURLToPath(migrationsUrl)

describe('catalog discovery migration', () => {
  it('backfills only confirmed first creations and preserves existing catalog, accounts and follows', async () => {
    const adminConnectionString = env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://tv:tv@127.0.0.1:5433/postgres'
    const adminUrl = new URL(adminConnectionString)

    if (!isLoopbackHostname(adminUrl.hostname)) { throw new Error('Migration tests require loopback PostgreSQL') }

    const randomId = randomUUID()
    const databaseSuffix = randomId.replaceAll('-', '')
    const name = `tv_test_${databaseSuffix}`
    const databaseUrl = new URL(adminUrl)

    databaseUrl.pathname = `/${name}`

    const admin = new Client({ connectionString: adminUrl.href })
    const client = new Client({ connectionString: databaseUrl.href })
    const directory = await mkdtemp('/tmp/tv-discovery-migration-')
    let created = false

    try {
      await admin.connect()
      await admin.query(`CREATE DATABASE "${name}"`)

      created = true

      await client.connect()
      await assertDisposableTestDatabase(client)

      const before = join(directory, 'before')
      const after = join(directory, 'after')
      const folders = await readdir(migrationsFolder)
      const relevantFolders = folders.filter(entry => entry <= migrationName)

      const copies = relevantFolders.map(async folder => {
        const source = join(migrationsFolder, folder)
        const afterTarget = join(after, folder)

        await cp(source, afterTarget, { recursive: true })

        if (folder < migrationName) {
          const beforeTarget = join(before, folder)

          await cp(source, beforeTarget, { recursive: true })
        }
      })

      await Promise.all(copies)

      const database = createDatabase(client)

      await migrate(database, { migrationsFolder: before })

      const userId = randomUUID()
      const importedId = randomUUID()
      const unknownId = randomUUID()

      await client.query('INSERT INTO users(id,email) VALUES ($1,\'discovery-migration@example.com\')', [userId])
      await client.query('INSERT INTO catalog_items(id,type) VALUES ($1,\'movie\'),($2,\'series\')', [importedId,unknownId])
      await client.query('INSERT INTO catalog_item_titles(catalog_item_id,locale,title,is_original) VALUES ($1,\'en\',\'Imported movie\',true),($2,\'en\',\'Older series\',true)', [importedId,unknownId])
      await client.query('INSERT INTO catalog_item_follows(user_id,catalog_item_id) VALUES ($1,$2)', [userId,importedId])

      const operations = [
        [importedId,true,'2026-01-02T03:04:05Z'],
        [importedId,false,'2026-03-04T05:06:07Z'],
        [importedId,true,'2026-02-03T04:05:06Z'],
        [unknownId,false,'2026-01-01T00:00:00Z']
      ] as const

      for (const [itemId, createdItem, finishedAt] of operations) {
        const result = JSON.stringify({
          catalogItemId: itemId,
          createdItem
        })

        const previewId = randomUUID()

        // oxlint-disable-next-line eslint/no-await-in-loop -- Migration fixtures share one pg connection.
        await client.query(`INSERT INTO catalog_import_operations(preview_id,operator_id,selection,title,status,started_at,finished_at,result)
        VALUES ($1,$2,'{}','Migration fixture','succeeded',$3,$3,$4::jsonb)`, [previewId, userId, finishedAt, result])
      }

      const original = await client.query('SELECT id,type,release_year,poster_path FROM catalog_items ORDER BY id')

      await migrate(database, { migrationsFolder: after })

      const migrated = await client.query<{ id: string; added_at: Date | null }>('SELECT id,added_at FROM catalog_items WHERE id=ANY($1::uuid[]) ORDER BY id', [[importedId,unknownId]])
      const imported = migrated.rows.find(row => row.id === importedId)
      const unknown = migrated.rows.find(row => row.id === unknownId)
      const importedAt = imported?.added_at?.toISOString()

      expect(importedAt).toBe('2026-01-02T03:04:05.000Z')
      expect(unknown?.added_at).toBeNull()

      const retained = await client.query('SELECT id,type,release_year,poster_path FROM catalog_items ORDER BY id')

      expect(retained.rows).toStrictEqual(original.rows)

      const follows = await client.query('SELECT catalog_item_id FROM catalog_item_follows WHERE user_id=$1', [userId])

      expect(follows.rows).toStrictEqual([{ catalog_item_id: importedId }])

      const accounts = await client.query('SELECT email FROM users WHERE id=$1', [userId])

      expect(accounts.rows).toStrictEqual([{ email: 'discovery-migration@example.com' }])

      const added = await client.query<{ added_at: Date }>('INSERT INTO catalog_items(type) VALUES (\'movie\') RETURNING added_at')

      expect(added.rows[0]?.added_at).toBeInstanceOf(Date)
      await migrate(database, { migrationsFolder: after })
    } finally {
      await client.end()

      if (created) { await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`) }

      await admin.end()

      await rm(directory, {
        recursive: true,
        force: true
      })
    }
  })
})
