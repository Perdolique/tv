import type { Database } from '@tv/database'
import { catalogItemTitles, catalogItems, catalogReleases } from '@tv/database/schema'
import { sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { findCatalogReleaseRows } from '../repository.ts'
import { createCatalogReleaseItems, validateCatalogReleaseRange } from '../releases.ts'
import type { CatalogReleaseRow } from '../types.ts'

const firstReleaseId = '01991a00-0000-7000-8000-000000000001'
const secondReleaseId = '01991a00-0000-7000-8000-000000000002'

const firstOriginal = {
  catalogItemId: '01991a00-0000-7000-8000-000000000003',
  episodeNumber: 1,
  isOriginal: true,
  locale: 'ko',
  posterPath: '/posters/kingdom-2019.webp',
  releaseDate: '2026-10-02',
  releaseId: firstReleaseId,
  releaseYear: 2019,
  seasonNumber: 3,
  title: '킹덤',
  type: 'series'
} as const satisfies CatalogReleaseRow

const firstRussian = {
  catalogItemId: firstOriginal.catalogItemId,
  episodeNumber: firstOriginal.episodeNumber,
  isOriginal: false,
  locale: 'ru',
  posterPath: firstOriginal.posterPath,
  releaseDate: firstOriginal.releaseDate,
  releaseId: firstReleaseId,
  releaseYear: firstOriginal.releaseYear,
  seasonNumber: firstOriginal.seasonNumber,
  title: 'Королевство зомби',
  type: firstOriginal.type
} as const satisfies CatalogReleaseRow

const secondOriginal = {
  catalogItemId: firstOriginal.catalogItemId,
  episodeNumber: 2,
  isOriginal: true,
  locale: firstOriginal.locale,
  posterPath: firstOriginal.posterPath,
  releaseDate: firstOriginal.releaseDate,
  releaseId: secondReleaseId,
  releaseYear: firstOriginal.releaseYear,
  seasonNumber: firstOriginal.seasonNumber,
  title: firstOriginal.title,
  type: firstOriginal.type
} as const satisfies CatalogReleaseRow

const secondRussian = {
  catalogItemId: secondOriginal.catalogItemId,
  episodeNumber: secondOriginal.episodeNumber,
  isOriginal: false,
  locale: firstRussian.locale,
  posterPath: secondOriginal.posterPath,
  releaseDate: secondOriginal.releaseDate,
  releaseId: secondReleaseId,
  releaseYear: secondOriginal.releaseYear,
  seasonNumber: secondOriginal.seasonNumber,
  title: firstRussian.title,
  type: secondOriginal.type
} as const satisfies CatalogReleaseRow

describe(validateCatalogReleaseRange, () => {
  it.each(['2024-02-29', '2000-02-29'])('accepts the leap date %s', (date) => {
    expect(validateCatalogReleaseRange(date, date)).toStrictEqual({
      from: date,
      to: date
    })
  })

  it.each([
    '2023-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-13-01',
    '0000-01-01',
    '2026-1-01'
  ])('rejects the impossible or malformed date %s', (date) => {
    expect(() => validateCatalogReleaseRange(date, '2026-12-31')).toThrow(expect.objectContaining({
      code: 'INVALID_REQUEST',

      fields: {
        from: 'Use a valid calendar date in YYYY-MM-DD format.'
      },

      status: 400
    }))
  })

  it('returns an inclusive ordered range', () => {
    expect(validateCatalogReleaseRange('2026-10-01', '2026-10-31')).toStrictEqual({
      from: '2026-10-01',
      to: '2026-10-31'
    })
  })

  it('reports missing and impossible dates by field', () => {
    expect(() => validateCatalogReleaseRange(null, '2026-02-30')).toThrow(expect.objectContaining({
      code: 'INVALID_REQUEST',

      fields: {
        from: 'Use a valid calendar date in YYYY-MM-DD format.',
        to: 'Use a valid calendar date in YYYY-MM-DD format.'
      },

      status: 400
    }))
  })

  it('rejects a range whose end is before its start', () => {
    expect(() => validateCatalogReleaseRange('2026-10-02', '2026-10-01')).toThrow(expect.objectContaining({
      code: 'INVALID_REQUEST',

      fields: {
        to: 'Use a date on or after from.'
      },

      status: 400
    }))
  })

  it('allows at most 366 included calendar days', () => {
    expect(validateCatalogReleaseRange('2024-01-01', '2024-12-31')).toStrictEqual({
      from: '2024-01-01',
      to: '2024-12-31'
    })

    expect(() => validateCatalogReleaseRange('2024-01-01', '2025-01-01')).toThrow(expect.objectContaining({
      code: 'INVALID_REQUEST',

      fields: {
        to: 'Use a range of 366 days or fewer.'
      },

      status: 400
    }))
  })
})

describe(createCatalogReleaseItems, () => {
  it('localizes each release without merging episodes of the same title', () => {
    const items = createCatalogReleaseItems([
      firstOriginal,
      firstRussian,
      secondOriginal,
      secondRussian
    ], 'ru-RU')

    expect(items).toHaveLength(2)

    expect(items.map(item => item.releaseId)).toStrictEqual([
      firstReleaseId,
      secondReleaseId
    ])

    expect(items).toStrictEqual([{
      episodeNumber: 1,
      id: firstOriginal.catalogItemId,
      originalTitle: firstOriginal.title,
      originalTitleLocale: firstOriginal.locale,
      posterUrl: firstOriginal.posterPath,
      releaseDate: firstOriginal.releaseDate,
      releaseId: firstReleaseId,
      releaseYear: firstOriginal.releaseYear,
      seasonNumber: firstOriginal.seasonNumber,
      title: firstRussian.title,
      titleLocale: firstRussian.locale,
      type: firstOriginal.type
    }, {
      episodeNumber: 2,
      id: secondOriginal.catalogItemId,
      originalTitle: secondOriginal.title,
      originalTitleLocale: secondOriginal.locale,
      posterUrl: secondOriginal.posterPath,
      releaseDate: secondOriginal.releaseDate,
      releaseId: secondReleaseId,
      releaseYear: secondOriginal.releaseYear,
      seasonNumber: secondOriginal.seasonNumber,
      title: secondRussian.title,
      titleLocale: secondRussian.locale,
      type: secondOriginal.type
    }])
  })

  it('returns an empty list and rejects a missing original-title invariant', () => {
    expect(createCatalogReleaseItems([], 'en')).toStrictEqual([])

    expect(() => createCatalogReleaseItems([{
      ...firstRussian,
      releaseId: '01991a00-0000-7000-8000-000000000004'
    }], 'en')).toThrow('Catalog release 01991a00-0000-7000-8000-000000000004 has no original title')
  })
})

describe(findCatalogReleaseRows, () => {
  it('uses the complete stable release order after filtering the inclusive range', async () => {
    const builder = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      orderBy: vi.fn().mockResolvedValue([]),
      where: vi.fn()
    }

    builder.from.mockReturnValue(builder)
    builder.innerJoin.mockReturnValue(builder)
    builder.where.mockReturnValue(builder)

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The fluent stub isolates the repository ordering contract without opening a database connection.
    const database = {
      select: vi.fn().mockReturnValue(builder)
    } as unknown as Database

    await findCatalogReleaseRows(
      database,
      '50000000-0000-4000-8000-000000000001',
      {
        from: '2026-10-01',
        to: '2026-10-31'
      }
    )

    expect(builder.orderBy).toHaveBeenCalledExactlyOnceWith(
      catalogReleases.releaseDate,
      catalogItems.id,
      sql`${catalogReleases.seasonNumber} ASC NULLS LAST`,
      sql`${catalogReleases.episodeNumber} ASC NULLS LAST`,
      catalogReleases.id,
      catalogItemTitles.locale
    )
  })
})
