import type { CatalogEpisode } from '../../../packages/shared/src/catalog.ts'
import { chernobyl, episodeEdgeSeries, manyEpisodeSeries } from './details.fixtures.ts'

const chernobylEpisodes = [
  {
    id: '30000000-0000-7000-8000-000000000001',
    seasonNumber: 1,
    episodeNumber: 1,
    sourceTitle: '1:23:45',
    airDate: '2019-05-06'
  },
  {
    id: '30000000-0000-7000-8000-000000000002',
    seasonNumber: 1,
    episodeNumber: 2,
    sourceTitle: 'Please Remain Calm',
    airDate: '2019-05-13'
  },
  {
    id: '30000000-0000-7000-8000-000000000003',
    seasonNumber: 1,
    episodeNumber: 3,
    sourceTitle: 'Open Wide, O Earth',
    airDate: '2019-05-20'
  },
  {
    id: '30000000-0000-7000-8000-000000000004',
    seasonNumber: 1,
    episodeNumber: 4,
    sourceTitle: 'The Happiness of All Mankind',
    airDate: '2019-05-27'
  },
  {
    id: '30000000-0000-7000-8000-000000000005',
    seasonNumber: 1,
    episodeNumber: 5,
    sourceTitle: 'Vichnaya Pamyat',
    airDate: '2019-06-03'
  }
] as const satisfies readonly CatalogEpisode[]

const edgeCaseEpisodes = [
  {
    id: '30000000-0000-7000-8000-000000000011',
    seasonNumber: 1,
    episodeNumber: 1,
    sourceTitle: null,
    airDate: null
  },
  {
    id: '30000000-0000-7000-8000-000000000012',
    seasonNumber: 1,
    episodeNumber: 2,
    sourceTitle: ' TBA ',
    airDate: '2099-01-01'
  },
  {
    id: '30000000-0000-7000-8000-000000000013',
    seasonNumber: 2,
    episodeNumber: 1,
    sourceTitle: '',
    airDate: '2099-02-01'
  },
  {
    id: '30000000-0000-7000-8000-000000000014',
    seasonNumber: 2,
    episodeNumber: 2,
    sourceTitle: 'A future title',
    airDate: '2099-02-08'
  }
] as const satisfies readonly CatalogEpisode[]

const manyEpisodes = Array.from({ length: 20 }, (_value, index) => {
  const episodeNumber = index + 1
  const identifierNumber = String(100 + episodeNumber)
  const suffix = identifierNumber.padStart(12, '0')
  const unbrokenTitle = 'UnbrokenTitle'.repeat(12)
  const sourceTitle = episodeNumber === 1 ? `A very long episode title with an unbroken word: ${unbrokenTitle}` : null

  return {
    id: `30000000-0000-7000-8000-${suffix}`,
    seasonNumber: 1,
    episodeNumber,
    sourceTitle,
    airDate: null
  } as const satisfies CatalogEpisode
})

const episodeFixtures = new Map<string, readonly CatalogEpisode[]>([
  [chernobyl.id, chernobylEpisodes],
  [manyEpisodeSeries.id, manyEpisodes],
  [episodeEdgeSeries.id, edgeCaseEpisodes]
])

export { episodeFixtures }
