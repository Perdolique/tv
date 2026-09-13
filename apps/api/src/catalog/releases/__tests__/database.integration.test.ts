import { env } from 'node:process'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { afterAll, assert, describe, expect, it } from 'vitest'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'
import { createCatalogReleaseItems } from '../../releases.ts'
import { findCatalogReleaseRows, followCatalogItem, unfollowCatalogItem } from '../../repository.ts'

const databaseUrl = env.TEST_DATABASE_URL

if (databaseUrl === undefined || databaseUrl === '') {
  throw new Error('TEST_DATABASE_URL is required for database integration tests')
}

const client = new Client({ connectionString: databaseUrl })

const testReleaseIds = [
  '60000000-0000-4000-8000-000000000011',
  '60000000-0000-4000-8000-000000000012',
  '60000000-0000-4000-8000-000000000013',
  '60000000-0000-4000-8000-000000000014',
  '60000000-0000-4000-8000-000000000015',
  '60000000-0000-4000-8000-000000000016',
  '60000000-0000-4000-8000-000000000017'
] as const

const americanHorrorStoryId = '10000000-0000-7000-8000-000000000013'
const percyJacksonId = '10000000-0000-7000-8000-000000000014'
const sunriseOnTheReapingId = '10000000-0000-7000-8000-000000000015'
const avengersDoomsdayId = '10000000-0000-7000-8000-000000000016'

const upcomingCatalogItemIds = [
  americanHorrorStoryId,
  percyJacksonId,
  sunriseOnTheReapingId,
  avengersDoomsdayId
] as const

interface SeededCatalogItem {
  id: string;
  releases: string[];
  releaseYear: number;
  title: string;
  type: 'movie' | 'series';
}

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

describe('postgreSQL catalog releases', () => {
  afterAll(async () => {
    await client.end()
  })

  it('seeds officially announced upcoming releases as distinct catalog items', async () => {
    await assertDisposableTestDatabase(client)

    const result = await client.query<SeededCatalogItem>(`
      SELECT
        item.id,
        item.type,
        item.release_year AS "releaseYear",
        title.title,
        array_agg(
          concat(
            release.release_date::text,
            CASE WHEN release.season_number IS NULL THEN '' ELSE ':S' || release.season_number END,
            CASE WHEN release.episode_number IS NULL THEN '' ELSE ':E' || release.episode_number END
          )
          ORDER BY release.release_date, release.episode_number NULLS LAST
        ) AS releases
      FROM catalog_items AS item
      INNER JOIN catalog_item_titles AS title
        ON title.catalog_item_id = item.id AND title.is_original
      INNER JOIN catalog_releases AS release ON release.catalog_item_id = item.id
      WHERE item.id = ANY($1::uuid[])
      GROUP BY item.id, item.type, item.release_year, title.title
      ORDER BY item.id
    `, [upcomingCatalogItemIds])

    const releaseIdentifiers = await client.query<{ id: string; version: number }>(`
      SELECT release.id, uuid_extract_version(release.id) AS version
      FROM catalog_releases AS release
      WHERE release.catalog_item_id = ANY($1::uuid[])
      ORDER BY release.id
    `, [upcomingCatalogItemIds])

    expect(releaseIdentifiers.rows).toHaveLength(16)
    expect(releaseIdentifiers.rows.every(release => release.version === 7)).toBe(true)

    expect(result.rows).toStrictEqual([
      {
        id: americanHorrorStoryId,

        releases: [
          '2026-09-24:S13:E1',
          '2026-09-24:S13:E2',
          '2026-09-24:S13:E3',
          '2026-10-01:S13:E4',
          '2026-10-01:S13:E5',
          '2026-10-01:S13:E6',
          '2026-10-08:S13:E7',
          '2026-10-08:S13:E8',
          '2026-10-15:S13:E9',
          '2026-10-15:S13:E10',
          '2026-10-22:S13:E11',
          '2026-10-22:S13:E12',
          '2026-10-29:S13:E13'
        ],

        releaseYear: 2011,
        title: 'American Horror Story',
        type: 'series'
      },
      {
        id: percyJacksonId,
        releases: ['2026-11-20:S3'],
        releaseYear: 2023,
        title: 'Percy Jackson and the Olympians',
        type: 'series'
      },
      {
        id: sunriseOnTheReapingId,
        releases: ['2026-11-20'],
        releaseYear: 2026,
        title: 'The Hunger Games: Sunrise on the Reaping',
        type: 'movie'
      },
      {
        id: avengersDoomsdayId,
        releases: ['2026-12-18'],
        releaseYear: 2026,
        title: 'Avengers: Doomsday',
        type: 'movie'
      }
    ])
  })

  it('returns separate localized releases for the current account in an inclusive stable range', async () => {
    await assertDisposableTestDatabase(client)

    const firstUserId = '60000000-0000-4000-8000-000000000001'
    const secondUserId = '60000000-0000-4000-8000-000000000002'
    const temporaryItemId = '60000000-0000-4000-8000-000000000003'
    const database = createDatabase(client)
    const duneId = await findCatalogItemId('Dune')
    const wireId = await findCatalogItemId('The Wire')
    const deadManId = await findCatalogItemId('Dead Man')
    const generatedReleaseIds: string[] = []

    try {
      await client.query(`
        INSERT INTO users (id, email)
        VALUES ($1, 'first-releases@example.com'), ($2, 'second-releases@example.com')
      `, [firstUserId, secondUserId])

      await client.query(`
        INSERT INTO catalog_item_follows (user_id, catalog_item_id)
        VALUES ($1, $3), ($1, $4), ($2, $5)
      `, [firstUserId, secondUserId, duneId, wireId, deadManId])

      const generated = await client.query<{ id: string; version: number }>(`
        INSERT INTO catalog_releases (catalog_item_id, release_date)
        VALUES ($1, '2026-10-01')
        RETURNING id, uuid_extract_version(id) AS version
      `, [duneId])

      const [generatedRelease] = generated.rows

      assert(generatedRelease !== undefined, 'Expected one generated release')
      generatedReleaseIds.push(generatedRelease.id)

      await client.query(`
        INSERT INTO catalog_releases (id, catalog_item_id, release_date, season_number, episode_number)
        VALUES
          ('60000000-0000-4000-8000-000000000011', $1, '2026-10-02', 3, 1),
          ('60000000-0000-4000-8000-000000000012', $1, '2026-10-02', 3, 2),
          ('60000000-0000-4000-8000-000000000013', $1, '2026-10-02', NULL, NULL),
          ('60000000-0000-4000-8000-000000000014', $2, '2026-10-02', NULL, NULL),
          ('60000000-0000-4000-8000-000000000015', $1, '2026-09-30', 2, 9),
          ('60000000-0000-4000-8000-000000000016', $1, '2026-10-03', 3, 3),
          ('60000000-0000-4000-8000-000000000017', $1, '2026-10-02', 2, 10)
      `, [wireId, deadManId])

      expect(generatedRelease.version).toBe(7)

      const constraints = await client.query<{ definition: string }>(`
        SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conname = 'catalog_releases_catalog_item_id_catalog_items_id_fkey'
      `)

      expect(constraints.rows).toStrictEqual([{
        definition: 'FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE CASCADE'
      }])

      const indexes = await client.query<{ indexdef: string; indexname: string }>(`
        SELECT indexdef, indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'catalog_releases'
        ORDER BY indexname
      `)

      expect(indexes.rows.map(index => index.indexname)).toStrictEqual([
        'catalog_releases_catalog_item_id_release_date_index',
        'catalog_releases_pkey'
      ])

      expect(indexes.rows[0]?.indexdef).toBe(
        'CREATE INDEX catalog_releases_catalog_item_id_release_date_index ON public.catalog_releases USING btree (catalog_item_id, release_date)'
      )

      const rows = await findCatalogReleaseRows(
        database,
        firstUserId,
        {
          from: '2026-10-01',
          to: '2026-10-02'
        }
      )

      const items = createCatalogReleaseItems(rows, 'ru-RU')

      expect(items).toHaveLength(5)

      expect(items.map(item => item.id)).toStrictEqual([
        duneId,
        wireId,
        wireId,
        wireId,
        wireId
      ])

      expect(items.slice(1).map(item => [item.seasonNumber, item.episodeNumber])).toStrictEqual([
        [2, 10],
        [3, 1],
        [3, 2],
        [null, null]
      ])

      expect(items[1]).toMatchObject({
        releaseDate: '2026-10-02',
        title: 'Прослушка',
        titleLocale: 'ru'
      })

      await unfollowCatalogItem(database, firstUserId, wireId)

      const afterUnfollow = await findCatalogReleaseRows(
        database,
        firstUserId,
        {
          from: '2026-10-01',
          to: '2026-10-02'
        }
      )

      expect(createCatalogReleaseItems(afterUnfollow, 'en')).toHaveLength(1)
      await expect(followCatalogItem(database, firstUserId, wireId)).resolves.toBe(true)

      const afterRefollow = await findCatalogReleaseRows(
        database,
        firstUserId,
        {
          from: '2026-10-01',
          to: '2026-10-02'
        }
      )

      expect(createCatalogReleaseItems(afterRefollow, 'en')).toHaveLength(5)

      await expect(findCatalogReleaseRows(database, firstUserId, {
        from: '2027-01-01',
        to: '2027-01-31'
      })).resolves.toStrictEqual([])

      await client.query('INSERT INTO catalog_items (id, type) VALUES ($1, \'movie\')', [temporaryItemId])

      await client.query(`
        INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original)
        VALUES ($1, 'en', 'Cascade release fixture', true)
      `, [temporaryItemId])

      await client.query(`
        INSERT INTO catalog_releases (catalog_item_id, release_date)
        VALUES ($1, '2026-10-02')
      `, [temporaryItemId])

      await client.query('DELETE FROM catalog_items WHERE id = $1', [temporaryItemId])

      const cascaded = await client.query<{ count: string }>(`
        SELECT count(*) FROM catalog_releases WHERE catalog_item_id = $1
      `, [temporaryItemId])

      expect(cascaded.rows[0]?.count).toBe('0')
    } finally {
      const releaseIds = [...testReleaseIds, ...generatedReleaseIds]

      await client.query('DELETE FROM catalog_releases WHERE id = ANY($1::uuid[])', [releaseIds])
      await client.query('DELETE FROM catalog_items WHERE id = $1', [temporaryItemId])
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[firstUserId, secondUserId]])
    }
  })
})
