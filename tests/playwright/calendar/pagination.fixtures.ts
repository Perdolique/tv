import type { CatalogReleaseItem } from '../../../packages/shared/src/catalog.ts'

type CalendarFixtureItem = Pick<
  CatalogReleaseItem,
  'id' | 'originalTitle' | 'originalTitleLocale' | 'posterUrl' | 'releaseYear' | 'title' | 'titleLocale' | 'type'
>

interface EpisodeBatchOptions {
  episodeCount: number;
  firstReleaseId: number;
  item: CalendarFixtureItem;
  releaseDate: string;
  seasonNumber: number;
}

interface DatedEpisodesOptions {
  firstReleaseId: number;
  item: CalendarFixtureItem;
  releaseDates: string[];
  seasonNumber: number;
}

interface ItemOptions {
  id: string;
  releaseYear: number;
  title: string;
  type: CalendarFixtureItem['type'];
}

interface ReleaseOptions {
  episodeNumber: number | null;
  releaseDate: string;
  releaseId: number;
  seasonNumber: number | null;
}

function createItem(options: ItemOptions): CalendarFixtureItem {
  return {
    id: options.id,
    originalTitle: options.title,
    originalTitleLocale: 'en',
    posterUrl: null,
    releaseYear: options.releaseYear,
    title: options.title,
    titleLocale: 'en',
    type: options.type
  }
}

function createMovie(id: string, title: string): CalendarFixtureItem {
  return createItem({
    id,
    releaseYear: 2026,
    title,
    type: 'movie'
  })
}

function createSeries(id: string, title: string, releaseYear: number): CalendarFixtureItem {
  return createItem({
    id,
    releaseYear,
    title,
    type: 'series'
  })
}

function createRelease(item: CalendarFixtureItem, options: ReleaseOptions): CatalogReleaseItem {
  return {
    episodeNumber: options.episodeNumber,
    ...item,
    releaseDate: options.releaseDate,
    releaseId: `01991a00-0000-7000-8000-${String(options.releaseId).padStart(12, '0')}`,
    seasonNumber: options.seasonNumber
  }
}

function createEpisodeBatch(options: EpisodeBatchOptions): CatalogReleaseItem[] {
  return Array.from({ length: options.episodeCount }, (_value, episodeIndex) => createRelease(options.item, {
    episodeNumber: episodeIndex + 1,
    releaseDate: options.releaseDate,
    releaseId: options.firstReleaseId + episodeIndex,
    seasonNumber: options.seasonNumber
  }))
}

function createDatedEpisodes(options: DatedEpisodesOptions): CatalogReleaseItem[] {
  return options.releaseDates.map((releaseDate, episodeIndex) => createRelease(options.item, {
    episodeNumber: episodeIndex + 1,
    releaseDate,
    releaseId: options.firstReleaseId + episodeIndex,
    seasonNumber: options.seasonNumber
  }))
}

const forsytes = createSeries('01991a00-0000-7000-8000-000000000010', 'The Forsytes', 2025)
const southPark = createSeries('01991a00-0000-7000-8000-000000000011', 'South Park', 1997)
const aDifferentWorld = createSeries('01991a00-0000-7000-8000-000000000012', 'A Different World', 2026)

const cyberpunkEdgerunners = createSeries(
  '01991a00-0000-7000-8000-000000000013',
  'Cyberpunk: Edgerunners',
  2022
)

const prideAndPrejudice = createSeries(
  '01991a00-0000-7000-8000-000000000014',
  'Pride and Prejudice',
  2026
)

const theGold = createSeries('01991a00-0000-7000-8000-000000000015', 'The Gold', 2023)
const heartland = createMovie('01991a00-0000-7000-8000-000000000016', 'Heartland')
const steps = createMovie('01991a00-0000-7000-8000-000000000017', 'Steps')

const paginationCalendarReleases = [
  ...createDatedEpisodes({
    firstReleaseId: 126,
    item: forsytes,

    releaseDates: [
      '2026-03-22',
      '2026-03-29',
      '2026-04-05',
      '2026-04-12',
      '2026-04-19',
      '2026-04-26'
    ],

    seasonNumber: 1
  }),
  ...createDatedEpisodes({
    firstReleaseId: 132,
    item: southPark,

    releaseDates: [
      '2026-09-16',
      '2026-09-30',
      '2026-10-14',
      '2026-10-28',
      '2026-11-11',
      '2026-11-25'
    ],

    seasonNumber: 29
  }),
  ...createEpisodeBatch({
    episodeCount: 10,
    firstReleaseId: 138,
    item: aDifferentWorld,
    releaseDate: '2026-09-24',
    seasonNumber: 1
  }),
  ...createEpisodeBatch({
    episodeCount: 10,
    firstReleaseId: 148,
    item: cyberpunkEdgerunners,
    releaseDate: '2026-10-20',
    seasonNumber: 2
  }),
  ...createEpisodeBatch({
    episodeCount: 6,
    firstReleaseId: 158,
    item: prideAndPrejudice,
    releaseDate: '2026-12-03',
    seasonNumber: 1
  }),
  createRelease(theGold, {
    episodeNumber: null,
    releaseDate: '2026-10-18',
    releaseId: 164,
    seasonNumber: 2
  }),
  createRelease(heartland, {
    episodeNumber: null,
    releaseDate: '2026-11-13',
    releaseId: 165,
    seasonNumber: null
  }),
  createRelease(steps, {
    episodeNumber: null,
    releaseDate: '2026-11-20',
    releaseId: 166,
    seasonNumber: null
  })
] as const satisfies readonly CatalogReleaseItem[]

export { paginationCalendarReleases }
