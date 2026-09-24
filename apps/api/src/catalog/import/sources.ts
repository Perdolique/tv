import type {
  ExternalIds,
  FieldOrigin,
  ImportCard,
  ImportEpisode,
  ImportSelection,
  ImportTranslation,
  PreviewIssue,
  ShowEvidence,
  SourceIdentity,
  SourceValue
} from '@tv/database/import-preview'

import * as v from 'valibot'
import { movieSchema, seriesSchema, showSchema } from './source-schemas.ts'
import { fetchSourceJson, ImportSourceError, type SourceHttpOptions } from './source-http.ts'

interface TmdbCardResult {
  card: ImportCard;
  externalIds: ExternalIds;
}

interface TvmazeResult {
  evidence: ShowEvidence;
  episodes: ImportEpisode[];
  errors: PreviewIssue[];
}

type TvmazeEpisode = v.InferOutput<typeof showSchema>['_embedded']['episodes'][number]

function sourceValue<Value>(value: Value, source: FieldOrigin): SourceValue<Value> {
  return {
    value,
    source
  }
}

function nullableText(value: string | null | undefined): string | null {
  const text = value?.trim()

  return text === undefined || text === '' ? null : text
}

function nullableDate(value: string | null | undefined): string | null {
  const text = nullableText(value)

  if (text === null) {
    return null
  }

  const utcDate = `${text}T00:00:00Z`
  const timestamp = Date.parse(utcDate)

  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || !Number.isFinite(timestamp)) {
    throw new Error('Invalid source date')
  }

  const date = new Date(timestamp)
  const dateString = date.toISOString()
  const normalized = dateString.slice(0, 10)

  if (normalized !== text) {
    throw new Error('Invalid source date')
  }

  return text
}

function normalizeTmdb(selection: ImportSelection, input: unknown): TmdbCardResult {
  try {
    const raw = selection.type === 'movie' ? v.parse(movieSchema, input) : v.parse(seriesSchema, input)

    if (raw.id !== selection.tmdbId) {
      throw new Error('TMDB returned a different record ID')
    }

    const entityType = selection.type === 'movie' ? 'movie' : 'tv'
    const externalId = String(raw.id)

    const identity: SourceIdentity = {
      provider: 'tmdb',
      entityType,
      externalId
    }

    const title = 'original_title' in raw ? raw.original_title : raw.original_name
    const titleField = 'original_title' in raw ? 'original_title' : 'original_name'
    const dateField = 'original_title' in raw ? 'release_date' : 'first_air_date'
    const dateValue = 'original_title' in raw ? raw.release_date : raw.first_air_date
    const date = nullableDate(dateValue)
    const year = date === null ? null : Number(date.slice(0, 4))
    const translations: ImportTranslation[] = []
    const locales = new Set<string>()

    const relevantTranslations = raw.translations.translations.filter(translation => {
      const language = translation.iso_639_1

      return language === raw.original_language || language === 'en' || language === 'ru'
    })

    for (const translation of relevantTranslations) {
      const language = translation.iso_639_1
      const locale = `${language}-${translation.iso_3166_1}`

      if (locales.has(locale)) {
        throw new Error(`Duplicate TMDB translation locale ${locale}`)
      }

      locales.add(locale)

      const translatedTitle = selection.type === 'movie' ? translation.data.title : translation.data.name
      const translatedTitleField = selection.type === 'movie' ? 'title' : 'name'
      const normalizedTitle = nullableText(translatedTitle)
      const description = nullableText(translation.data.overview)
      const translatedField = `translations.data.${translatedTitleField}`

      const sourceTitle = sourceValue(normalizedTitle, {
        identity,
        field: translatedField,
        locale
      })

      const sourceDescription = sourceValue(description, {
        identity,
        field: 'translations.data.overview',
        locale
      })

      translations.push({
        locale,
        language,
        title: sourceTitle,
        description: sourceDescription
      })
    }

    translations.sort((first, second) => first.locale.localeCompare(second.locale))

    const posterPath = nullableText(raw.poster_path)

    const originalTitle = sourceValue(title, {
      identity,
      field: titleField,
      locale: raw.original_language
    })

    const originalLanguage = sourceValue(raw.original_language, {
      identity,
      field: 'original_language',
      locale: null
    })

    const releaseYear = sourceValue(year, {
      identity,
      field: dateField,
      locale: null
    })

    const poster = sourceValue(posterPath, {
      identity,
      field: 'poster_path',
      locale: null
    })

    const imdb = nullableText(raw.external_ids.imdb_id)

    return {
      card: {
        identity,
        type: selection.type,
        originalTitle,
        originalLanguage,
        releaseYear,
        translations,
        posterPath: poster
      },

      externalIds: {
        imdb,
        thetvdb: raw.external_ids.tvdb_id ?? null
      }
    }
  } catch (error) {
    throw new ImportSourceError('tmdb', 'source_invalid', { cause: error })
  }
}

function normalizeSelectedEpisode(episode: TvmazeEpisode, season: number, number: number): ImportEpisode {
  const externalId = String(episode.id)

  const identity: SourceIdentity = {
    provider: 'tvmaze',
    entityType: 'episode',
    externalId
  }

  const title = nullableText(episode.name)
  const airDate = nullableDate(episode.airdate)

  const seasonNumber = sourceValue(season, {
    identity,
    field: 'season',
    locale: null
  })

  const episodeNumber = sourceValue(number, {
    identity,
    field: 'number',
    locale: null
  })

  const sourceTitle = sourceValue(title, {
    identity,
    field: 'name',
    locale: null
  })

  const sourceAirDate = sourceValue(airDate, {
    identity,
    field: 'airdate',
    locale: null
  })

  return {
    identity,
    seasonNumber,
    episodeNumber,
    title: sourceTitle,
    airDate: sourceAirDate
  }
}

function normalizeTvmaze(showId: number, input: unknown): TvmazeResult {
  try {
    const raw = v.parse(showSchema, input)

    if (raw.id !== showId) {
      throw new Error('TVMaze returned a different show ID')
    }

    const externalId = String(showId)

    const identity: SourceIdentity = {
      provider: 'tvmaze',
      entityType: 'show',
      externalId
    }

    const seasonRestriction = showId === 48_945 ? 1 : null
    const episodes: ImportEpisode[] = []
    const errors: PreviewIssue[] = []
    const ids = new Set<number>()
    const coordinates = new Set<string>()
    const { _embedded: embedded } = raw
    const regularEpisodes = embedded.episodes.filter(episode => episode.type === 'regular')

    for (const episode of regularEpisodes) {
      const { season, number } = episode
      const invalidSeason = season === null || season === undefined || season <= 0
      const invalidNumber = number === null || number === undefined || number <= 0

      if (invalidSeason || invalidNumber) {
        errors.push({
          code: 'episode_coordinates_invalid',
          message: 'A regular episode has no valid season or episode number.'
        })
      } else if (seasonRestriction === null || season === seasonRestriction) {
        const coordinate = `${season}:${number}`

        if (ids.has(episode.id) || coordinates.has(coordinate)) {
          errors.push({
            code: 'episode_identity_duplicate',
            message: 'The source has duplicate episode IDs or coordinates.'
          })
        } else {
          ids.add(episode.id)
          coordinates.add(coordinate)

          const normalized = normalizeSelectedEpisode(episode, season, number)

          episodes.push(normalized)
        }
      }
    }

    episodes.sort((first, second) => first.seasonNumber.value - second.seasonNumber.value || first.episodeNumber.value - second.episodeNumber.value)

    const name = nullableText(raw.name)
    const premiered = nullableDate(raw.premiered)
    const language = nullableText(raw.language)
    const imdb = nullableText(raw.externals.imdb)

    return {
      evidence: {
        identity,
        name,
        premiered,
        language,

        externalIds: {
          imdb,
          thetvdb: raw.externals.thetvdb ?? null
        },

        seasonRestriction
      },

      episodes,
      errors
    }
  } catch (error) {
    throw new ImportSourceError('tvmaze', 'source_invalid', { cause: error })
  }
}

async function loadTmdbCard(selection: ImportSelection, token: string, options: SourceHttpOptions): Promise<TmdbCardResult> {
  const type = selection.type === 'movie' ? 'movie' : 'tv'
  const url = `https://api.themoviedb.org/3/${type}/${selection.tmdbId}?append_to_response=translations,external_ids`

  const input = await fetchSourceJson({
    provider: 'tmdb',
    url,
    token,
    maxBytes: 4 * 1024 * 1024
  }, options)

  return normalizeTmdb(selection, input)
}

async function loadTvmazeShow(showId: number, options: SourceHttpOptions): Promise<TvmazeResult> {
  const url = `https://api.tvmaze.com/shows/${showId}?embed=episodes`

  const input = await fetchSourceJson({
    provider: 'tvmaze',
    url,
    maxBytes: 8 * 1024 * 1024
  }, options)

  return normalizeTvmaze(showId, input)
}

export { loadTmdbCard, loadTvmazeShow, normalizeTmdb, normalizeTvmaze }
