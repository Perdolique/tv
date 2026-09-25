import { describe, expect, it } from 'vitest'
import { normalizeTmdb, normalizeTvmaze } from '../sources.ts'
import { movieResponse, seriesResponse, showResponse } from '../../../testing/import-fixtures.ts'

describe('import source normalization', () => {
  it.each(['cn', 'mo', 'sh'])('accepts the known TMDB language code %s without relabeling it', (language) => {
    const response = {
      ...movieResponse(),
      original_language: language
    }

    const result = normalizeTmdb({
      type: 'movie',
      tmdbId: 603
    }, response)

    expect(result.card.originalLanguage.value).toBe(language)
    expect(result.card.originalTitle.source.locale).toBe(language)
  })

  it('uses actual localized fields with provenance and never response-language fallbacks', () => {
    const response = movieResponse()

    const result = normalizeTmdb({
      type: 'movie',
      tmdbId: 603
    }, response)

    expect(result.card.originalTitle.value).toBe('Original test title')
    expect(result.card.releaseYear.value).toBe(2026)
    expect(result.card.translations).toHaveLength(3)

    expect(result.card.translations[0]).toStrictEqual({
      locale: 'en-US',
      language: 'en',

      title: {
        value: 'English test title',

        source: {
          identity: {
            provider: 'tmdb',
            entityType: 'movie',
            externalId: '603'
          },

          field: 'translations.data.title',
          locale: 'en-US'
        }
      },

      description: {
        value: 'English test description',

        source: {
          identity: {
            provider: 'tmdb',
            entityType: 'movie',
            externalId: '603'
          },

          field: 'translations.data.overview',
          locale: 'en-US'
        }
      }
    })

    expect(result.card.translations[2]?.title.value).toBeNull()
    expect(JSON.stringify(result)).not.toContain('Fallback')
  })

  it('keeps absent translations, dates, descriptions and artwork absent', () => {
    const response = {
      ...movieResponse(),
      release_date: '',
      translations: { translations: [] }
    }

    const result = normalizeTmdb({
      type: 'movie',
      tmdbId: 603
    }, response)

    expect(result.card.releaseYear.value).toBeNull()
    expect(result.card.translations).toStrictEqual([])
    expect(result.card.posterPath.value).toBeNull()
  })

  it.each([
    { id: 604 },
    { original_title: '' },
    { original_language: 'xx' },
    { release_date: '2025-02-29' },
    { translations: null },
    { external_ids: { imdb_id: 'broken' } }
  ])('blocks invalid card data: %j', (change) => {
    const response = {
      ...movieResponse(),
      ...change
    }

    expect(() => normalizeTmdb({
      type: 'movie',
      tmdbId: 603
    }, response)).toThrow('The selected source could not be prepared.')
  })

  it('validates the selected media type and record ID', () => {
    const response = seriesResponse()

    expect(() => normalizeTmdb({
      type: 'movie',
      tmdbId: 105_248
    }, response)).toThrow('The selected source could not be prepared.')

    expect(() => normalizeTvmaze(169, showResponse())).toThrow('The selected source could not be prepared.')
  })

  it('keeps future and unnamed episodes, excludes specials, and restricts the original Edgerunners', () => {
    const result = normalizeTvmaze(48_945, showResponse())

    expect(result.episodes.map(episode => episode.identity.externalId)).toStrictEqual(['910001', '910002'])
    expect(result.episodes[0]?.title.value).toBeNull()
    expect(result.episodes[0]?.airDate.value).toBeNull()
    expect(result.episodes[1]?.airDate.value).toBe('2099-02-03')
    expect(result.evidence.seasonRestriction).toBe(1)
    expect(result.errors).toStrictEqual([])
  })

  it('does not apply the season restriction to other shows', () => {
    const response = {
      ...showResponse(),
      id: 88_337
    }

    const result = normalizeTvmaze(88_337, response)

    expect(result.episodes).toHaveLength(3)
    expect(result.evidence.seasonRestriction).toBeNull()
  })

  it.each([
    {
      id: 910_001,
      number: 3
    },
    {
      id: 910_005,
      number: 1
    }
  ])('blocks duplicate episode IDs or coordinates: %j', (change) => {
    const response = showResponse()
    const { _embedded: embedded } = response

    embedded.episodes.push({
      id: change.id,
      type: 'regular',
      season: 1,
      number: change.number,
      name: null,
      airdate: null
    })

    const result = normalizeTvmaze(48_945, response)

    expect(result.errors).toContainEqual({
      code: 'episode_identity_duplicate',
      message: 'The source has duplicate episode IDs or coordinates.'
    })
  })

  it('does not treat malformed or unnumbered regular episodes as a verified empty list', () => {
    const response = showResponse()
    const { _embedded: embedded } = response

    embedded.episodes = [{
      id: 910_001,
      type: 'regular',
      season: 1,
      number: 0,
      name: null,
      airdate: null
    }]

    const result = normalizeTvmaze(48_945, response)

    expect(result.errors[0]?.code).toBe('episode_coordinates_invalid')

    expect(() => normalizeTvmaze(48_945, {
      ...response,
      _embedded: {}
    })).toThrow('The selected source could not be prepared.')
  })

  it('blocks an unnumbered regular episode before restricting show 48945 to season one', () => {
    const response = {
      ...showResponse(),

      _embedded: { episodes: [{
        id: 910_001,
        type: 'regular',
        season: null,
        number: 1,
        name: null,
        airdate: null
      }] }
    }

    const result = normalizeTvmaze(48_945, response)

    expect(result.episodes).toStrictEqual([])

    expect(result.errors).toContainEqual({
      code: 'episode_coordinates_invalid',
      message: 'A regular episode has no valid season or episode number.'
    })
  })
})
