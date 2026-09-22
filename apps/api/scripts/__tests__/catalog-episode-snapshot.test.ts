import * as v from 'valibot'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { catalogEpisodeSources, type CatalogEpisodeSource } from '../catalog-episode-sources.ts'
import { createSnapshotSeries, episodeSnapshotSchema, renderEpisodeMigration } from '../catalog-episode-snapshot.ts'

const source: CatalogEpisodeSource = {
  title: 'Cyberpunk: Edgerunners',
  year: 2022,
  showId: 48_945,
  premiered: '2022-09-13',
  language: 'Japanese',
  seasonRestriction: 1
}

const firstEpisode = {
  id: 100,
  season: 1,
  number: 1,
  type: 'regular',
  name: 'A viewer\'s choice',
  airdate: '2022-09-13'
}

function show(episodes: unknown[]): unknown {
  return {
    id: source.showId,
    name: source.title,
    premiered: source.premiered,
    language: source.language,
    _embedded: { episodes }
  }
}

describe('manual TVMaze episode snapshots', () => {
  it('keeps regular episodes in coordinate order and excludes specials and the original show sequel season', () => {
    const response = show([
      {
        ...firstEpisode,
        id: 101,
        number: 2,
        name: 'TBA',
        airdate: ''
      },
      {
        ...firstEpisode,
        id: 102,
        season: 2
      },
      {
        type: 'significant_special',
        number: null
      },
      {
        type: 'insignificant_special',
        number: null
      },
      firstEpisode
    ])

    const result = createSnapshotSeries(source, response)

    expect(result.episodes).toStrictEqual([
      {
        tvmazeId: 100,
        season: 1,
        number: 1,
        title: 'A viewer\'s choice',
        airDate: '2022-09-13'
      },
      {
        tvmazeId: 101,
        season: 1,
        number: 2,
        title: 'TBA',
        airDate: null
      }
    ])
  })

  it.each([
    { showId: 88_337 },
    { title: 'Another adaptation' },
    { premiered: '1987-09-24' },
    { language: 'English' }
  ])('rejects a changed show identity %#', (override) => {
    const changedSource = {
      ...source,
      ...override
    }

    const response = show([firstEpisode])

    expect(() => createSnapshotSeries(changedSource, response)).toThrow('identity changed')
  })

  it.each([
    null,
    {
      type: 'regular',
      id: 100
    },
    {
      ...firstEpisode,
      id: -1
    },
    {
      ...firstEpisode,
      number: null
    },
    {
      ...firstEpisode,
      number: 1.5
    },
    {
      ...firstEpisode,
      season: 0
    },
    {
      ...firstEpisode,
      airdate: 'not-a-date'
    }
  ])('rejects malformed regular episode data %#', (episode) => {
    const response = show([episode])

    expect(() => createSnapshotSeries(source, response)).toThrow(/Invalid/u)
  })

  it.each([
    {
      ...firstEpisode,
      id: 101
    },
    {
      ...firstEpisode,
      number: 2
    }
  ])('rejects duplicate coordinates or source IDs %#', (duplicate) => {
    const response = show([firstEpisode, duplicate])

    expect(() => createSnapshotSeries(source, response)).toThrow('Duplicate TVMaze episode')
  })

  it('accepts an empty episode list without inventing future episodes', () => {
    const response = show([])
    const result = createSnapshotSeries(source, response)

    expect(result.episodes).toStrictEqual([])
  })

  it('keeps nullable episode names and dates for the existing UI fallback', () => {
    const response = show([{
      ...firstEpisode,
      name: null,
      airdate: null
    }])

    const result = createSnapshotSeries(source, response)

    expect(result.episodes).toStrictEqual([
      {
        tvmazeId: 100,
        season: 1,
        number: 1,
        title: null,
        airDate: null
      }
    ])
  })

  it('rejects a shared source episode across distinct shows', () => {
    const response = show([firstEpisode])
    const firstSeries = createSnapshotSeries(source, response)

    const secondSource = {
      ...source,
      showId: 88_337
    }

    const secondSeries = {
      source: secondSource,
      episodes: firstSeries.episodes
    }

    const snapshot = {
      checkedOn: '2026-09-22',
      series: [firstSeries, secondSeries]
    }

    expect(() => renderEpisodeMigration(snapshot)).toThrow('Duplicate TVMaze episode ID')
  })

  it('reproduces the committed migration exactly from the reviewed snapshot', async () => {
    const snapshotUrl = new URL('../../../../packages/database/data/catalog-episodes.json', import.meta.url)
    const migrationUrl = new URL('../../../../packages/database/migrations/20260922115517_fill_catalog_episodes/migration.sql', import.meta.url)
    const serialized = await readFile(snapshotUrl, 'utf8')
    const snapshot = v.parse(episodeSnapshotSchema, JSON.parse(serialized))
    const committed = await readFile(migrationUrl, 'utf8')
    const sources = snapshot.series.map(series => series.source)
    const migration = renderEpisodeMigration(snapshot)

    expect(sources).toStrictEqual(catalogEpisodeSources)
    expect(migration).toBe(committed)
  })
})
