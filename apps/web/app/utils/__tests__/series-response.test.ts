import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import type { CatalogViewing } from '@tv/shared/catalog-viewings'
import { catalogSeriesWatchesResponseSchema, type CatalogSeriesWatchesResponse } from '@tv/shared/catalog-series'

describe('series viewing response', () => {
  it('accepts watched episode context and rejects legacy, malformed, or extra data', () => {
    const viewing = {
      id: '01991a00-0000-7000-8000-000000000004',
      catalogItemId: '01991a00-0000-7000-8000-000000000005',
      status: 'watching',
      startedOn: '2026-10-08',
      completedOn: null,
      isRewatch: false,
      canCancelRewatch: false,
      recordedAt: '2026-10-08T07:00:00.123456Z',
      revision: 1,
      score: null
    } satisfies CatalogViewing

    const response = {
      watches: [{
        id: '01991a00-0000-7000-8000-000000000003',
        catalogEpisodeId: '01991a00-0000-7000-8000-000000000001',
        viewingId: '01991a00-0000-7000-8000-000000000004',
        markedAt: '2026-10-08T07:00:00.123456Z'
      }],

      viewing,

      summary: {
        completedCount: 0,
        currentViewingId: viewing.id,
        contextVersion: 1,
        currentViewingScore: null,
        currentVoteScore: null
      }
    } satisfies CatalogSeriesWatchesResponse

    expect(v.parse(catalogSeriesWatchesResponseSchema, response)).toStrictEqual(response)
    expect(v.safeParse(catalogSeriesWatchesResponseSchema, { watchedEpisodeIds: [] }).success).toBe(false)

    expect(v.safeParse(catalogSeriesWatchesResponseSchema, {
      ...response,

      watches: [{
        ...response.watches[0],
        catalogEpisodeId: 'bad-id'
      }]
    }).success).toBe(false)

    expect(v.safeParse(catalogSeriesWatchesResponseSchema, {
      ...response,
      extra: true
    }).success).toBe(false)
  })

})
