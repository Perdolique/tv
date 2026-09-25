import { describe, expect, it } from 'vitest'
import { movieResponse } from '../../../testing/import-fixtures.ts'
import { planImportChanges } from '../changes.ts'
import type { CatalogState } from '../catalog-state.ts'
import { normalizeTmdb } from '../sources.ts'

describe('import field change planning', () => {
  it('updates a poster after an editor restores the last applied path', () => {
    const selection = {
      type: 'movie',
      tmdbId: 603
    } as const

    const { card } = normalizeTmdb(selection, {
      ...movieResponse(),
      poster_path: '/new.png'
    })

    const appliedPosterPath = '/api/posters/old.webp'

    const state: CatalogState = {
      items: [{
        id: 'item',
        type: 'movie',
        releaseYear: 2026,
        posterPath: appliedPosterPath
      }],

      titles: [],
      descriptions: [],
      episodes: [],
      links: [],

      fields: [{
        id: 'field',
        catalogItemId: 'item',
        catalogEpisodeId: null,
        fieldName: 'posterPath',
        locale: '',
        source: card.posterPath.source,

        lastSourceValue: {
          value: '/new.png',
          hash: 'new-hash'
        },

        lastAppliedValue: {
          value: appliedPosterPath,
          hash: 'old-hash'
        },

        reviewedAt: new Date('2026-09-25T10:00:00Z')
      }]
    }

    const plan = planImportChanges(state, {
      card,
      episodes: [],
      catalogItemId: 'item',
      posterHash: 'new-hash'
    })

    expect(plan.changes).toContainEqual(expect.objectContaining({
      target: 'item',
      field: 'posterPath',
      action: 'update',
      before: appliedPosterPath,
      sourceHash: 'new-hash'
    }))
  })
})
