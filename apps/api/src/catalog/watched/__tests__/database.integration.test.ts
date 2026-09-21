/* oxlint-disable eslint/max-lines -- Persistence, locking and trigger invariants share one disposable PostgreSQL fixture. */
import { env } from 'node:process'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { afterAll, assert, describe, expect, it } from 'vitest'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'

import {
  findCatalogItemWatchState,
  markCatalogMovieWatched,
  unmarkCatalogMovieWatched
} from '../../watched-repository.ts'

import { followCatalogItem } from '../../repository.ts'

const databaseUrl = env.TEST_DATABASE_URL

if (databaseUrl === undefined || databaseUrl === '') {
  throw new Error('TEST_DATABASE_URL is required for database integration tests')
}

const client = new Client({ connectionString: databaseUrl })

await client.connect()

async function findCatalogItemId(title: string): Promise<string> {
  const result = await client.query<{ id: string }>(`
    SELECT id FROM catalog_items JOIN catalog_item_titles ON catalog_item_id = id
    WHERE title = $1 AND is_original
  `, [title])

  const id = result.rows[0]?.id

  assert(id !== undefined, `${title} is missing from the seeded catalog`)

  return id
}

async function findMarkedAt(userId: string, catalogItemId: string): Promise<Date> {
  const result = await client.query<{ marked_at: Date }>(`
    SELECT marked_at FROM catalog_movie_watches
    WHERE user_id = $1 AND catalog_item_id = $2
  `, [userId, catalogItemId])

  const markedAt = result.rows[0]?.marked_at

  assert(markedAt !== undefined, 'The watched timestamp is missing')

  return markedAt
}

async function withDatabase<Result>(
  run: (database: ReturnType<typeof createDatabase>) => Promise<Result>
): Promise<Result> {
  const concurrentClient = new Client({ connectionString: databaseUrl })

  try {
    await concurrentClient.connect()

    return await run(createDatabase(concurrentClient))
  } finally {
    await concurrentClient.end()
  }
}

describe('postgreSQL catalog movie watches', () => {
  afterAll(async () => {
    await client.end()
  })

  it('keeps watched state private by account and independent from follows', async () => {
    await assertDisposableTestDatabase(client)

    const firstUserId = '50000000-0000-4000-8000-000000000001'
    const secondUserId = '50000000-0000-4000-8000-000000000002'
    const catalogItemId = await findCatalogItemId('Dead Man')
    const database = createDatabase(client)

    try {
      await client.query(`
        INSERT INTO users (id, email)
        VALUES ($1, 'first-watched@example.com'), ($2, 'second-watched@example.com')
      `, [firstUserId, secondUserId])

      await expect(markCatalogMovieWatched(database, firstUserId, catalogItemId)).resolves.toBe('marked')
      await expect(followCatalogItem(database, secondUserId, catalogItemId)).resolves.toBe(true)

      await expect(findCatalogItemWatchState(database, firstUserId, catalogItemId)).resolves.toStrictEqual({
        type: 'movie',
        watched: true
      })

      await expect(findCatalogItemWatchState(database, secondUserId, catalogItemId)).resolves.toStrictEqual({
        type: 'movie',
        watched: false
      })
    } finally {
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[firstUserId, secondUserId]])
    }
  })

  it('keeps concurrent marks idempotent and refreshes the timestamp only after unmarking', async () => {
    await assertDisposableTestDatabase(client)

    const userId = '50000000-0000-4000-8000-000000000001'
    const catalogItemId = await findCatalogItemId('Dead Man')
    const database = createDatabase(client)

    try {
      await client.query(`
        INSERT INTO users (id, email)
        VALUES ($1, 'idempotent-watched@example.com')
      `, [userId])

      await expect(markCatalogMovieWatched(database, userId, catalogItemId)).resolves.toBe('marked')

      const initialTimestamp = await findMarkedAt(userId, catalogItemId)

      await client.query('SELECT pg_sleep(0.01)')

      await expect(Promise.all([
        withDatabase(async concurrentDatabase => markCatalogMovieWatched(
          concurrentDatabase,
          userId,
          catalogItemId
        )),
        withDatabase(async concurrentDatabase => markCatalogMovieWatched(
          concurrentDatabase,
          userId,
          catalogItemId
        )),
        withDatabase(async concurrentDatabase => markCatalogMovieWatched(
          concurrentDatabase,
          userId,
          catalogItemId
        ))
      ])).resolves.toStrictEqual(['marked', 'marked', 'marked'])

      const repeatedTimestamp = await findMarkedAt(userId, catalogItemId)

      expect(repeatedTimestamp).toStrictEqual(initialTimestamp)
      await unmarkCatalogMovieWatched(database, userId, catalogItemId)
      await unmarkCatalogMovieWatched(database, userId, catalogItemId)
      await client.query('SELECT pg_sleep(0.01)')
      await expect(markCatalogMovieWatched(database, userId, catalogItemId)).resolves.toBe('marked')

      const renewedTimestamp = await findMarkedAt(userId, catalogItemId)

      expect(renewedTimestamp.getTime()).toBeGreaterThan(initialTimestamp.getTime())
    } finally {
      await client.query('DELETE FROM users WHERE id = $1', [userId])
    }
  })

  it('unmarks only the requested account and remains idempotent', async () => {
    await assertDisposableTestDatabase(client)

    const firstUserId = '50000000-0000-4000-8000-000000000001'
    const secondUserId = '50000000-0000-4000-8000-000000000002'
    const catalogItemId = await findCatalogItemId('Dead Man')
    const database = createDatabase(client)

    try {
      await client.query(`
        INSERT INTO users (id, email)
        VALUES ($1, 'first-unmark@example.com'), ($2, 'second-unmark@example.com')
      `, [firstUserId, secondUserId])

      await markCatalogMovieWatched(database, firstUserId, catalogItemId)
      await markCatalogMovieWatched(database, secondUserId, catalogItemId)
      await unmarkCatalogMovieWatched(database, firstUserId, catalogItemId)
      await unmarkCatalogMovieWatched(database, firstUserId, catalogItemId)

      await expect(findCatalogItemWatchState(database, firstUserId, catalogItemId)).resolves.toStrictEqual({
        type: 'movie',
        watched: false
      })

      await expect(findCatalogItemWatchState(database, secondUserId, catalogItemId)).resolves.toStrictEqual({
        type: 'movie',
        watched: true
      })
    } finally {
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[firstUserId, secondUserId]])
    }
  })

  it('rejects series and catalog items without original title metadata', async () => {
    await assertDisposableTestDatabase(client)

    const userId = '50000000-0000-4000-8000-000000000001'
    const untitledItemId = '50000000-0000-4000-8000-000000000003'
    const translatedOnlyItemId = '50000000-0000-4000-8000-000000000004'
    const seriesId = await findCatalogItemId('Spartacus')
    const database = createDatabase(client)

    try {
      await client.query(`
        INSERT INTO users (id, email)
        VALUES ($1, 'invalid-watched@example.com')
      `, [userId])

      await client.query(`
        INSERT INTO catalog_items (id, type)
        VALUES ($1, 'movie'), ($2, 'movie')
      `, [untitledItemId, translatedOnlyItemId])

      await client.query(`
        INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original)
        VALUES ($1, 'et', 'Ainult tõlge', false)
      `, [translatedOnlyItemId])

      await expect(findCatalogItemWatchState(database, userId, seriesId)).resolves.toStrictEqual({
        type: 'series',
        watched: false
      })

      await expect(markCatalogMovieWatched(database, userId, seriesId)).resolves.toBe('not-movie')

      const metadataResults = await Promise.all(
        [untitledItemId, translatedOnlyItemId].map(async (itemId) => {
          return {
            mark: await markCatalogMovieWatched(database, userId, itemId),
            state: await findCatalogItemWatchState(database, userId, itemId)
          }
        })
      )

      expect(metadataResults).toStrictEqual([
        {
          mark: 'not-found',
          state: null
        },
        {
          mark: 'not-found',
          state: null
        }
      ])
    } finally {
      await client.query('DELETE FROM users WHERE id = $1', [userId])
      await client.query('DELETE FROM catalog_items WHERE id = ANY($1::uuid[])', [[untitledItemId, translatedOnlyItemId]])
    }
  })

  it('cascades watched marks when either parent is deleted', async () => {
    await assertDisposableTestDatabase(client)

    const itemWatchUserId = '50000000-0000-4000-8000-000000000001'
    const userWatchUserId = '50000000-0000-4000-8000-000000000002'
    const disposableItemId = '50000000-0000-4000-8000-000000000003'
    const catalogItemId = await findCatalogItemId('Dead Man')
    const database = createDatabase(client)

    try {
      await client.query(`
        INSERT INTO users (id, email)
        VALUES ($1, 'item-watch-cascade@example.com'), ($2, 'user-watch-cascade@example.com')
      `, [itemWatchUserId, userWatchUserId])

      await client.query(`
        INSERT INTO catalog_items (id, type)
        VALUES ($1, 'movie')
      `, [disposableItemId])

      await client.query(`
        INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original)
        VALUES ($1, 'en', 'Watched cascade fixture', true)
      `, [disposableItemId])

      await markCatalogMovieWatched(database, itemWatchUserId, disposableItemId)
      await markCatalogMovieWatched(database, userWatchUserId, catalogItemId)
      await client.query('DELETE FROM catalog_items WHERE id = $1', [disposableItemId])

      const itemCascade = await client.query<{ count: string }>(`
        SELECT count(*) FROM catalog_movie_watches WHERE catalog_item_id = $1
      `, [disposableItemId])

      expect(itemCascade.rows[0]?.count).toBe('0')
      await client.query('DELETE FROM users WHERE id = $1', [userWatchUserId])

      const userCascade = await client.query<{ count: string }>(`
        SELECT count(*) FROM catalog_movie_watches WHERE user_id = $1
      `, [userWatchUserId])

      expect(userCascade.rows[0]?.count).toBe('0')
    } finally {
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[itemWatchUserId, userWatchUserId]])
      await client.query('DELETE FROM catalog_items WHERE id = $1', [disposableItemId])
    }
  })

  it('serializes mark creation with deletion of the required original title', async () => {
    await assertDisposableTestDatabase(client)

    const userId = '50000000-0000-4000-8000-000000000001'
    const catalogItemId = '50000000-0000-4000-8000-000000000003'
    const advisoryLockId = 480_048
    const deletionClient = new Client({ connectionString: databaseUrl })
    const database = createDatabase(client)

    try {
      await deletionClient.connect()

      await client.query(`
        INSERT INTO users (id, email)
        VALUES ($1, 'concurrent-title-watched@example.com')
      `, [userId])

      await client.query(`
        INSERT INTO catalog_items (id, type)
        VALUES ($1, 'movie')
      `, [catalogItemId])

      await client.query(`
        INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original)
        VALUES ($1, 'en', 'Concurrent title watched fixture', true)
      `, [catalogItemId])

      await client.query(`
        CREATE FUNCTION delay_catalog_movie_watch_insert() RETURNS trigger AS $$
        BEGIN
          PERFORM pg_advisory_xact_lock(0, ${advisoryLockId});
          PERFORM pg_sleep(0.5);
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `)

      await client.query(`
        CREATE TRIGGER delay_catalog_movie_watch_insert
        BEFORE INSERT ON catalog_movie_watches
        FOR EACH ROW EXECUTE FUNCTION delay_catalog_movie_watch_insert()
      `)

      const mark = markCatalogMovieWatched(database, userId, catalogItemId)

      await expect.poll(async () => {
        const locks = await deletionClient.query<{ locked: boolean }>(`
          SELECT EXISTS (
            SELECT FROM pg_locks
            WHERE locktype = 'advisory'
              AND classid = 0
              AND objid = $1
              AND granted
          ) AS locked
        `, [advisoryLockId])

        return locks.rows[0]?.locked
      }).toBe(true)

      const deletion = deletionClient.query(`
        DELETE FROM catalog_item_titles
        WHERE catalog_item_id = $1 AND is_original
      `, [catalogItemId])

      await expect(mark).resolves.toBe('marked')

      await deletion

      const remaining = await client.query<{ titles: string; watches: string }>(`
        SELECT
          (SELECT count(*) FROM catalog_item_titles WHERE catalog_item_id = $1)::text AS titles,
          (SELECT count(*) FROM catalog_movie_watches WHERE catalog_item_id = $1)::text AS watches
      `, [catalogItemId])

      expect(remaining.rows[0]).toStrictEqual({
        titles: '0',
        watches: '1'
      })
    } finally {
      await deletionClient.end()
      await client.query('DROP TRIGGER IF EXISTS delay_catalog_movie_watch_insert ON catalog_movie_watches')
      await client.query('DROP FUNCTION IF EXISTS delay_catalog_movie_watch_insert()')
      await client.query('DELETE FROM users WHERE id = $1', [userId])
      await client.query('DELETE FROM catalog_items WHERE id = $1', [catalogItemId])
    }
  })

  it('prevents direct series watches and later type changes for watched movies', async () => {
    await assertDisposableTestDatabase(client)

    const userId = '50000000-0000-4000-8000-000000000001'
    const movieId = '50000000-0000-4000-8000-000000000003'
    const seriesId = await findCatalogItemId('Spartacus')
    const database = createDatabase(client)

    try {
      await client.query(`
        INSERT INTO users (id, email)
        VALUES ($1, 'movie-invariant@example.com')
      `, [userId])

      await client.query(`
        INSERT INTO catalog_items (id, type)
        VALUES ($1, 'movie')
      `, [movieId])

      await client.query(`
        INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original)
        VALUES ($1, 'en', 'Movie invariant fixture', true)
      `, [movieId])

      await expect(client.query(`
        INSERT INTO catalog_movie_watches (user_id, catalog_item_id)
        VALUES ($1, $2)
      `, [userId, seriesId])).rejects.toMatchObject({ code: '23514' })

      await markCatalogMovieWatched(database, userId, movieId)

      await expect(client.query(`
        UPDATE catalog_items SET type = 'series' WHERE id = $1
      `, [movieId])).rejects.toMatchObject({ code: '23514' })

      const item = await client.query<{ type: string }>(`
        SELECT type FROM catalog_items WHERE id = $1
      `, [movieId])

      expect(item.rows[0]?.type).toBe('movie')
    } finally {
      await client.query('DELETE FROM users WHERE id = $1', [userId])
      await client.query('DELETE FROM catalog_items WHERE id = $1', [movieId])
    }
  })

  it('rejects a concurrent type change after a movie is marked', async () => {
    await assertDisposableTestDatabase(client)

    const userId = '50000000-0000-4000-8000-000000000001'
    const catalogItemId = '50000000-0000-4000-8000-000000000003'
    const advisoryLockId = 480_049
    const updateClient = new Client({ connectionString: databaseUrl })
    const database = createDatabase(client)

    try {
      await updateClient.connect()

      await client.query(`
        INSERT INTO users (id, email)
        VALUES ($1, 'concurrent-type-watched@example.com')
      `, [userId])

      await client.query(`
        INSERT INTO catalog_items (id, type)
        VALUES ($1, 'movie')
      `, [catalogItemId])

      await client.query(`
        INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original)
        VALUES ($1, 'en', 'Concurrent type watched fixture', true)
      `, [catalogItemId])

      await client.query(`
        CREATE FUNCTION delay_catalog_movie_type_watch_insert() RETURNS trigger AS $$
        BEGIN
          PERFORM pg_advisory_xact_lock(0, ${advisoryLockId});
          PERFORM pg_sleep(0.5);
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `)

      await client.query(`
        CREATE TRIGGER delay_catalog_movie_type_watch_insert
        BEFORE INSERT ON catalog_movie_watches
        FOR EACH ROW EXECUTE FUNCTION delay_catalog_movie_type_watch_insert()
      `)

      const mark = markCatalogMovieWatched(database, userId, catalogItemId)

      await expect.poll(async () => {
        const locks = await updateClient.query<{ locked: boolean }>(`
          SELECT EXISTS (
            SELECT FROM pg_locks
            WHERE locktype = 'advisory'
              AND classid = 0
              AND objid = $1
              AND granted
          ) AS locked
        `, [advisoryLockId])

        return locks.rows[0]?.locked
      }).toBe(true)

      const typeChange = updateClient.query(
        'UPDATE catalog_items SET type = \'series\' WHERE id = $1',
        [catalogItemId]
      )

      await expect(mark).resolves.toBe('marked')
      await expect(typeChange).rejects.toMatchObject({ code: '23514' })

      await expect(findCatalogItemWatchState(database, userId, catalogItemId)).resolves.toStrictEqual({
        type: 'movie',
        watched: true
      })
    } finally {
      await updateClient.end()
      await client.query('DROP TRIGGER IF EXISTS delay_catalog_movie_type_watch_insert ON catalog_movie_watches')
      await client.query('DROP FUNCTION IF EXISTS delay_catalog_movie_type_watch_insert()')
      await client.query('DELETE FROM users WHERE id = $1', [userId])
      await client.query('DELETE FROM catalog_items WHERE id = $1', [catalogItemId])
    }
  })
})
