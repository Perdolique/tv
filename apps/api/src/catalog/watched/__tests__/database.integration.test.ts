/* oxlint-disable eslint/max-lines -- Persistence, locking and trigger invariants share one disposable PostgreSQL fixture. */
import { env } from 'node:process'
import { randomUUID } from 'node:crypto'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { afterAll, assert, describe, expect, it } from 'vitest'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'
import { findCatalogItemWatchState } from '../../watched-repository.ts'

import {
  createMovieViewing,
  deleteMovieViewing,
  findMovieViewing,
  findMovieViewings,
  updateMovieViewing
} from '../../movie-viewings-repository.ts'

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

      await createMovieViewing(database, {
        userId: firstUserId,
        catalogItemId
      }, {
        requestId: randomUUID(),
        mode: 'current',
        contextVersion: 0,
        startedOn: null,
        completedOn: null
      })

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

  it('serializes current creations and replays a lost response without switching context', async () => {
    await assertDisposableTestDatabase(client)

    const userId = '50000000-0000-4000-8000-000000000001'
    const catalogItemId = await findCatalogItemId('Dead Man')

    const owner = {
      userId,
      catalogItemId
    }

    const database = createDatabase(client)

    const input = {
      requestId: randomUUID(),
      mode: 'current' as const,
      contextVersion: 0,
      startedOn: null,
      completedOn: null
    }

    try {
      await client.query('INSERT INTO users (id, email) VALUES ($1, \'races@example.com\')', [userId])

      const races = await Promise.allSettled([
        withDatabase( async db => createMovieViewing(db, owner, input)),
        withDatabase( async db => createMovieViewing(db, owner, {
          ...input,
          requestId: randomUUID()
        }))
      ])

      const winner = races.find(result => result.status === 'fulfilled')
      const loser = races.find(result => result.status === 'rejected')

      assert(winner?.status === 'fulfilled')

      expect(loser).toMatchObject({ reason: {
        code: 'CONFLICT',
        status: 409
      } })

      expect(winner.value.summary.completedCount).toBe(1)

      const historyInput = {
        requestId: randomUUID(),
        mode: 'history' as const,
        startedOn: '2020-01-01',
        completedOn: null
      }

      const history = await createMovieViewing(database, owner, historyInput)

      const secondInput = {
        ...input,
        requestId: randomUUID(),
        contextVersion: 1
      }

      const repeatedRaces = await Promise.allSettled([
        withDatabase( async db => createMovieViewing(db, owner, secondInput)),
        withDatabase( async db => createMovieViewing(db, owner, {
          ...secondInput,
          requestId: randomUUID()
        }))
      ])

      const second = repeatedRaces.find(result => result.status === 'fulfilled')

      assert(second?.status === 'fulfilled')

      const rejected = repeatedRaces.filter(result => result.status === 'rejected')

      expect(rejected).toHaveLength(1)

      const replay = await createMovieViewing(database, owner, historyInput)

      expect(replay.viewing).toStrictEqual(history.viewing)
      expect(replay.summary).toStrictEqual(second.value.summary)

      await expect(createMovieViewing(database, owner, {
        ...historyInput,
        startedOn: null
      })).rejects.toMatchObject({ status: 409 })

      await deleteMovieViewing(database, {
        ...owner,
        viewingId: history.viewing.id
      }, 1)

      await expect(createMovieViewing(database, owner, historyInput)).rejects.toMatchObject({ status: 409 })

      const page = await findMovieViewings(database, owner, null)

      expect(page.summary.completedCount).toBe(2)
    } finally {
      await client.query('DELETE FROM users WHERE id = $1', [userId])
    }
  })

  it('edits dates with revisions, preserves recording order and clears a deleted current context', async () => {
    await assertDisposableTestDatabase(client)

    const userId = '50000000-0000-4000-8000-000000000001'
    const otherId = '50000000-0000-4000-8000-000000000002'
    const catalogItemId = await findCatalogItemId('Dead Man')

    const owner = {
      userId,
      catalogItemId
    }

    const database = createDatabase(client)

    try {
      await client.query('INSERT INTO users (id, email) VALUES ($1, \'edits@example.com\'), ($2, \'private@example.com\')', [userId, otherId])

      const first = await createMovieViewing(database, owner, {
        requestId: randomUUID(),
        mode: 'current',
        contextVersion: 0,
        startedOn: null,
        completedOn: null
      })

      const second = await createMovieViewing(database, owner, {
        requestId: randomUUID(),
        mode: 'current',
        contextVersion: 1,
        startedOn: null,
        completedOn: null
      })

      const dates = {
        startedOn: '2020-02-29',
        completedOn: '2020-03-01',
        revision: 1
      }

      const edit = await updateMovieViewing(database, {
        ...owner,
        viewingId: first.viewing.id
      }, dates)

      const replay = await updateMovieViewing(database, {
        ...owner,
        viewingId: first.viewing.id
      }, dates)

      expect(edit.viewing.revision).toBe(2)
      expect(edit.viewing.recordedAt).toBe(first.viewing.recordedAt)
      expect(replay).toStrictEqual(edit)

      await expect(updateMovieViewing(database, {
        ...owner,
        viewingId: first.viewing.id
      }, {
        ...dates,
        completedOn: null
      })).rejects.toMatchObject({ status: 409 })

      await expect(deleteMovieViewing(database, {
        ...owner,
        viewingId: first.viewing.id
      }, 1)).rejects.toMatchObject({ status: 409 })

      await expect(findMovieViewing(database, {
        userId: otherId,
        catalogItemId
      }, first.viewing.id)).rejects.toMatchObject({ status: 404 })

      await expect(updateMovieViewing(database, {
        userId: otherId,
        catalogItemId,
        viewingId: first.viewing.id
      }, dates)).rejects.toMatchObject({ status: 404 })

      await deleteMovieViewing(database, {
        userId: otherId,
        catalogItemId,
        viewingId: first.viewing.id
      }, 2)

      const page = await findMovieViewings(database, owner, null)
      const ids = page.items.map(item => item.id)

      expect(ids).toStrictEqual([second.viewing.id, first.viewing.id])

      const removed = await deleteMovieViewing(database, {
        ...owner,
        viewingId: second.viewing.id
      }, 1)

      expect(removed).toStrictEqual({
        completedCount: 1,
        currentViewingId: null,
        contextVersion: 3
      })

      await expect(deleteMovieViewing(database, {
        ...owner,
        viewingId: second.viewing.id
      }, 1)).resolves.toStrictEqual(removed)
    } finally {
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId, otherId]])
    }
  })

  it('rolls back a reused key on another movie and enforces matching context ownership', async () => {
    await assertDisposableTestDatabase(client)

    const userId = '50000000-0000-4000-8000-000000000001'
    const otherId = '50000000-0000-4000-8000-000000000002'
    const movies = await client.query<{ id: string }>('SELECT id FROM catalog_items WHERE type = \'movie\' LIMIT 2')
    const [firstMovie, secondMovie] = movies.rows

    assert(firstMovie !== undefined)
    assert(secondMovie !== undefined)

    const database = createDatabase(client)

    const input = {
      requestId: randomUUID(),
      mode: 'current' as const,
      contextVersion: 0,
      startedOn: null,
      completedOn: null
    }

    try {
      await client.query('INSERT INTO users (id, email) VALUES ($1, \'rollback@example.com\'), ($2, \'foreign@example.com\')', [userId, otherId])

      const first = await createMovieViewing(database, {
        userId,
        catalogItemId: firstMovie.id
      }, input)

      await expect(createMovieViewing(database, {
        userId,
        catalogItemId: secondMovie.id
      }, input)).rejects.toMatchObject({ status: 409 })

      const second = await findMovieViewings(database, {
        userId,
        catalogItemId: secondMovie.id
      }, null)

      expect(second).toStrictEqual({
        items: [],
        nextCursor: null,

        summary: {
          completedCount: 0,
          currentViewingId: null,
          contextVersion: 0
        }
      })

      await expect(client.query('INSERT INTO catalog_viewing_contexts (user_id, catalog_item_id, current_viewing_id) VALUES ($1, $2, $3)', [otherId, firstMovie.id, first.viewing.id])).rejects.toMatchObject({ code: '23503' })
      await expect(client.query('INSERT INTO catalog_viewing_contexts (user_id, catalog_item_id, current_viewing_id) VALUES ($1, $2, $3)', [userId, secondMovie.id, first.viewing.id])).rejects.toMatchObject({ code: '23503' })
      await client.query(`CREATE FUNCTION fail_viewing_creation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced ledger failure'; END; $$ LANGUAGE plpgsql`)
      await client.query('CREATE TRIGGER fail_viewing_creation BEFORE INSERT ON catalog_viewing_creations FOR EACH ROW EXECUTE FUNCTION fail_viewing_creation()')

      await expect(createMovieViewing(database, {
        userId,
        catalogItemId: secondMovie.id
      }, {
        ...input,
        requestId: randomUUID()
      })).rejects.toThrow('Failed query')

      const rollback = await findMovieViewings(database, {
        userId,
        catalogItemId: secondMovie.id
      }, null)

      expect(rollback).toStrictEqual(second)
    } finally {
      await client.query('DROP TRIGGER IF EXISTS fail_viewing_creation ON catalog_viewing_creations')
      await client.query('DROP FUNCTION IF EXISTS fail_viewing_creation()')
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId, otherId]])
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

      await expect(createMovieViewing(database, {
        userId,
        catalogItemId: seriesId
      }, {
        requestId: randomUUID(),
        mode: 'history',
        startedOn: null,
        completedOn: null
      })).rejects.toMatchObject({ status: 400 })

      await Promise.all([untitledItemId, translatedOnlyItemId].map(async itemId => {
        await expect(createMovieViewing(database, {
          userId,
          catalogItemId: itemId
        }, {
          requestId: randomUUID(),
          mode: 'history',
          startedOn: null,
          completedOn: null
        })).rejects.toMatchObject({ status: 404 })

        await expect(findCatalogItemWatchState(database, userId, itemId)).resolves.toBeNull()
      }))
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

      await createMovieViewing(database, {
        userId: itemWatchUserId,
        catalogItemId: disposableItemId
      }, {
        requestId: randomUUID(),
        mode: 'current',
        contextVersion: 0,
        startedOn: null,
        completedOn: null
      })

      await createMovieViewing(database, {
        userId: userWatchUserId,
        catalogItemId
      }, {
        requestId: randomUUID(),
        mode: 'current',
        contextVersion: 0,
        startedOn: null,
        completedOn: null
      })

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
        BEFORE INSERT ON catalog_viewings
        FOR EACH ROW EXECUTE FUNCTION delay_catalog_movie_watch_insert()
      `)

      const mark = createMovieViewing(database, {
        userId,
        catalogItemId
      }, {
        requestId: randomUUID(),
        mode: 'current',
        contextVersion: 0,
        startedOn: null,
        completedOn: null
      })

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

      await expect(mark).resolves.toMatchObject({ summary: { completedCount: 1 } })

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
      await client.query('DROP TRIGGER IF EXISTS delay_catalog_movie_watch_insert ON catalog_viewings')
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
        INSERT INTO catalog_viewings (user_id, catalog_item_id)
        VALUES ($1, $2)
      `, [userId, seriesId])).rejects.toMatchObject({ code: '23514' })

      await createMovieViewing(database, {
        userId,
        catalogItemId: movieId
      }, {
        requestId: randomUUID(),
        mode: 'current',
        contextVersion: 0,
        startedOn: null,
        completedOn: null
      })

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
        BEFORE INSERT ON catalog_viewings
        FOR EACH ROW EXECUTE FUNCTION delay_catalog_movie_type_watch_insert()
      `)

      const mark = createMovieViewing(database, {
        userId,
        catalogItemId
      }, {
        requestId: randomUUID(),
        mode: 'current',
        contextVersion: 0,
        startedOn: null,
        completedOn: null
      })

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

      await expect(mark).resolves.toMatchObject({ summary: { completedCount: 1 } })
      await expect(typeChange).rejects.toMatchObject({ code: '23514' })

      await expect(findCatalogItemWatchState(database, userId, catalogItemId)).resolves.toStrictEqual({
        type: 'movie',
        watched: true
      })
    } finally {
      await updateClient.end()
      await client.query('DROP TRIGGER IF EXISTS delay_catalog_movie_type_watch_insert ON catalog_viewings')
      await client.query('DROP FUNCTION IF EXISTS delay_catalog_movie_type_watch_insert()')
      await client.query('DELETE FROM users WHERE id = $1', [userId])
      await client.query('DELETE FROM catalog_items WHERE id = $1', [catalogItemId])
    }
  })
})
