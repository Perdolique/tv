// Expected values for the catalog's data-only release migrations.
interface SeededCatalogItem {
  id: string;
  releases: string[];
  releaseYear: number;
  title: string;
  type: 'movie' | 'series';
}

const seededIds = {
  aDifferentWorld: '10000000-0000-7000-8000-000000000019',
  americanHorrorStory: '10000000-0000-7000-8000-000000000013',
  avengersDoomsday: '10000000-0000-7000-8000-000000000016',
  cyberpunkEdgerunners2: '10000000-0000-7000-8000-000000000025',
  forsytes: '10000000-0000-7000-8000-000000000017',
  heartland: '10000000-0000-7000-8000-000000000023',
  percyJackson: '10000000-0000-7000-8000-000000000014',
  prideAndPrejudice: '10000000-0000-7000-8000-000000000021',
  southPark: '10000000-0000-7000-8000-000000000018',
  steps: '10000000-0000-7000-8000-000000000024',
  sunriseOnTheReaping: '10000000-0000-7000-8000-000000000015',
  theGold: '10000000-0000-7000-8000-000000000022'
} as const

function createEpisodeReleaseDates(date: string, seasonNumber: number, episodeCount: number): string[] {
  return Array.from(
    { length: episodeCount },
    (_value, episodeIndex) => `${date}:S${seasonNumber}:E${episodeIndex + 1}`
  )
}

const seededCatalogItems = [
  {
    id: seededIds.americanHorrorStory,

    releases: [
      '2026-09-24:S13:E1',
      '2026-09-24:S13:E2',
      '2026-09-24:S13:E3',
      '2026-10-01:S13:E4',
      '2026-10-01:S13:E5',
      '2026-10-01:S13:E6',
      '2026-10-08:S13:E7',
      '2026-10-08:S13:E8',
      '2026-10-15:S13:E9',
      '2026-10-15:S13:E10',
      '2026-10-22:S13:E11',
      '2026-10-22:S13:E12',
      '2026-10-29:S13:E13'
    ],

    releaseYear: 2011,
    title: 'American Horror Story',
    type: 'series'
  },
  {
    id: seededIds.percyJackson,
    releases: ['2026-11-20:S3'],
    releaseYear: 2023,
    title: 'Percy Jackson and the Olympians',
    type: 'series'
  },
  {
    id: seededIds.sunriseOnTheReaping,
    releases: ['2026-11-20'],
    releaseYear: 2026,
    title: 'The Hunger Games: Sunrise on the Reaping',
    type: 'movie'
  },
  {
    id: seededIds.avengersDoomsday,
    releases: ['2026-12-18'],
    releaseYear: 2026,
    title: 'Avengers: Doomsday',
    type: 'movie'
  },
  {
    id: seededIds.forsytes,

    releases: [
      '2026-03-22:S1:E1',
      '2026-03-29:S1:E2',
      '2026-04-05:S1:E3',
      '2026-04-12:S1:E4',
      '2026-04-19:S1:E5',
      '2026-04-26:S1:E6'
    ],

    releaseYear: 2025,
    title: 'The Forsytes',
    type: 'series'
  },
  {
    id: seededIds.southPark,

    releases: [
      '2026-09-16:S29:E1',
      '2026-09-30:S29:E2',
      '2026-10-14:S29:E3',
      '2026-10-28:S29:E4',
      '2026-11-11:S29:E5',
      '2026-11-25:S29:E6'
    ],

    releaseYear: 1997,
    title: 'South Park',
    type: 'series'
  },
  {
    id: seededIds.aDifferentWorld,
    releases: createEpisodeReleaseDates('2026-09-24', 1, 10),
    releaseYear: 2026,
    title: 'A Different World',
    type: 'series'
  },
  {
    id: seededIds.prideAndPrejudice,
    releases: createEpisodeReleaseDates('2026-12-03', 1, 6),
    releaseYear: 2026,
    title: 'Pride and Prejudice',
    type: 'series'
  },
  {
    id: seededIds.theGold,
    releases: ['2026-10-18:S2'],
    releaseYear: 2023,
    title: 'The Gold',
    type: 'series'
  },
  {
    id: seededIds.heartland,
    releases: ['2026-11-13'],
    releaseYear: 2026,
    title: 'Heartland',
    type: 'movie'
  },
  {
    id: seededIds.steps,
    releases: ['2026-11-20'],
    releaseYear: 2026,
    title: 'Steps',
    type: 'movie'
  },
  {
    id: seededIds.cyberpunkEdgerunners2,
    releases: createEpisodeReleaseDates('2026-10-20', 1, 10),
    releaseYear: 2026,
    title: 'Cyberpunk: Edgerunners 2',
    type: 'series'
  }
] as const satisfies readonly SeededCatalogItem[]

const seededReleaseCatalogItemIds = seededCatalogItems.map(item => item.id)

export {
  type SeededCatalogItem,
  seededCatalogItems,
  seededReleaseCatalogItemIds
}
