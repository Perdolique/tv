import { env } from 'node:process'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { afterAll, assert, describe, expect, it } from 'vitest'
import { assertDisposableTestDatabase } from '../../testing/test-database.ts'
import { findTitleRowsForMatchingCatalogItems } from '../repository.ts'
import { createCatalogSearchItems } from '../search.ts'

const databaseUrl = env.TEST_DATABASE_URL

if (databaseUrl === undefined || databaseUrl === '') {
  throw new Error('TEST_DATABASE_URL is required for database integration tests')
}

const client = new Client({ connectionString: databaseUrl })

await client.connect()

describe('postgreSQL catalog schema and search', () => {
  afterAll(async () => {
    await client.end()
  })

  it('contains the selected catalog with one original title per item', async () => {
    const counts = await client.query<{
      items: string;
      movies: string;
      originals: string;
      series: string;
      titles: string;
    }>(`
      SELECT
        count(*) AS items,
        count(*) FILTER (WHERE type = 'movie') AS movies,
        count(*) FILTER (WHERE type = 'series') AS series,
        (SELECT count(*) FROM catalog_item_titles) AS titles,
        (
          SELECT count(*)
          FROM catalog_item_titles
          WHERE is_original
        ) AS originals
      FROM catalog_items
    `)

    const originalCounts = await client.query<{
      catalog_item_id: string;
      originals: string;
    }>(`
      SELECT catalog_item_id, count(*) FILTER (WHERE is_original) AS originals
      FROM catalog_item_titles
      GROUP BY catalog_item_id
      ORDER BY catalog_item_id
    `)

    expect(counts.rows[0]).toStrictEqual({
      items: '12',
      movies: '6',
      originals: '12',
      series: '6',
      titles: '27'
    })

    expect(originalCounts.rows).toHaveLength(12)
    expect(originalCounts.rows.every(row => row.originals === '1')).toBe(true)
  })

  it('enforces locale and original-title uniqueness while allowing nullable years', async () => {
    await assertDisposableTestDatabase(client)

    const catalogItemId = '30000000-0000-4000-8000-000000000001'

    try {
      await client.query(`
        INSERT INTO catalog_items (id, type, release_year)
        VALUES ($1, 'movie', NULL)
      `, [catalogItemId])

      await client.query(`
        INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original)
        VALUES ($1, 'en', 'Constraint fixture', true)
      `, [catalogItemId])

      const item = await client.query<{ release_year: number | null }>(`
        SELECT release_year
        FROM catalog_items
        WHERE id = $1
      `, [catalogItemId])

      const rows = await findTitleRowsForMatchingCatalogItems(
        createDatabase(client),
        'Constraint fixture'
      )

      const items = createCatalogSearchItems(rows, 'en')

      expect(item.rows[0]?.release_year).toBeNull()

      expect(items).toStrictEqual([
        {
          id: catalogItemId,
          originalTitle: 'Constraint fixture',
          originalTitleLocale: 'en',
          releaseYear: null,
          title: 'Constraint fixture',
          titleLocale: 'en',
          type: 'movie'
        }
      ])

      await expect(client.query(`
        INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original)
        VALUES ($1, 'en', 'Duplicate locale', false)
      `, [catalogItemId])).rejects.toMatchObject({ code: '23505' })

      await expect(client.query(`
        INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original)
        VALUES ($1, 'ru', 'Second original', true)
      `, [catalogItemId])).rejects.toMatchObject({ code: '23505' })
    } finally {
      await client.query('DELETE FROM catalog_items WHERE id = $1', [catalogItemId])
    }
  })

  it('rejects unsupported catalog item types', async () => {
    await assertDisposableTestDatabase(client)

    await expect(client.query(`
      INSERT INTO catalog_items (id, type)
      VALUES ('30000000-0000-4000-8000-000000000004', 'documentary')
    `)).rejects.toMatchObject({ code: '22P02' })
  })

  it('allows duplicate title text and cascades titles when an item is deleted', async () => {
    await assertDisposableTestDatabase(client)

    const firstItemId = '30000000-0000-4000-8000-000000000002'
    const secondItemId = '30000000-0000-4000-8000-000000000003'

    await client.query(`
      INSERT INTO catalog_items (id, type)
      VALUES ($1, 'movie'), ($2, 'series')
    `, [firstItemId, secondItemId])

    await client.query(`
      INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original)
      VALUES
        ($1, 'en', 'Shared title', true),
        ($2, 'en', 'Shared title', true)
    `, [firstItemId, secondItemId])

    await client.query('DELETE FROM catalog_items WHERE id = $1', [firstItemId])

    const titleCounts = await client.query<{
      first_count: string;
      second_count: string;
    }>(`
      SELECT
        count(*) FILTER (WHERE catalog_item_id = $1) AS first_count,
        count(*) FILTER (WHERE catalog_item_id = $2) AS second_count
      FROM catalog_item_titles
    `, [firstItemId, secondItemId])

    expect(titleCounts.rows[0]).toStrictEqual({
      first_count: '0',
      second_count: '1'
    })

    await client.query('DELETE FROM catalog_items WHERE id = $1', [secondItemId])
  })

  it.each([
    ['Dead Man', 'en', 'Dead Man'],
    ['dead', 'en', 'Dead Man'],
    ['DEAD', 'ru', 'Мертвец'],
    ['Мертв', 'en', 'Dead Man'],
    ['Кин-дза', 'en', 'Kin-dza-dza!']
  ])('finds %s across languages and displays %s', async (
    query,
    titleLocale,
    expectedTitle
  ) => {
    const rows = await findTitleRowsForMatchingCatalogItems(
      createDatabase(client),
      query
    )

    const items = createCatalogSearchItems(rows, titleLocale)

    expect(items).toHaveLength(1)
    expect(items[0]?.title).toBe(expectedTitle)
  })

  it.each(['%', '_', '\\', 'Unknown title'])('searches %s literally', async (query) => {
    const rows = await findTitleRowsForMatchingCatalogItems(
      createDatabase(client),
      query
    )

    expect(rows).toStrictEqual([])
  })

  it('deduplicates a match present in multiple locale rows', async () => {
    const rows = await findTitleRowsForMatchingCatalogItems(
      createDatabase(client),
      '1923'
    )

    const items = createCatalogSearchItems(rows, 'ru')

    expect(items).toHaveLength(1)

    expect(items[0]).toMatchObject({
      id: '10000000-0000-4000-8000-000000000008',
      title: '1923',
      titleLocale: 'ru'
    })

    const original = rows.find(row => row.isOriginal)

    assert(original !== undefined)
    expect(original.locale).toBe('en')
  })

  it('returns the complete localized Kingdom payload', async () => {
    const rows = await findTitleRowsForMatchingCatalogItems(
      createDatabase(client),
      '킹'
    )

    const items = createCatalogSearchItems(rows, 'ru-RU')

    expect(items).toStrictEqual([
      {
        id: '10000000-0000-4000-8000-000000000012',
        originalTitle: '킹덤',
        originalTitleLocale: 'ko',
        releaseYear: 2019,
        title: 'Королевство зомби',
        titleLocale: 'ru',
        type: 'series'
      }
    ])
  })
})
