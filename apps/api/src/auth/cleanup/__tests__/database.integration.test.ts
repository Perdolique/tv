import { env } from 'node:process'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { completeRegistration, deleteExpiredVerificationTokens, findValidVerificationToken } from '../../repository.ts'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'

const client = new Client({ connectionString: env.TEST_DATABASE_URL })
const database = createDatabase(client)
const now = new Date('2026-09-28T03:00:00Z')

async function seedExpiredTokens(count: number): Promise<void> {
  await client.query(`
    INSERT INTO email_verification_tokens (token_hash, email, redirect_to, expires_at)
    SELECT lpad(ordinal::text, 64, '0'), 'abandoned@example.com', '/watchlist',
      $2::timestamptz - ($1::integer - ordinal) * interval '1 second'
    FROM generate_series(1, $1::integer) AS ordinal
  `, [count, now])
}

describe('email verification retention', () => {
  beforeAll(async () => {
    await client.connect()
    await assertDisposableTestDatabase(client)
    await client.query('SET statement_timeout = \'5s\'')
  })

  beforeEach(async () => {
    await client.query('TRUNCATE TABLE email_verification_tokens, users CASCADE')
  })

  afterEach(async () => {
    await client.query('DROP TRIGGER IF EXISTS fail_verification_cleanup ON email_verification_tokens')
  })

  afterAll(async () => {
    await client.end()
  })

  it('removes expired and boundary rows while preserving live links and activation', async () => {
    await seedExpiredTokens(2)

    const firstHash = 'a'.repeat(64)
    const secondHash = 'b'.repeat(64)
    const email = 'active@example.com'

    await client.query(`
      INSERT INTO email_verification_tokens (token_hash, email, redirect_to, expires_at)
      VALUES ($1, $3, '/watchlist', $4::timestamptz + interval '1 hour'),
        ($2, $3, '/', $4::timestamptz + interval '1 millisecond')
    `, [firstHash, secondHash, email, now])

    await expect(deleteExpiredVerificationTokens(database, now)).resolves.toBe(2)

    const remaining = await client.query('SELECT token_hash FROM email_verification_tokens ORDER BY token_hash')

    expect(remaining.rows).toStrictEqual([
      { token_hash: firstHash },
      { token_hash: secondHash }
    ])

    await expect(findValidVerificationToken(database, secondHash, now)).resolves.toStrictEqual({
      email,
      redirectTo: '/'
    })

    await expect(completeRegistration(database, {
      email,
      passwordHash: 'test-password-hash',
      tokenHash: firstHash
    }, now)).resolves.toStrictEqual({
      email,
      redirectTo: '/watchlist'
    })

    const activation = await client.query(`
      SELECT
        (SELECT count(*)::integer FROM users WHERE email = $1) AS users,
        (SELECT count(*)::integer FROM password_credentials) AS credentials,
        (SELECT count(*)::integer FROM email_verification_tokens) AS tokens
    `, [email])

    expect(activation.rows).toStrictEqual([{
      users: 1,
      credentials: 1,
      tokens: 0
    }])

    await expect(findValidVerificationToken(database, secondHash, now)).resolves.toBeNull()
  })

  it('drains more than 1,000 expired rows in one run while keeping batches bounded', async () => {
    await seedExpiredTokens(1205)
    await expect(deleteExpiredVerificationTokens(database, now)).resolves.toBe(1205)
    await expect(deleteExpiredVerificationTokens(database, now)).resolves.toBe(0)

    const empty = await client.query('SELECT count(*)::integer AS count FROM email_verification_tokens')

    expect(empty.rows).toStrictEqual([{ count: 0 }])
  })

  it('commits the first batch, rolls back a failed second batch, and resumes safely', async () => {
    await seedExpiredTokens(201)

    await client.query(`
      CREATE FUNCTION pg_temp.fail_verification_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.token_hash = lpad('150', 64, '0') THEN
          RAISE EXCEPTION 'verification cleanup test failure';
        END IF;
        RETURN OLD;
      END
      $$;
      CREATE TRIGGER fail_verification_cleanup BEFORE DELETE ON email_verification_tokens
      FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_verification_cleanup();
    `)

    await expect(deleteExpiredVerificationTokens(database, now)).rejects.toMatchObject({
      cause: { message: 'verification cleanup test failure' }
    })

    const remaining = await client.query(`
      SELECT count(*)::integer AS count, min(token_hash) AS first
      FROM email_verification_tokens
    `)

    expect(remaining.rows).toStrictEqual([{
      count: 101,
      first: '101'.padStart(64, '0')
    }])

    await client.query('DROP TRIGGER fail_verification_cleanup ON email_verification_tokens')
    await expect(deleteExpiredVerificationTokens(database, now)).resolves.toBe(101)
  })

  it('skips locked expired rows and removes them on a later invocation', async () => {
    await seedExpiredTokens(2)

    const locker = new Client({ connectionString: env.TEST_DATABASE_URL })

    await locker.connect()

    try {
      await locker.query('BEGIN')
      await locker.query('SELECT token_hash FROM email_verification_tokens WHERE token_hash = lpad(\'1\', 64, \'0\') FOR UPDATE')
      await expect(deleteExpiredVerificationTokens(database, now)).resolves.toBe(1)

      const remaining = await client.query('SELECT token_hash FROM email_verification_tokens')

      expect(remaining.rows).toStrictEqual([{ token_hash: '1'.padStart(64, '0') }])
    } finally {
      await locker.query('ROLLBACK')
      await locker.end()
    }

    await expect(deleteExpiredVerificationTokens(database, now)).resolves.toBe(1)
  })
})
