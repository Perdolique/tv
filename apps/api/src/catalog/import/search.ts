import type { ImportSearchResponse, ImportShowSearchResponse } from '@tv/shared/catalog-import'
import * as v from 'valibot'

// oxlint-disable-next-line import/no-relative-parent-imports -- Import search uses the shared catalog HTTP error contract.
import { CatalogHttpError } from '../errors.ts'
import { sourceId } from './selection.ts'
import { fetchSourceJson, ImportSourceError, type SourceHttpOptions } from './source-http.ts'

const searchQuerySchema = v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(100))
const pageSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(500))

const tmdbSearchSchema = v.object({
  page: pageSchema,
  total_pages: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),

  results: v.array(v.object({
    id: sourceId,
    title: v.optional(v.string()),
    name: v.optional(v.string()),
    original_title: v.optional(v.string()),
    original_name: v.optional(v.string()),
    poster_path: v.nullish(v.string()),
    release_date: v.nullish(v.string()),
    first_air_date: v.nullish(v.string())
  }))
})

const tvmazeSearchSchema = v.array(v.object({
  show: v.object({
    id: sourceId,
    name: v.string(),
    premiered: v.nullish(v.string()),

    externals: v.nullish(v.object({
      imdb: v.nullish(v.string()),
      thetvdb: v.nullish(sourceId)
    }))
  })
}))

function parseImportSearchQuery(value: string | null): string {
  const result = v.safeParse(searchQuerySchema, value)

  if (!result.success) {
    throw new CatalogHttpError('INVALID_REQUEST', 400, {
      fields: { query: 'Enter between 2 and 100 characters.' }
    })
  }

  return result.output
}

function parseImportSearchPage(value: string | null): number {
  const page = value === null ? 1 : Number(value)

  if (!v.is(pageSchema, page)) {
    throw new CatalogHttpError('INVALID_REQUEST', 400, {
      fields: { page: 'Use a page from 1 to 500.' }
    })
  }

  return page
}

function sourceYear(value: string | null | undefined): number | null {
  if (value === null || value === undefined || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return null
  }

  return Number(value.slice(0, 4))
}

interface TmdbSearchInput {
  type: 'movie' | 'series';
  query: string;
  page: number;
  token: string;
}

async function searchTmdb({ type, query, page, token }: TmdbSearchInput, options: SourceHttpOptions = {}): Promise<ImportSearchResponse> {
  const entity = type === 'movie' ? 'movie' : 'tv'
  const url = new URL(`https://api.themoviedb.org/3/search/${entity}`)

  url.searchParams.set('query', query)
  url.searchParams.set('page', String(page))
  url.searchParams.set('language', 'en-US')
  url.searchParams.set('include_adult', 'false')

  const input = await fetchSourceJson({
    provider: 'tmdb',
    url: url.href,
    token,
    maxBytes: 4 * 1024 * 1024
  }, options)

  try {
    const response = v.parse(tmdbSearchSchema, input)

    if (response.page !== page) {
      throw new Error('TMDB returned a different search page')
    }

    const items = response.results.map((result) => {
      const title = type === 'movie' ? result.title : result.name
      const originalTitle = type === 'movie' ? result.original_title : result.original_name
      const date = type === 'movie' ? result.release_date : result.first_air_date

      if (title === undefined || title.trim() === '' || originalTitle === undefined || originalTitle.trim() === '') {
        throw new Error('TMDB search result has no title')
      }

      const posterPath = result.poster_path
      const hasPoster = posterPath !== null && posterPath !== undefined && /^\/[a-zA-Z0-9]+\.(?:jpg|jpeg|png|webp)$/u.test(posterPath)
      const posterUrl = hasPoster ? `https://image.tmdb.org/t/p/w500${posterPath}` : null

      return {
        id: result.id,
        type,
        title: title.trim(),
        originalTitle: originalTitle.trim(),
        posterUrl,
        year: sourceYear(date)
      }
    })

    return {
      items,
      nextPage: page < Math.min(response.total_pages, 500) ? page + 1 : null
    }
  } catch (error) {
    throw new ImportSourceError('tmdb', 'source_invalid', { cause: error })
  }
}

async function searchTvmaze(query: string, options: SourceHttpOptions = {}): Promise<ImportShowSearchResponse> {
  const url = new URL('https://api.tvmaze.com/search/shows')

  url.searchParams.set('q', query)

  const input = await fetchSourceJson({
    provider: 'tvmaze',
    url: url.href,
    maxBytes: 8 * 1024 * 1024
  }, options)

  try {
    const response = v.parse(tvmazeSearchSchema, input)

    const items = response.map(({ show }) => {return {
      id: show.id,
      title: show.name.trim(),
      year: sourceYear(show.premiered),
      imdbId: show.externals?.imdb?.trim() === '' ? null : show.externals?.imdb?.trim() ?? null,
      thetvdbId: show.externals?.thetvdb ?? null
    }})

    if (items.some(item => item.title === '')) {
      throw new Error('TVMaze search result has no title')
    }

    return { items }
  } catch (error) {
    throw new ImportSourceError('tvmaze', 'source_invalid', { cause: error })
  }
}

export { parseImportSearchPage, parseImportSearchQuery, searchTmdb, searchTvmaze }
