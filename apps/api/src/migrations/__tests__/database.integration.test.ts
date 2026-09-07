import { randomUUID } from 'node:crypto'
import { appendFile, cp, mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { createDatabase, type Database } from '@tv/database'
import { isLoopbackHostname } from '@tv/shared/network'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'
import { assert, describe, expect, it, vi } from 'vitest'
import { TURNSTILE_RESPONSE_FIELD } from '@tv/shared/turnstile'

// oxlint-disable-next-line import/no-namespace -- Spy on connection plumbing while running the real SQL and auth handlers.
import * as databaseAdapter from '../../database.ts'
import { createAuthApp } from '../../auth/routes.ts'
import { hashPassword, verifyPassword } from '../../auth/password.ts'
import { findPasswordCredential, findUserBySession } from '../../auth/repository.ts'
import { hashSessionToken } from '../../auth/session.ts'
import { assertDisposableTestDatabase } from '../../testing/test-database.ts'

const migrationsFolder = fileURLToPath(new URL('../../../../../packages/database/migrations', import.meta.url))
const migrationName = '20260907210039_minor_lucky_pierre'
const firstUserId = '90000000-0000-4000-8000-000000000001'
const secondUserId = '90000000-0000-4000-8000-000000000002'
const sessionToken = 'm'.repeat(43)
const password = 'Migration keeps this password working!'
const now = new Date('2026-09-07T12:00:00Z')

interface MigrationFixture {
  client: Client;
  database: Database;
  directory: string;
}

async function withDatabase(run: (fixture: MigrationFixture) => Promise<void>): Promise<void> {
  const adminUrl = new URL(env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://tv:tv@127.0.0.1:5433/postgres')

  if (!isLoopbackHostname(adminUrl.hostname)) {
    throw new Error('Migration tests require a loopback PostgreSQL server')
  }

  const name = `tv_test_${randomUUID().replaceAll('-', '')}`
  const databaseUrl = new URL(adminUrl)

  databaseUrl.pathname = `/${name}`

  const admin = new Client({ connectionString: adminUrl.toString() })
  const client = new Client({ connectionString: databaseUrl.toString() })
  const directory = await mkdtemp('/tmp/tv-migration-')
  let created = false

  try {
    await admin.connect()

    const version = await admin.query<{ server_version_num: string }>('SHOW server_version_num')

    expect(Number(version.rows[0]?.server_version_num)).toBeGreaterThanOrEqual(180_000)
    expect(Number(version.rows[0]?.server_version_num)).toBeLessThan(190_000)
    await admin.query(`CREATE DATABASE "${name}"`)

    created = true

    await client.connect()
    await assertDisposableTestDatabase(client)

    const database = createDatabase(client)

    await run({
      client,
      database,
      directory
    })
  } finally {
    await client.end()

    if (created) {
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    }

    await admin.end()

    await rm(directory, {
      recursive: true,
      force: true
    })
  }
}

async function prepareLegacy(fixture: MigrationFixture): Promise<void> {
  const previousFolder = join(fixture.directory, 'previous')
  const folders = await readdir(migrationsFolder)

  const copies = folders.filter(name => name < migrationName).map(async (folder) => {
    const source = join(migrationsFolder, folder)
    const target = join(previousFolder, folder)

    await cp(source, target, { recursive: true })
  })

  await Promise.all(copies)
  await migrate(fixture.database, { migrationsFolder: previousFolder })

  const firstHash = await hashPassword(password)
  const secondHash = await hashPassword('The second account keeps its own credential!')
  const tokenHash = await hashSessionToken(sessionToken)

  await fixture.client.query(`
    INSERT INTO users (id, email, created_at, updated_at) VALUES
      ($1, 'first@example.com', '2024-01-01', '2024-02-01'),
      ($2, 'second@example.com', '2025-01-01', '2025-02-01')
  `, [firstUserId, secondUserId])

  await fixture.client.query(`
    INSERT INTO password_credentials (user_id, password_hash, created_at, updated_at) VALUES
      ($1, $3, '2024-01-01', '2024-02-01'), ($2, $4, '2025-01-01', '2025-02-01')
  `, [firstUserId, secondUserId, firstHash, secondHash])

  await fixture.client.query(`
    INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES
      ('91000000-0000-4000-8000-000000000001', $1, $3, '2024-02-01', '2099-01-01'),
      ('91000000-0000-4000-8000-000000000002', $2, 'expired-token', '2025-02-01', '2025-03-01')
  `, [firstUserId, secondUserId, tokenHash])

  await fixture.client.query(`
    INSERT INTO email_verification_tokens (token_hash, email, redirect_to, expires_at)
    VALUES ('pending-mailbox-proof', 'pending@example.com', '/', '2099-01-01')
  `)
}

async function readAccountData(client: Client) {
  const accounts = await client.query(`
    SELECT email, u.created_at, u.updated_at, p.password_hash,
      p.created_at AS password_created, p.updated_at AS password_updated
    FROM users u JOIN password_credentials p ON p.user_id = u.id ORDER BY email
  `)

  const sessions = await client.query(`
    SELECT email, token_hash, s.created_at, expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id ORDER BY email
  `)

  const verifications = await client.query('SELECT * FROM email_verification_tokens ORDER BY token_hash')

  return {
    accounts: accounts.rows,
    sessions: sessions.rows,
    verifications: verifications.rows
  }
}

async function readIdentifiers(client: Client) {
  const result = await client.query<{ id: string; table_name: string; version: number }>(`
    SELECT 'catalog_items' AS table_name, id, uuid_extract_version(id) AS version FROM catalog_items
    UNION ALL SELECT 'users', id, uuid_extract_version(id) FROM users
    UNION ALL SELECT 'sessions', id, uuid_extract_version(id) FROM sessions
    ORDER BY table_name, id
  `)

  return result.rows
}

interface MigratedAccount {
  id: string;
  email: string;
}

interface AuthMigrationFixture {
  client: Client;
  database: Database;
  password: string;
  token: string;
  user: MigratedAccount;
}

async function verifyMigratedAuth(fixture: AuthMigrationFixture): Promise<void> {
  const connection = vi.spyOn(databaseAdapter, 'connectDatabaseAdapter').mockResolvedValue(fixture)
  const siteverify = vi.spyOn(globalThis, 'fetch').mockResolvedValue(globalThis.Response.json({ success: true }))

  const bindings = {
    DATABASE: { connectionString: 'uses-the-disposable-fixture-connection' },
    TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
    SIGN_IN_RATE_LIMITER: { limit: vi.fn<RateLimit['limit']>().mockResolvedValue({ success: true }) }
  }

  const app = createAuthApp()

  try {
    const restored = await app.request('https://tv-api.test/api/auth/session', {
      headers: { Cookie: `__Host-tv_session=${fixture.token}` }
    }, bindings)

    expect(restored.status).toBe(200)
    expect(restored.headers.get('set-cookie')).toBeNull()
    await expect(restored.json()).resolves.toStrictEqual({ user: fixture.user })

    const body = JSON.stringify({
      email: fixture.user.email,
      password: fixture.password,
      [TURNSTILE_RESPONSE_FIELD]: 'migration-test-proof'
    })

    const signedIn = await app.request('https://tv-api.test/api/auth/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    }, bindings)

    expect(signedIn.status).toBe(200)
    await expect(signedIn.json()).resolves.toStrictEqual({ user: fixture.user })
    expect(signedIn.headers.get('set-cookie')).toMatch(/^__Host-tv_session=[A-Za-z0-9_-]{43};/u)
  } finally {
    connection.mockRestore()
    siteverify.mockRestore()
  }
}

describe('persisted UUIDv7 and title metadata migration', () => {
  it('preserves populated accounts, credentials, session tokens and catalog associations', async () => {
    await withDatabase(async (fixture) => {
      await prepareLegacy(fixture)

      const before = await readAccountData(fixture.client)
      const oldIdentifiers = await readIdentifiers(fixture.client)

      const titlesBefore = await fixture.client.query(`
        SELECT locale, title, is_original, type, release_year
        FROM catalog_item_titles JOIN catalog_items ON catalog_item_id = id ORDER BY title, locale
      `)

      await migrate(fixture.database, { migrationsFolder })

      const after = await readAccountData(fixture.client)
      const identifiers = await readIdentifiers(fixture.client)

      const titlesAfter = await fixture.client.query(`
        SELECT locale, title, is_original, type, release_year
        FROM catalog_item_titles JOIN catalog_items ON catalog_item_id = id ORDER BY title, locale
      `)

      expect(after).toStrictEqual(before)
      expect(titlesAfter.rows).toStrictEqual(titlesBefore.rows)
      expect(identifiers).toHaveLength(oldIdentifiers.length)
      expect(identifiers.every(row => row.version === 7)).toBe(true)
      expect(identifiers.every(row => oldIdentifiers.every(old => old.id !== row.id))).toBe(true)

      const tokenHash = await hashSessionToken(sessionToken)
      const restored = await findUserBySession(fixture.database, tokenHash, now)
      const credential = await findPasswordCredential(fixture.database, 'first@example.com')

      expect(restored?.email).toBe('first@example.com')
      expect(restored?.id).not.toBe(firstUserId)
      expect(credential?.user).toStrictEqual(restored)
      expect(credential).not.toBeNull()
      assert(credential !== null, 'Migrated credential is missing')
      await expect(verifyPassword(password, credential.passwordHash)).resolves.toBe(true)
      await expect(verifyPassword('Wrong account password', credential.passwordHash)).resolves.toBe(false)

      const constraints = await fixture.client.query<{ condeferrable: boolean; condeferred: boolean; convalidated: boolean }>(`
        SELECT condeferrable, condeferred, convalidated FROM pg_constraint
        WHERE contype = 'f' AND connamespace = 'public'::regnamespace
      `)

      expect(constraints.rows).toHaveLength(3)

      for (const constraint of constraints.rows) {
        expect(constraint).toStrictEqual({
          condeferrable: false,
          condeferred: false,
          convalidated: true
        })
      }

      await migrate(fixture.database, { migrationsFolder })
      await expect(readIdentifiers(fixture.client)).resolves.toStrictEqual(identifiers)

      await verifyMigratedAuth({
        client: fixture.client,
        database: fixture.database,
        password,
        token: sessionToken,
        user: credential.user
      })
    })
  })

  it('creates a fresh catalog with twelve posters, translated descriptions and UUIDv7 defaults', async () => {
    await withDatabase(async (fixture) => {
      await migrate(fixture.database, { migrationsFolder })

      const items = await fixture.client.query<{ poster_path: string; version: number }>(`
        SELECT poster_path, uuid_extract_version(id) AS version FROM catalog_items
      `)

      const descriptions = await fixture.client.query<{ description: string; locale: string }>(`
        SELECT description, locale FROM catalog_item_titles WHERE locale IN ('en', 'ru')
      `)

      expect(items.rows).toHaveLength(12)

      for (const item of items.rows) {
        expect(item.version).toBe(7)
        expect(item.poster_path).toMatch(/^\/posters\/[a-z0-9-]+\.webp$/u)
      }

      expect(descriptions.rows).toHaveLength(24)
      expect(descriptions.rows.every(row => row.description.length > 80)).toBe(true)

      const inserted = await fixture.client.query<{ version: number }>(`
        WITH account AS (INSERT INTO users (email) VALUES ('default@example.com') RETURNING id),
        session AS (INSERT INTO sessions (user_id, token_hash, expires_at)
          SELECT id, 'default-token', '2099-01-01' FROM account RETURNING id),
        item AS (INSERT INTO catalog_items (type) VALUES ('movie') RETURNING id)
        SELECT uuid_extract_version(id) AS version FROM account
        UNION ALL SELECT uuid_extract_version(id) FROM session
        UNION ALL SELECT uuid_extract_version(id) FROM item
      `)

      expect(inserted.rows).toStrictEqual([{ version: 7 }, { version: 7 }, { version: 7 }])
    })
  })

  it('rolls back data, constraints, schema and migration history when a later statement fails', async () => {
    await withDatabase(async (fixture) => {
      await prepareLegacy(fixture)

      const before = await readAccountData(fixture.client)
      const identifiers = await readIdentifiers(fixture.client)
      const journal = await fixture.client.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')
      const failedFolder = join(fixture.directory, 'failed')

      await cp(migrationsFolder, failedFolder, { recursive: true })

      const failedMigration = join(failedFolder, migrationName, 'migration.sql')

      await appendFile(failedMigration, '\n--> statement-breakpoint\nSELECT 1 / 0;\n')
      await expect(migrate(fixture.database, { migrationsFolder: failedFolder })).rejects.toThrow('SELECT 1 / 0')
      await expect(readAccountData(fixture.client)).resolves.toStrictEqual(before)
      await expect(readIdentifiers(fixture.client)).resolves.toStrictEqual(identifiers)

      const journalAfter = await fixture.client.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')

      const columns = await fixture.client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name IN ('poster_path', 'description')
      `)

      expect(journalAfter.rows).toStrictEqual(journal.rows)
      expect(columns.rows).toStrictEqual([])
      await migrate(fixture.database, { migrationsFolder })

      const migrated = await readIdentifiers(fixture.client)

      expect(migrated.every(row => row.version === 7)).toBe(true)
    })
  })
})
