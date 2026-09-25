import { assert, describe, expect, it, vi } from 'vitest'
import type { ImportSourceError } from '../source-http.ts'
import { parseImportSearchPage, parseImportSearchQuery, searchTmdb, searchTvmaze } from '../search.ts'

describe('operator source search', () => {
  it('keeps same-name TMDB candidates distinct by exact ID, year, and type', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      page: 2,
      total_pages: 3,

      results: [{
        id: 10,
        title: 'The Return',
        original_title: 'The Return',
        release_date: '2003-06-01',
        poster_path: '/returnedPoster.jpg'
      },
        {
        id: 11,
        title: 'The Return',
        original_title: 'Возвращение',
        release_date: '2026-02-10'
      }]
    }))

    const result = await searchTmdb({
      type: 'movie',
      query: 'The Return',
      page: 2,
      token: 'test-token'
    }, { fetch: fetcher })

    expect(result).toStrictEqual({
      items: [
        {
        id: 10,
        title: 'The Return',
        originalTitle: 'The Return',
        posterUrl: 'https://image.tmdb.org/t/p/w500/returnedPoster.jpg',
        year: 2003,
        type: 'movie'
      },
        {
        id: 11,
        title: 'The Return',
        originalTitle: 'Возвращение',
        posterUrl: null,
        year: 2026,
        type: 'movie'
      }
      ],

      nextPage: 3
    })

    const [call] = fetcher.mock.calls

    assert(call !== undefined)

    const [url, options] = call

    expect(url).toContain('/search/movie?')
    expect(url).toContain('page=2')
    expect(new Headers(options?.headers).get('authorization')).toBe('Bearer test-token')
  })

  it.each([null, undefined, '//other.example/poster.jpg', '/../poster.jpg', '/poster.jpg?token=secret', '/poster.svg'])('omits unusable search artwork (%s) without losing the title', async (posterPath) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      page: 1,
      total_pages: 1,

      results: [{
        id: 10,
        name: 'The Bridge',
        original_name: 'Bron',
        poster_path: posterPath
      }]
    }))

    const result = await searchTmdb({
      type: 'series',
      query: 'Bridge',
      page: 1,
      token: 'token'
    }, { fetch: fetcher })

    expect(result.items).toStrictEqual([{
      id: 10,
      title: 'The Bridge',
      originalTitle: 'Bron',
      posterUrl: null,
      year: null,
      type: 'series'
    }])

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('returns an empty page and keeps TVMaze same-name shows distinct', async () => {
    const empty = await searchTmdb({
      type: 'series',
      query: 'Missing',
      page: 1,
      token: 'token'
    }, {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json({
        page: 1,
        total_pages: 0,
        results: []
      }))
    })

    expect(empty).toStrictEqual({
      items: [],
      nextPage: null
    })

    const shows = await searchTvmaze('The Bridge', {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json([
        { show: {
        id: 1,
        name: 'The Bridge',
        premiered: '2011-09-21',

        externals: {
          imdb: 'tt1733785',
          thetvdb: 252_019
        }
      } },
        { show: {
        id: 2,
        name: 'The Bridge',
        premiered: '2013-07-10',

        externals: {
          imdb: 'tt2406376',
          thetvdb: 263_069
        }
      } }
      ]))
    })

    expect(shows.items.map(item => [item.id, item.year, item.imdbId])).toStrictEqual([
      [1, 2011, 'tt1733785'], [2, 2013, 'tt2406376']
    ])
  })

  it('rejects invalid input and reports a temporary source failure with retry time', async () => {
    expect(() => parseImportSearchQuery(' ')).toThrow('The request is invalid.')
    expect(() => parseImportSearchPage('501')).toThrow('The request is invalid.')

    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 429,
      headers: { 'Retry-After': '12' }
    }))

    await expect(searchTvmaze('Bridge', { fetch: fetcher })).rejects.toMatchObject({
      code: 'source_unavailable',
      retryAfterSeconds: 12
    } satisfies Partial<ImportSourceError>)

    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
