import { describe, expect, it } from 'vitest'
import { CatalogHttpError } from '../errors.ts'

import {
  canonicalizeTitleLocale,
  createCatalogSearchItems,
  escapeLikePattern,
  getLocaleFallbacks,
  normalizeCatalogQuery
} from '../search.ts'

import type { CatalogTitleRow } from '../types.ts'

function createTitleRow(
  overrides: Partial<CatalogTitleRow> = {}
): CatalogTitleRow {
  return {
    catalogItemId: '10000000-0000-4000-8000-000000000001',
    isOriginal: true,
    locale: 'en',
    releaseYear: 2000,
    title: 'Original title',
    type: 'movie',
    ...overrides
  }
}

function getQueryError(query: string | null): CatalogHttpError {
  try {
    normalizeCatalogQuery(query)
  } catch (error) {
    if (error instanceof CatalogHttpError) {
      return error
    }

    throw error
  }

  throw new Error('Expected a CatalogHttpError')
}

function getTitleLocaleError(locale: string): CatalogHttpError {
  try {
    canonicalizeTitleLocale(locale)
  } catch (error) {
    if (error instanceof CatalogHttpError) {
      return error
    }

    throw error
  }

  throw new Error('Expected a CatalogHttpError')
}

describe(normalizeCatalogQuery, () => {
  it('trims and NFC-normalizes a search query', () => {
    expect(normalizeCatalogQuery('  Cafe\u0301  ')).toBe('Café')
  })

  it.each([null, '', ' \n\t '])('rejects an empty query: %s', (query) => {
    const error = getQueryError(query)

    expect(error).toMatchObject({
      code: 'INVALID_REQUEST',

      fields: {
        query: 'Enter a search query.'
      }
    })
  })
})

describe(escapeLikePattern, () => {
  it('escapes backslash, percent, and underscore as literal LIKE characters', () => {
    expect(escapeLikePattern(String.raw`\%_`)).toBe(String.raw`\\\%\_`)
  })
})

describe(canonicalizeTitleLocale, () => {
  it('defaults to English and canonicalizes a BCP 47 locale', () => {
    expect(canonicalizeTitleLocale(null)).toBe('en')
    expect(canonicalizeTitleLocale('EN-us')).toBe('en-US')
  })

  it('rejects an invalid BCP 47 locale', () => {
    const error = getTitleLocaleError('not_a_locale')

    expect(error).toMatchObject({
      code: 'INVALID_REQUEST',

      fields: {
        titleLocale: 'Use a valid BCP 47 locale.'
      }
    })
  })
})

describe(getLocaleFallbacks, () => {
  it('falls back through less-specific locales and English', () => {
    expect(getLocaleFallbacks('zh-Hant-TW')).toStrictEqual([
      'zh-Hant-TW',
      'zh-Hant',
      'zh',
      'en'
    ])

    expect(getLocaleFallbacks('ru-RU')).toStrictEqual(['ru-RU', 'ru', 'en'])
  })
})

describe(createCatalogSearchItems, () => {
  it('prefers an exact ru-RU title over its ru fallback', () => {
    const rows = [
      createTitleRow(),
      createTitleRow({
        isOriginal: false,
        locale: 'ru',
        title: 'Название'
      }),
      createTitleRow({
        isOriginal: false,
        locale: 'ru-RU',
        title: 'Точное название'
      })
    ]

    expect(createCatalogSearchItems(rows, 'ru-RU')[0]).toMatchObject({
      title: 'Точное название',
      titleLocale: 'ru-RU'
    })
  })

  it('uses English, then the original title when localized titles are absent', () => {
    const englishRows = [
      createTitleRow({
        isOriginal: true,
        locale: 'fr',
        title: 'Titre original'
      }),
      createTitleRow({
        isOriginal: false,
        locale: 'en',
        title: 'English title'
      })
    ]

    const originalRows = [
      createTitleRow({
        locale: 'ko',
        title: '원제'
      })
    ]

    expect(createCatalogSearchItems(englishRows, 'de-DE')[0]).toMatchObject({
      title: 'English title',
      titleLocale: 'en'
    })

    expect(createCatalogSearchItems(originalRows, 'de-DE')[0]).toMatchObject({
      title: '원제',
      titleLocale: 'ko'
    })
  })

  it('deduplicates an item with multiple language rows', () => {
    const rows = [
      createTitleRow(),
      createTitleRow({
        isOriginal: false,
        locale: 'ru',
        title: 'Название'
      })
    ]

    const items = createCatalogSearchItems(rows, 'ru')

    expect(items).toHaveLength(1)

    expect(items[0]).toStrictEqual({
      id: '10000000-0000-4000-8000-000000000001',
      originalTitle: 'Original title',
      originalTitleLocale: 'en',
      releaseYear: 2000,
      title: 'Название',
      titleLocale: 'ru',
      type: 'movie'
    })
  })

  it('sorts different items by their localized display titles', () => {
    const rows = [
      createTitleRow({
        catalogItemId: '20000000-0000-4000-8000-000000000001',
        title: 'First original'
      }),
      createTitleRow({
        catalogItemId: '20000000-0000-4000-8000-000000000001',
        isOriginal: false,
        locale: 'ru',
        title: 'Бета'
      }),
      createTitleRow({
        catalogItemId: '20000000-0000-4000-8000-000000000002',
        title: 'Second original'
      }),
      createTitleRow({
        catalogItemId: '20000000-0000-4000-8000-000000000002',
        isOriginal: false,
        locale: 'ru',
        title: 'Альфа'
      })
    ]

    const items = createCatalogSearchItems(rows, 'ru')

    expect(items.map(item => item.id)).toStrictEqual([
      '20000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001'
    ])
  })

  it('uses UUID as a stable tie-breaker for equal display titles', () => {
    const rows = [
      createTitleRow({
        catalogItemId: '20000000-0000-4000-8000-000000000002',
        title: 'Same title'
      }),
      createTitleRow({
        catalogItemId: '20000000-0000-4000-8000-000000000001',
        title: 'Same title'
      })
    ]

    const items = createCatalogSearchItems(rows, 'en')

    expect(items.map(item => item.id)).toStrictEqual([
      '20000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002'
    ])
  })
})
