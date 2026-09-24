import { env } from 'cloudflare:workers'
import { Client } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { hashSessionToken } from '../../auth/session.ts'
import { connectDatabaseAdapter } from '../../database.ts'
import { assertDisposableTestDatabase } from '../../testing/test-database.ts'
import { createCatalogApp } from '../routes.ts'
import { withCatalogImportAccess } from '../session.ts'

const USER_ID = '40000000-0000-4000-8000-000000000062'
const OTHER_USER_ID = '40000000-0000-4000-8000-000000000063'
const TOKEN = 'p'.repeat(43)
const COOKIE = `__Host-tv_session=${TOKEN}`

async function importRequest(
  app: ReturnType<typeof createCatalogApp>,
  cookie?: string,
  claimedId = USER_ID
): Promise<Response> {
  const headers = new Headers()

  if (cookie !== undefined) {
    headers.set('Cookie', cookie)
  }

  const url = new URL('https://tv-api.test/api/catalog/test-import-access')

  url.searchParams.set('userId', claimedId)

  const response = await app.request(url.href, { headers }, env)

  return response
}

describe('catalog import access Worker contract', () => {
  it('checks the session user and current exact grant on every request', async () => {
    const client = new Client({ connectionString: env.DATABASE.connectionString })
    const app = createCatalogApp()
    let operationCount = 0

    app.get('/api/catalog/test-import-access', async (context) => {
      // oxlint-disable-next-line typescript/require-await -- The test operation records whether it was called.
      const userId = await withCatalogImportAccess(context, connectDatabaseAdapter, async (session) => {
        operationCount += 1

        return session.user.id
      })

      return context.json({ userId })
    })

    await client.connect()

    try {
      await assertDisposableTestDatabase(client)

      try {
        const tokenHash = await hashSessionToken(TOKEN)

        await client.query('DELETE FROM users WHERE id IN ($1, $2)', [USER_ID, OTHER_USER_ID])

        await client.query(`
          INSERT INTO users (id, email) VALUES
            ($1, 'permission-session@example.com'),
            ($2, 'permission-other@example.com')
        `, [USER_ID, OTHER_USER_ID])

        await client.query(`
          INSERT INTO sessions (user_id, token_hash, expires_at)
          VALUES ($1, $2, now() + interval '30 days')
        `, [USER_ID, tokenHash])

        await client.query(`
          INSERT INTO user_permissions (user_id, permission)
          VALUES ($1, 'catalog.manage'), ($2, 'catalog.view')
        `, [OTHER_USER_ID, USER_ID])

        const anonymous = await importRequest(app)

        expect(anonymous.status).toBe(401)
        expect(anonymous.headers.get('cache-control')).toBe('no-store')

        const denied = await importRequest(app, COOKIE, OTHER_USER_ID)

        expect(denied.status).toBe(403)

        await expect(denied.json()).resolves.toStrictEqual({
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have access to catalog imports.'
          }
        })

        await client.query(`
          INSERT INTO user_permissions (user_id, permission)
          VALUES ($1, 'catalog.manage')
        `, [USER_ID])

        const allowed = await importRequest(app, COOKIE, OTHER_USER_ID)

        expect(allowed.status).toBe(200)
        await expect(allowed.json()).resolves.toStrictEqual({ userId: USER_ID })

        await client.query(`
          DELETE FROM user_permissions WHERE user_id = $1 AND permission = 'catalog.manage'
        `, [USER_ID])

        const revoked = await importRequest(app, COOKIE, OTHER_USER_ID)

        expect(revoked.status).toBe(403)
        expect(operationCount).toBe(1)

        const log = vi.spyOn(console, 'error').mockImplementation(() => {
          // The response stays safe while the Worker log retains the database cause.
        })

        await client.query('ALTER TABLE user_permissions RENAME TO user_permissions_unavailable')

        try {
          const failed = await importRequest(app, COOKIE)

          expect(failed.status).toBe(503)

          await expect(failed.json()).resolves.toStrictEqual({
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: 'The catalog is temporarily unavailable.'
            }
          })

          expect(operationCount).toBe(1)

          const messages = log.mock.calls.map(([message]) => String(message)).join('\n')

          expect(messages).toContain('user_permissions')
          expect(messages).toContain('does not exist')
          expect(messages).toContain('requestId')
        } finally {
          await client.query('ALTER TABLE user_permissions_unavailable RENAME TO user_permissions')
          log.mockRestore()
        }
      } finally {
        await client.query('DELETE FROM users WHERE id IN ($1, $2)', [USER_ID, OTHER_USER_ID])
      }
    } finally {
      await client.end()
    }
  })
})
