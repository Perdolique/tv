import { randomUUID } from 'node:crypto'
import { env } from 'node:process'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { describe, expect, it } from 'vitest'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'
import { hasCatalogImportPermission } from '../../permissions.ts'

describe('catalog import permissions', () => {
  it('starts empty, grants exact codes to multiple users, and supports revoke and cascade', async () => {
    const client = new Client({ connectionString: env.TEST_DATABASE_URL })
    const firstUserId = randomUUID()
    const secondUserId = randomUUID()

    await client.connect()

    try {
      await assertDisposableTestDatabase(client)

      try {
        const database = createDatabase(client)

        await client.query(`
          INSERT INTO users (id, email) VALUES
            ($1, 'first-permission@example.com'),
            ($2, 'second-permission@example.com')
        `, [firstUserId, secondUserId])

        await expect(hasCatalogImportPermission(database, firstUserId)).resolves.toBe(false)
        await expect(hasCatalogImportPermission(database, secondUserId)).resolves.toBe(false)

        await client.query(`
          INSERT INTO user_permissions (user_id, permission)
          VALUES ($1, 'catalog.view')
        `, [firstUserId])

        await expect(hasCatalogImportPermission(database, firstUserId)).resolves.toBe(false)

        await client.query(`
          INSERT INTO user_permissions (user_id, permission)
          VALUES ($1, 'catalog.manage'), ($2, 'catalog.manage')
          ON CONFLICT (user_id, permission) DO NOTHING
        `, [firstUserId, secondUserId])

        await client.query(`
          INSERT INTO user_permissions (user_id, permission)
          VALUES ($1, 'catalog.manage')
          ON CONFLICT (user_id, permission) DO NOTHING
        `, [firstUserId])

        const grants = await client.query<{ user_id: string }>(`
          SELECT user_id FROM user_permissions WHERE permission = 'catalog.manage'
          AND user_id IN ($1, $2)
        `, [firstUserId, secondUserId])

        expect(grants.rows).toHaveLength(2)
        await expect(hasCatalogImportPermission(database, firstUserId)).resolves.toBe(true)
        await expect(hasCatalogImportPermission(database, secondUserId)).resolves.toBe(true)

        await client.query(`
          DELETE FROM user_permissions WHERE user_id = $1 AND permission = 'catalog.manage'
        `, [firstUserId])

        await expect(hasCatalogImportPermission(database, firstUserId)).resolves.toBe(false)
        await expect(hasCatalogImportPermission(database, secondUserId)).resolves.toBe(true)
        await client.query('DELETE FROM users WHERE id = $1', [secondUserId])

        const orphanedGrants = await client.query(`
          SELECT 1 FROM user_permissions WHERE user_id = $1
        `, [secondUserId])

        expect(orphanedGrants.rows).toHaveLength(0)
      } finally {
        await client.query('DELETE FROM users WHERE id IN ($1, $2)', [firstUserId, secondUserId])
      }
    } finally {
      await client.end()
    }
  })
})
