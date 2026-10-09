import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import { catalogSeriesWatchesResponseSchema } from '@tv/shared/catalog-series'

describe('series viewing response', () => {
  it('accepts watched episode context and rejects legacy, malformed, or extra data', () => {
    const response = {
      watchedEpisodeIds: ['01991a00-0000-7000-8000-000000000001'],

      watches: [{
        id: '01991a00-0000-7000-8000-000000000003',
        catalogEpisodeId: '01991a00-0000-7000-8000-000000000001',
        viewingId: '01991a00-0000-7000-8000-000000000004',
        markedAt: '2026-10-08T07:00:00.123456Z'
      }],

      currentViewing: {
        id: '01991a00-0000-7000-8000-000000000004',
        catalogItemId: '01991a00-0000-7000-8000-000000000005',
        status: 'watching',
        isRewatch: false,
        recordedAt: '2026-10-08T07:00:00.123456Z',
        revision: 1
      },

      contextVersion: 1
    }

    expect(v.parse(catalogSeriesWatchesResponseSchema, response)).toStrictEqual(response)
    expect(v.safeParse(catalogSeriesWatchesResponseSchema, { watchedEpisodeIds: [] }).success).toBe(false)

    expect(v.safeParse(catalogSeriesWatchesResponseSchema, {
      ...response,
      watchedEpisodeIds: ['bad-id']
    }).success).toBe(false)

    expect(v.safeParse(catalogSeriesWatchesResponseSchema, {
      ...response,
      extra: true
    }).success).toBe(false)
  })

})
