import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { movie, summary } from '../../testing/viewing-fixtures.ts'
import { catalogViewingHistoryResponseSchema, catalogViewingSummaryResponseSchema } from '../catalog-response.ts'

describe('viewing response validation', () => {
  it('accepts calendar dates and zero counts', () => {
    const response = {
      items: [movie],
      nextCursor: null
    }

    expect(v.parse(catalogViewingHistoryResponseSchema, response)).toStrictEqual(response)
    expect(v.parse(catalogViewingSummaryResponseSchema, summary)).toStrictEqual(summary)
  })

  it.each([
    { completedOn: 'yesterday' },
    { completedOn: '2026-02-30' },
    { completedOn: null },
    { viewingId: 'not-a-uuid' },
    { posterUrl: 'https://untrusted.example/poster.png' },
    { status: 'watching' },
    {
      type: 'series',
      startedOn: null
    },
    {
      type: 'series',
      startedOn: '2026-10-01'
    },
    { score: 11 }
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

  it('rejects overlong pages, negative totals, and overlong active lists', () => {
    const tooMany = {
      items: Array.from({ length: 21 }, () => movie),
      nextCursor: null
    }

    const negative = {
      ...summary,
      watchedMovieCount: -1
    }

    const tooManySeries = {
      ...summary,

      activeSeries: Array.from({ length: 6 }, () => {return {
        ...movie,
        type: 'series',
        startedOn: '2026-09-22',
        watchedEpisodeCount: 0
      }})
    }

    expect(v.safeParse(catalogViewingHistoryResponseSchema, tooMany).success).toBe(false)
    expect(v.safeParse(catalogViewingSummaryResponseSchema, negative).success).toBe(false)
    expect(v.safeParse(catalogViewingSummaryResponseSchema, tooManySeries).success).toBe(false)
  })
})
