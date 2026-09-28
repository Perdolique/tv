import type { ImportCatalogMatch, ImportPreviewData } from '@tv/shared/catalog-import'
import { describe, expect, it } from 'vitest'
import { inspectCatalogState, type CatalogState } from '../catalog-state.ts'
import { normalizeTvmaze } from '../sources.ts'
import { showResponse } from '../../../testing/import-fixtures.ts'

const candidate: ImportCatalogMatch = {
  id: 'item',
  title: 'Title',
  year: null,
  type: 'movie',
  kind: 'exact_source',
  sources: []
}

const existingReview = {
  card: null,

  target: {
    kind: 'existing',
    catalogItemId: 'item'
  },

  candidates: [candidate]
} satisfies Pick<ImportPreviewData, 'card' | 'target' | 'candidates'>

const newReview = {
  card: null,
  target: { kind: 'new' as const },
  candidates: []
}

describe('import catalog-state contract', () => {
  it('does not depend on the JSONB key order of a saved selection', () => {
    const state: CatalogState = {
      candidateKeys: [],
      items: [],
      titles: [],
      descriptions: [],
      episodes: [],
      links: [],
      fields: []
    }

    const first = inspectCatalogState(state, {
      type: 'series',
      tmdbId: 1,

      tvmaze: {
        status: 'selected',
        id: 2
      }
    }, {
      ...newReview,
      episodes: []
    })

    const second = inspectCatalogState(state, {
      tvmaze: {
        id: 2,
        status: 'selected'
      },

      tmdbId: 1,
      type: 'series'
    }, {
      ...newReview,
      episodes: []
    })

    expect(first.fingerprint).toBe(second.fingerprint)
  })

  it('blocks an incompatible catalog type even if stored links are inconsistent', () => {
    const state: CatalogState = {
      candidateKeys: ['exact_source:item'],

      items: [{
        id: 'item',
        type: 'series',
        releaseYear: null,
        posterPath: null
      }],

      titles: [],
      descriptions: [],
      episodes: [],
      fields: [],

      links: [{
        provider: 'tmdb',
        entityType: 'movie',
        externalId: '603',
        catalogItemId: 'item',
        catalogEpisodeId: null
      }]
    }

    const result = inspectCatalogState(state, {
      type: 'movie',
      tmdbId: 603
    }, {
      ...existingReview,
      episodes: []
    })

    expect(result.errors).toStrictEqual([{
      code: 'title_type_conflict',
      message: 'The selected source has a different catalog type.'
    }])
  })

  it('uses stable episode links, not just matching coordinates, and fingerprints local episode changes', () => {
    const source = normalizeTvmaze(48_945, showResponse())

    const selection = {
      type: 'series',
      tmdbId: 1,

      tvmaze: {
        status: 'selected',
        id: 48_945
      }
    } as const

    const episode: CatalogState['episodes'][number] = {
      id: 'episode',
      catalogItemId: 'item',
      seasonNumber: 1,
      episodeNumber: 1,
      sourceTitle: null,
      airDate: null
    }

    const state: CatalogState = {
      candidateKeys: ['exact_source:item'],

      items: [{
        id: 'item',
        type: 'series',
        releaseYear: null,
        posterPath: null
      }],

      titles: [],
      descriptions: [],
      episodes: [episode],
      fields: [],

      links: [
        {
        provider: 'tmdb',
        entityType: 'tv',
        externalId: '1',
        catalogItemId: 'item',
        catalogEpisodeId: null
      },
        {
        provider: 'tvmaze',
        entityType: 'episode',
        externalId: '910001',
        catalogItemId: null,
        catalogEpisodeId: 'episode'
      }
      ]
    }

    const first = inspectCatalogState(state, selection, {
      ...existingReview,
      episodes: source.episodes
    })

    episode.sourceTitle = 'Manual edit'

    const changed = inspectCatalogState(state, selection, {
      ...existingReview,
      episodes: source.episodes
    })

    expect(first.errors).toStrictEqual([])
    expect(first.additions.episodeExternalIds).toStrictEqual(['910002'])
    expect(changed.fingerprint).not.toBe(first.fingerprint)

    episode.episodeNumber = 3

    const relocated = inspectCatalogState(state, selection, {
      ...existingReview,
      episodes: source.episodes
    })

    expect(relocated.errors.map(problem => problem.code)).toContain('episode_coordinates_changed')
  })
})
