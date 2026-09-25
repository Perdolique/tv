import { describe, expect, it } from 'vitest'
import { inspectCatalogState, type CatalogState } from '../catalog-state.ts'
import { normalizeTvmaze } from '../sources.ts'
import { showResponse } from '../../../testing/import-fixtures.ts'

describe('import catalog-state contract', () => {
  it('does not depend on the JSONB key order of a saved selection', () => {
    const state: CatalogState = {
      items: [],
      titles: [],
      episodes: [],
      links: []
    }

    const first = inspectCatalogState(state, {
      type: 'series',
      tmdbId: 1,

      tvmaze: {
        status: 'selected',
        id: 2
      }
    }, [])

    const second = inspectCatalogState(state, {
      tvmaze: {
        id: 2,
        status: 'selected'
      },

      tmdbId: 1,
      type: 'series'
    }, [])

    expect(first.fingerprint).toBe(second.fingerprint)
  })

  it('blocks an incompatible catalog type even if stored links are inconsistent', () => {
    const state: CatalogState = {
      items: [{
        id: 'item',
        type: 'series',
        releaseYear: null,
        posterPath: null
      }],

      titles: [],
      episodes: [],

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
    }, [])

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
      items: [{
        id: 'item',
        type: 'series',
        releaseYear: null,
        posterPath: null
      }],

      titles: [],
      episodes: [episode],

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

    const first = inspectCatalogState(state, selection, source.episodes)

    episode.sourceTitle = 'Manual edit'

    const changed = inspectCatalogState(state, selection, source.episodes)

    expect(first.errors).toStrictEqual([])
    expect(first.additions.episodeIds).toStrictEqual(['910002'])
    expect(changed.fingerprint).not.toBe(first.fingerprint)
  })
})
