import type { Database } from '@tv/database'
import { catalogItemTitles, catalogItems } from '@tv/database/schema'
import { describe, expect, it, vi } from 'vitest'
import { findCatalogWatchlistRows } from '../repository.ts'
import { createCatalogWatchlistItems } from '../watchlist.ts'
import type { CatalogWatchlistRow } from '../types.ts'

const firstOriginal = {
  catalogItemId: '01991a00-0000-7000-8000-000000000002',
  isOriginal: true,
  locale: 'ko',
  posterPath: '/posters/kingdom-2019.webp',
  releaseYear: 2019,
  title: '킹덤',
  type: 'series'
} as const satisfies CatalogWatchlistRow

const firstRussian = {
  catalogItemId: firstOriginal.catalogItemId,
  isOriginal: false,
  locale: 'ru',
  posterPath: firstOriginal.posterPath,
  releaseYear: firstOriginal.releaseYear,
  title: 'Королевство зомби',
  type: firstOriginal.type
} as const satisfies CatalogWatchlistRow

const secondOriginal = {
  catalogItemId: '01991a00-0000-7000-8000-000000000001',
  isOriginal: true,
  locale: 'en',
  posterPath: null,
  releaseYear: null,
  title: 'Older title',
  type: 'movie'
} as const satisfies CatalogWatchlistRow

describe(createCatalogWatchlistItems, () => {
  it('preserves follow order while localizing and deduplicating title rows', () => {
    const items = createCatalogWatchlistItems([
      firstOriginal,
      firstRussian,
      secondOriginal
    ], 'ru-RU')

    expect(items).toStrictEqual([{
      id: firstOriginal.catalogItemId,
      originalTitle: firstOriginal.title,
      originalTitleLocale: firstOriginal.locale,
      posterUrl: firstOriginal.posterPath,
      releaseYear: firstOriginal.releaseYear,
      title: firstRussian.title,
      titleLocale: firstRussian.locale,
      type: firstOriginal.type
    }, {
      id: secondOriginal.catalogItemId,
      originalTitle: secondOriginal.title,
      originalTitleLocale: secondOriginal.locale,
      posterUrl: null,
      releaseYear: null,
      title: secondOriginal.title,
      titleLocale: secondOriginal.locale,
      type: secondOriginal.type
    }])
  })

  it('returns an empty list and rejects a missing original-title invariant', () => {
    expect(createCatalogWatchlistItems([], 'en')).toStrictEqual([])

    expect(() => createCatalogWatchlistItems([{
      ...secondOriginal,
      isOriginal: false
    }], 'en')).toThrow(`Catalog item ${secondOriginal.catalogItemId} has no original title`)
  })
})

describe(findCatalogWatchlistRows, () => {
  it('orders tied follows by catalog item ID before title locale', async () => {
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

    await findCatalogWatchlistRows(database, '50000000-0000-4000-8000-000000000001')

    expect(builder.orderBy).toHaveBeenCalledWith(
      expect.anything(),
      catalogItems.id,
      catalogItemTitles.locale
    )
  })
})
