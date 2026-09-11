import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import { catalogDetailsResponseSchema, catalogFollowResponseSchema } from '../catalog-response.ts'

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
