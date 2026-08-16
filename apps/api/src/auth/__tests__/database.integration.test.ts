import { randomUUID } from 'node:crypto'
import { env } from 'node:process'
import { createDatabase } from '@tv/database'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'
import { afterAll, assert, beforeEach, describe, expect, it } from 'vitest'
import { createSession, registerUser } from '../repository.ts'
import { assertDisposableTestDatabase } from '../../testing/test-database.ts'

const databaseUrl = env.TEST_DATABASE_URL

if (databaseUrl === undefined || databaseUrl === '') {
  throw new Error('TEST_DATABASE_URL is required for database integration tests')
}

const migrationsFolder = new URL(
  '../../../../../packages/database/migrations',
  import.meta.url
).pathname

const client = new Client({ connectionString: databaseUrl })

await client.connect()

describe('postgreSQL auth schema', () => {
  beforeEach(async () => {
    await assertDisposableTestDatabase(client)
    await client.query('TRUNCATE TABLE users CASCADE')
  })

  afterAll(async () => {
    await client.end()
  })

  it('applies the migration to an empty database', async () => {
    const databaseName = `tv_migration_${randomUUID().replaceAll('-', '')}`
    const adminUrl = new URL(databaseUrl)
    const migrationUrl = new URL(databaseUrl)

    adminUrl.pathname = '/postgres'
    migrationUrl.pathname = `/${databaseName}`

    const adminClient = new Client({ connectionString: adminUrl.toString() })

    await adminClient.connect()

    try {
      await adminClient.query(`CREATE DATABASE "${databaseName}"`)

      const migrationClient = new Client({
        connectionString: migrationUrl.toString()
      })

      try {
        await migrationClient.connect()
        await migrate(createDatabase(migrationClient), { migrationsFolder })

        const tables = await migrationClient.query<{ table_name: string; }>(`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
          ORDER BY table_name
        `)

        const migrations = await migrationClient.query<{ name: string; }>(`
          SELECT name
          FROM drizzle.__drizzle_migrations
        `)

        expect(tables.rows.map((row) => row.table_name)).toStrictEqual([
          'password_credentials',
          'sessions',
          'users'
        ])
        expect(migrations.rows).toStrictEqual([
          { name: '20260810215442_ambiguous_shinobi_shaw' }
        ])
      } finally {
        await migrationClient.end()
      }
    } finally {
      await adminClient.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`)
      await adminClient.end()
    }
  })

  it('creates the required unique, lookup, expiry, and cascade constraints', async () => {
    const indexes = await client.query<{
      indexname: string;
      tablename: string;
    }>(`
      SELECT tablename, indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname
    `)

    const foreignKeys = await client.query<{
      confdeltype: string;
      conname: string;
    }>(`
      SELECT conname, confdeltype
      FROM pg_constraint
      WHERE contype = 'f'
      ORDER BY conname
    `)

    expect(indexes.rows).toStrictEqual(expect.arrayContaining([
      {
        indexname: 'sessions_expires_at_index',
        tablename: 'sessions'
      },
      {
        indexname: 'sessions_token_hash_unique',
        tablename: 'sessions'
      },
      {
        indexname: 'sessions_user_id_index',
        tablename: 'sessions'
      },
      {
        indexname: 'users_email_unique',
        tablename: 'users'
      }
    ]))
    expect(foreignKeys.rows).toStrictEqual([
      {
        confdeltype: 'c',
        conname: 'password_credentials_user_id_users_id_fkey'
      },
      {
        confdeltype: 'c',
        conname: 'sessions_user_id_users_id_fkey'
      }
    ])
  })

  it('cascades credentials and sessions when a user is deleted', async () => {
    const insertedUser = await client.query<{ id: string; }>(`
      INSERT INTO users (email)
      VALUES ('cascade@example.com')
      RETURNING id
    `)

    const userId = insertedUser.rows[0]?.id

    assert(userId !== undefined)

    await client.query(`
      INSERT INTO password_credentials (user_id, password_hash)
      VALUES ($1, 'hash')
    `, [userId])
    await client.query(`
      INSERT INTO sessions (user_id, token_hash, expires_at)
      VALUES ($1, $2, now() + interval '30 days')
    `, [userId, 'a'.repeat(64)])
    await client.query('DELETE FROM users WHERE id = $1', [userId])

    const childCounts = await client.query<{
      credentials: string;
      sessions: string;
    }>(`
      SELECT
        (SELECT count(*) FROM password_credentials) AS credentials,
        (SELECT count(*) FROM sessions) AS sessions
    `)

    expect(childCounts.rows[0]).toStrictEqual({
      credentials: '0',
      sessions: '0'
    })
  })

  it('accepts concurrent registration attempts as one account', async () => {
    const email = 'concurrent@example.com'
    const firstClient = new Client({ connectionString: databaseUrl })
    const secondClient = new Client({ connectionString: databaseUrl })

    await Promise.all([
      firstClient.connect(),
      secondClient.connect()
    ])

    try {
      await Promise.all([
        registerUser(createDatabase(firstClient), email, 'first-hash'),
        registerUser(createDatabase(secondClient), email, 'second-hash')
      ])
    } finally {
      await Promise.all([
        firstClient.end(),
        secondClient.end()
      ])
    }

    const accounts = await client.query<{
      credentials: string;
      users: string;
    }>(`
      SELECT
        (SELECT count(*) FROM users WHERE email = $1) AS users,
        (
          SELECT count(*)
          FROM password_credentials credentials
          INNER JOIN users ON users.id = credentials.user_id
          WHERE users.email = $1
        ) AS credentials
    `, [email])

    expect(accounts.rows[0]).toStrictEqual({
      credentials: '1',
      users: '1'
    })
  })

  it('replaces different expired sessions concurrently without deadlocking', async () => {
    const insertedUser = await client.query<{ id: string; }>(`
      INSERT INTO users (email)
      VALUES ('concurrent-sessions@example.com')
      RETURNING id
    `)

    const userId = insertedUser.rows[0]?.id

    assert(userId !== undefined)

    const firstExpiredTokenHash = 'a'.repeat(64)
    const secondExpiredTokenHash = 'b'.repeat(64)
    const firstNewTokenHash = 'c'.repeat(64)
    const secondNewTokenHash = 'd'.repeat(64)

    await client.query(`
      INSERT INTO sessions (user_id, token_hash, expires_at)
      VALUES
        ($1, $2, now() - interval '1 second'),
        ($1, $3, now() - interval '1 second')
    `, [userId, firstExpiredTokenHash, secondExpiredTokenHash])

    const firstClient = new Client({ connectionString: databaseUrl })
    const secondClient = new Client({ connectionString: databaseUrl })

    await Promise.all([
      firstClient.connect(),
      secondClient.connect()
    ])

    const now = new Date()
    const expiresAt = new Date(now.getTime() + 60_000)

    try {
      await Promise.all([
        createSession(createDatabase(firstClient), {
          currentTokenHash: firstExpiredTokenHash,
          expiresAt,
          tokenHash: firstNewTokenHash,
          userId
        }, now),
        createSession(createDatabase(secondClient), {
          currentTokenHash: secondExpiredTokenHash,
          expiresAt,
          tokenHash: secondNewTokenHash,
          userId
        }, now)
      ])
    } finally {
      await Promise.all([
        firstClient.end(),
        secondClient.end()
      ])
    }

    const sessionRows = await client.query<{ token_hash: string; }>(`
      SELECT token_hash
      FROM sessions
      ORDER BY token_hash
    `)

    expect(sessionRows.rows).toStrictEqual([
      { token_hash: firstNewTokenHash },
      { token_hash: secondNewTokenHash }
    ])
  })

  it('rolls back the user when credential insertion fails', async () => {
    const database = createDatabase(client)

    await expect(
      registerUser(database, 'rollback@example.com', 'x'.repeat(257))
    ).rejects.toThrow(/Failed query/u)

    const account = await client.query(`
      SELECT id
      FROM users
      WHERE email = 'rollback@example.com'
    `)

    expect(account.rowCount).toBe(0)
  })
})
