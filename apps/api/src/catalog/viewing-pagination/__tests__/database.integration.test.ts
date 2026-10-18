import { randomUUID } from 'node:crypto'
import { env } from 'node:process'
import { Client } from 'pg'
import { afterAll, afterEach, assert, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ratingFixture } from '../../../testing/rating-fixtures.ts'
import { findViewingHistory } from '../../viewing-repository.ts'
import { updateViewing } from '../../viewings-repository.ts'

const fixture = ratingFixture()
const { client, database, userId, movieId, seriesId } = fixture

const scope = {
  userId,
  status: null,
  titleLocale: 'en'
} as const

const extraSeriesIds = Array.from({ length: 21 }, () => randomUUID())

async function seedPages(): Promise<void> {
  await client.query(`INSERT INTO catalog_viewings (user_id, catalog_item_id, completed_on)
    SELECT $1, $2, '2026-09-22' FROM generate_series(1, 24)`, [userId, movieId])

  await client.query(`INSERT INTO catalog_viewings (user_id, catalog_item_id, status, started_on)
    SELECT $1, unnest($2::uuid[]), 'watching', '2026-01-01'::date`, [userId, extraSeriesIds])
}

describe('viewing history snapshot and state changes', () => {
  beforeAll(async () => {
    await fixture.setup()
    await client.query(`INSERT INTO catalog_items (id, type) SELECT unnest($1::uuid[]), 'series'`, [extraSeriesIds])

    await client.query(`INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original)
      SELECT unnest($1::uuid[]), 'en', 'Active series', true`, [extraSeriesIds])
  })

  beforeEach(fixture.reset)
  afterEach(() => { vi.restoreAllMocks() })

  afterAll(async () => {
    await client.query('DELETE FROM catalog_items WHERE id = ANY($1::uuid[])', [extraSeriesIds])
    await fixture.cleanup()
  })

  it.each([
    {
      status: 'watching',
      completedOn: null,
      nextStatus: 'completed',
      nextCompletedOn: '2026-10-01'
    },
    {
      status: 'completed',
      completedOn: '2026-01-02',
      nextStatus: 'watching',
      nextCompletedOn: null
    }
  ] as const)('invalidates the $status filter after an explicit state change but ignores catalog growth', async scenario => {
    await seedPages()

    const inserted = await client.query<{ id: string }>(`INSERT INTO catalog_viewings (user_id, catalog_item_id, status, started_on, completed_on)
      VALUES ($1, $2, $3, '2026-01-01', $4) RETURNING id`, [userId, seriesId, scenario.status, scenario.completedOn])

    const viewingId = inserted.rows[0]?.id

    assert(viewingId !== undefined)

    const filteredScope = {
      ...scope,
      status: scenario.status
    }

    const before = await findViewingHistory(database, filteredScope, null)
    const all = await findViewingHistory(database, scope, null)

    expect(before.nextCursor).not.toBeNull()

    await client.query(`INSERT INTO catalog_episodes (catalog_item_id, season_number, episode_number, air_date)
      VALUES ($1, 10, 99, '2026-10-01') ON CONFLICT DO NOTHING`, [seriesId])

    const unchanged = await findViewingHistory(database, scope, null)

    expect(unchanged).toStrictEqual(all)
    await expect(findViewingHistory(database, filteredScope, before.nextCursor)).resolves.toHaveProperty('items')

    await updateViewing(database, {
      userId,
      catalogItemId: seriesId,
      viewingId
    }, {
      requestId: randomUUID(),
      revision: 1,
      status: scenario.nextStatus,
      startedOn: '2026-01-01',
      completedOn: scenario.nextCompletedOn
    })

    await expect(findViewingHistory(database, scope, all.nextCursor)).rejects.toMatchObject({ status: 400 })
    await expect(findViewingHistory(database, filteredScope, before.nextCursor)).rejects.toMatchObject({ status: 400 })

    const refreshed = await findViewingHistory(database, {
      ...scope,
      status: scenario.nextStatus
    }, null)

    expect(refreshed.items.find(item => item.viewingId === viewingId)?.status).toBe(scenario.nextStatus)
  })

  it('reads page identities and their version in one snapshot across a concurrent date correction', async () => {
    await seedPages()

    const before = await findViewingHistory(database, scope, null)
    const [first] = before.items

    assert(first !== undefined)

    const writer = new Client({ connectionString: env.TEST_DATABASE_URL })
    const execute = database.execute.bind(database)

    await writer.connect()

    try {
      vi.spyOn(database, 'execute').mockImplementationOnce(<Row extends Record<string, unknown>>(query: Parameters<typeof database.execute>[0]) => {
        const statement = execute<Row>(query)
        const run = statement.execute.bind(statement)

        vi.spyOn(statement, 'execute').mockImplementationOnce(async () => {
          const result = await run()

          await writer.query('UPDATE catalog_viewings SET completed_on = \'2019-01-01\', revision = revision + 1 WHERE id = $1', [first.viewingId])

          return result
        })

        return statement
      })

      const snapshot = await findViewingHistory(database, scope, null)

      expect(snapshot).toStrictEqual(before)
      await expect(findViewingHistory(database, scope, snapshot.nextCursor)).rejects.toMatchObject({ status: 400 })

      const current = await findViewingHistory(database, scope, null)

      expect(current.items.map(item => item.viewingId)).not.toContain(first.viewingId)
    } finally {
      await writer.end()
    }
  })
})
