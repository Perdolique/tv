import { describe, expect, it } from 'vitest'
import { createCatalogDetailsItem, validateCatalogItemId } from '../details.ts'
import { CatalogHttpError } from '../errors.ts'
import type { CatalogDetailsRow } from '../types.ts'

const original: CatalogDetailsRow = {
  catalogItemId: '01991a00-0000-7000-8000-000000000001',
  description: 'Original Japanese description.',
  isOriginal: true,
  locale: 'ja',
  posterPath: null,
  releaseYear: null,
  title: 'Original title',
  type: 'movie'
}

describe('catalog details', () => {
  it('selects titles and nonempty descriptions independently through regional, English and original fallbacks', () => {
    const english = {
      ...original,
      isOriginal: false,
      locale: 'en',
      title: 'English title',
      description: 'English description.'
    }

    const russian = {
      ...original,
      isOriginal: false,
      locale: 'ru',
      title: 'Русское название',
      description: '  '
    }

    const rows = [original, english, russian]

    expect(createCatalogDetailsItem(rows, 'ru-RU')).toStrictEqual({
      id: original.catalogItemId,
      title: 'Русское название',
      titleLocale: 'ru',
      originalTitle: original.title,
      originalTitleLocale: 'ja',
      type: 'movie',
      releaseYear: null,
      description: 'English description.',
      descriptionLocale: 'en',
      posterUrl: null
    })

    expect(createCatalogDetailsItem([original, russian], 'ru-RU')).toMatchObject({
      titleLocale: 'ru',
      description: original.description,
      descriptionLocale: 'ja'
    })

    const localized = {
      ...russian,
      description: ' Русское описание. '
    }

    expect(createCatalogDetailsItem([original, english, localized], 'ru-RU')).toMatchObject({
      description: 'Русское описание.',
      descriptionLocale: 'ru'
    })
  })

  it('keeps absent optional fields nullable and distinguishes a missing item', () => {
    const row = {
      ...original,
      description: null
    }

    expect(createCatalogDetailsItem([row], 'en')).toMatchObject({
      title: original.title,
      titleLocale: 'ja',
      description: null,
      descriptionLocale: null,
      posterUrl: null,
      releaseYear: null
    })

    expect(createCatalogDetailsItem([], 'en')).toBeNull()
  })

  it('retains a poster and rejects a broken original-title invariant', () => {
    const row = {
      ...original,
      posterPath: '/posters/dune-2021.webp'
    }

    expect(createCatalogDetailsItem([row], 'en')?.posterUrl).toBe('/posters/dune-2021.webp')

    expect(() => createCatalogDetailsItem([{
      ...row,
      isOriginal: false
    }], 'en')).toThrow('has no original title')
  })

  it.each(['', 'not-an-id', 'search', '\'; DROP TABLE users; --'])('rejects invalid ID %s', (id) => {
    expect(() => validateCatalogItemId(id)).toThrow(CatalogHttpError)
  })

  it('accepts UUID syntax without treating an old but well-formed ID as malformed', () => {
    expect(validateCatalogItemId(original.catalogItemId)).toBe(original.catalogItemId)
    expect(validateCatalogItemId('10000000-0000-4000-8000-000000000001')).toBe('10000000-0000-4000-8000-000000000001')
  })
})
