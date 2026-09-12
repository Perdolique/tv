import { describe, expect, it } from 'vitest'
import * as v from 'valibot'

import {
  catalogDetailsResponseSchema,
  catalogFollowResponseSchema,
  catalogWatchlistResponseSchema
} from '../catalog-response.ts'

const item = {
  id: '01991a00-0000-7000-8000-000000000001',
  title: 'A title',
  titleLocale: 'en',
  originalTitle: 'A title',
  originalTitleLocale: 'en',
  releaseYear: null,
  type: 'movie',
  description: null,
  descriptionLocale: null,
  posterUrl: null
}

describe('catalog details response contract', () => {
  it('accepts explicit absent metadata', () => {
    expect(v.parse(catalogDetailsResponseSchema, { item })).toStrictEqual({ item })
  })

  it('accepts localized descriptions and a local poster', () => {
    const localized = {
      ...item,
      description: 'Описание.',
      descriptionLocale: 'ru',
      posterUrl: '/posters/dune-2021.webp'
    }

    expect(v.parse(catalogDetailsResponseSchema, { item: localized })).toStrictEqual({ item: localized })
  })

  // oxlint-disable-next-line eslint/no-script-url -- Reject unsafe poster schemes supplied by an untrusted response.
  it.each(['https://unrelated.example/poster.webp', 'javascript:alert(1)', '/posters/../../private.webp'])(
    'rejects an unexpected poster location: %s',
    (posterUrl) => {
      const response = { item: {
        ...item,
        posterUrl
      } }

      expect(v.safeParse(catalogDetailsResponseSchema, response).success).toBe(false)
    }
  )

  it('rejects incomplete or malformed metadata instead of rendering it', () => {
    expect(v.safeParse(catalogDetailsResponseSchema, { item: { id: item.id } }).success).toBe(false)

    expect(v.safeParse(catalogDetailsResponseSchema, { item: {
      ...item,
      releaseYear: 2021.5
    } }).success).toBe(false)

    expect(v.safeParse(catalogDetailsResponseSchema, { item: {
      ...item,
      description: 42
    } }).success).toBe(false)
  })
})

describe('catalog follow response contract', () => {
  it.each([true, false])('accepts followed=%s', (followed) => {
    expect(v.parse(catalogFollowResponseSchema, { followed })).toStrictEqual({ followed })
  })

  it.each([
    {},
    { followed: 'true' },
    {
      followed: true,
      item: {}
    }
  ])('rejects malformed state %#', (response) => {
    expect(v.safeParse(catalogFollowResponseSchema, response).success).toBe(false)
  })
})

describe('catalog watchlist response contract', () => {
  const watchlistItem = {
    id: item.id,
    originalTitle: item.originalTitle,
    originalTitleLocale: item.originalTitleLocale,
    posterUrl: '/posters/dune-2021.webp',
    releaseYear: item.releaseYear,
    title: item.title,
    titleLocale: item.titleLocale,
    type: item.type
  }

  it('accepts ordered items with nullable posters', () => {
    const response = {
      items: [
        watchlistItem,
        {
          ...watchlistItem,
          id: '01991a00-0000-7000-8000-000000000002',
          posterUrl: null
        }
      ]
    }

    expect(v.parse(catalogWatchlistResponseSchema, response)).toStrictEqual(response)
  })

  it('rejects malformed items and unsafe poster locations', () => {
    expect(v.safeParse(catalogWatchlistResponseSchema, {
      items: [{
        ...watchlistItem,
        posterUrl: 'https://unrelated.example/poster.webp'
      }]
    }).success).toBe(false)

    expect(v.safeParse(catalogWatchlistResponseSchema, {
      items: [{ id: watchlistItem.id }]
    }).success).toBe(false)
  })

  it.each(['', '../../sign-in', 'not-a-uuid'])(
    'rejects an invalid catalog item ID: %s',
    (id) => {
      const response = {
        items: [{
          ...watchlistItem,
          id
        }]
      }

      expect(v.safeParse(catalogWatchlistResponseSchema, response).success).toBe(false)
    }
  )
})
