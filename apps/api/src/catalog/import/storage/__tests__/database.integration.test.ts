import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { env } from 'node:process'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { movieResponse } from '../../../../testing/import-fixtures.ts'
import { assertDisposableTestDatabase } from '../../../../testing/test-database.ts'
import { deleteExpiredImportPreviews } from '../../repository.ts'
import { createImportPreview, openImportPreview, type ImportPreviewResult } from '../../service.ts'

function savedPreview(result: ImportPreviewResult) {
  if (result.status === 'source_failure') {
    throw new Error('Expected a saved preview')
  }

  return result.preview
}

describe('import preview database boundaries', () => {
  it('enforces owner access, the 24-hour limit and poster size, and bounds each cleanup invocation', async () => {
    const client = new Client({ connectionString: env.TEST_DATABASE_URL })
    const database = createDatabase(client)

    const user = {
      id: randomUUID(),
      email: 'preview-storage@example.com'
    }

    const otherUser = {
      id: randomUUID(),
      email: 'preview-other@example.com'
    }

    const session = {
      database,
      user
    }

    const now = new Date('2026-09-24T10:00:00Z')

    await client.connect()

    try {
      await assertDisposableTestDatabase(client)
      await client.query('INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)', [user.id, user.email, otherUser.id, otherUser.email])
      await client.query('INSERT INTO user_permissions (user_id, permission) VALUES ($1, \'catalog.manage\'), ($2, \'catalog.manage\')', [user.id, otherUser.id])

      const result = await createImportPreview(session, {
        type: 'movie',
        tmdbId: 603
      }, {
        token: 'test',
        now: () => now,
        fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json(movieResponse())),

        images: {
          info: vi.fn<ImagesBinding['info']>(),
          input: vi.fn<ImagesBinding['input']>()
        }
      })

      const preview = savedPreview(result)

      const otherSession = {
        database,
        user: otherUser
      }

      await expect(openImportPreview(otherSession, preview.id, now)).resolves.toBeNull()
      await expect(client.query('UPDATE catalog_import_previews SET expires_at = expires_at + interval \'1 second\' WHERE id = $1', [preview.id])).rejects.toMatchObject({ code: '23514' })

      const oversized = Buffer.alloc(1024 * 1024 + 1)

      await expect(client.query('UPDATE catalog_import_previews SET poster_bytes = $2, data = jsonb_set(data, \'{poster}\', \'{}\') WHERE id = $1', [preview.id, oversized])).rejects.toMatchObject({ code: '23514' })
      await client.query('DELETE FROM user_permissions WHERE user_id = $1', [user.id])
      await expect(openImportPreview(session, preview.id, now)).rejects.toMatchObject({ code: 'FORBIDDEN' })

      await client.query(`
        INSERT INTO catalog_import_previews (operator_id, status, selection, data, catalog_fingerprint, created_at, expires_at)
        SELECT operator_id, status, selection, data, catalog_fingerprint, created_at, expires_at
        FROM catalog_import_previews CROSS JOIN generate_series(1, 1000) WHERE id = $1
      `, [preview.id])

      await expect(deleteExpiredImportPreviews(database, preview.expiresAt)).resolves.toBe(1000)
      await expect(deleteExpiredImportPreviews(database, preview.expiresAt)).resolves.toBe(1)
    } finally {
      await client.query('DELETE FROM users WHERE id IN ($1, $2)', [user.id, otherUser.id])
      await client.end()
    }
  })
})
