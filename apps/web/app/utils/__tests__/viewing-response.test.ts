import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { movie, summary } from '../../testing/viewing-fixtures.ts'
import { catalogViewingHistoryResponseSchema, catalogViewingSummaryResponseSchema } from '../catalog-response.ts'

describe('viewing response validation', () => {
  it('accepts exact timestamp strings and zero counts', () => {
    const response = {
      items: [movie],
      nextCursor: null
    }

    expect(v.parse(catalogViewingHistoryResponseSchema, response)).toStrictEqual(response)
    expect(v.parse(catalogViewingSummaryResponseSchema, summary)).toStrictEqual(summary)
  })

  it.each([
    { markedAt: 'yesterday' },
    { markedAt: '2026-09-22T13:00:00.123Z' },
    { entryId: 'not-a-uuid' },
    { posterUrl: 'https://untrusted.example/poster.png' },
    {
      kind: 'episode',
      type: 'movie'
    },
    {
      kind: 'episode',
      type: 'series',
      seasonNumber: 0,
      episodeNumber: 1
    }
  ])('rejects malformed history metadata: %j', (override) => {
    const response = {
      items: [{
        ...movie,
        ...override
      }],

      nextCursor: null
    }

    expect(v.safeParse(catalogViewingHistoryResponseSchema, response).success).toBe(false)
  })

  it('rejects overlong pages, negative totals, and series without a watched episode', () => {
    const tooMany = {
      items: Array.from({ length: 21 }, () => movie),
      nextCursor: null
    }

    const negative = {
      ...summary,
      watchedMovieCount: -1
    }

    const emptySeries = {
      ...summary,

      series: [{
        ...movie,
        type: 'series',
        watchedEpisodeCount: 0
      }]
    }

    expect(v.safeParse(catalogViewingHistoryResponseSchema, tooMany).success).toBe(false)
    expect(v.safeParse(catalogViewingSummaryResponseSchema, negative).success).toBe(false)
    expect(v.safeParse(catalogViewingSummaryResponseSchema, emptySeries).success).toBe(false)
  })
})
