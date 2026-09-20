import type { CatalogReleaseItem } from '../../../packages/shared/src/catalog.ts'
import { dark, longTitle } from '../catalog/fixtures.ts'
import { dune } from '../catalog/details.fixtures.ts'
import { paginationCalendarReleases } from './pagination.fixtures.ts'

type CalendarFixtureItem = Pick<
  CatalogReleaseItem,
  'id' | 'originalTitle' | 'originalTitleLocale' | 'posterUrl' | 'releaseYear' | 'title' | 'titleLocale' | 'type'
>

interface CalendarReleaseFixtureOptions {
  episodeNumber: number | null;
  releaseDate: string;
  releaseId: string;
  seasonNumber: number | null;
}

const americanHorrorStory = {
  id: '01991a00-0000-7000-8000-000000000006',
  originalTitle: 'American Horror Story',
  originalTitleLocale: 'en',
  posterUrl: null,
  releaseYear: 2011,
  title: 'American Horror Story',
  titleLocale: 'en',
  type: 'series'
} as const satisfies CalendarFixtureItem

const percyJackson = {
  id: '01991a00-0000-7000-8000-000000000007',
  originalTitle: 'Percy Jackson and the Olympians',
  originalTitleLocale: 'en',
  posterUrl: null,
  releaseYear: 2023,
  title: 'Percy Jackson and the Olympians',
  titleLocale: 'en',
  type: 'series'
} as const satisfies CalendarFixtureItem

const sunriseOnTheReaping = {
  id: '01991a00-0000-7000-8000-000000000008',
  originalTitle: 'The Hunger Games: Sunrise on the Reaping',
  originalTitleLocale: 'en',
  posterUrl: null,
  releaseYear: 2026,
  title: 'The Hunger Games: Sunrise on the Reaping',
  titleLocale: 'en',
  type: 'movie'
} as const satisfies CalendarFixtureItem

const avengersDoomsday = {
  id: '01991a00-0000-7000-8000-000000000009',
  originalTitle: 'Avengers: Doomsday',
  originalTitleLocale: 'en',
  posterUrl: null,
  releaseYear: 2026,
  title: 'Avengers: Doomsday',
  titleLocale: 'en',
  type: 'movie'
} as const satisfies CalendarFixtureItem

function createCalendarRelease(
  item: CalendarFixtureItem,
  options: CalendarReleaseFixtureOptions
): CatalogReleaseItem {
  return {
    episodeNumber: options.episodeNumber,
    id: item.id,
    originalTitle: item.originalTitle,
    originalTitleLocale: item.originalTitleLocale,
    posterUrl: item.posterUrl,
    releaseDate: options.releaseDate,
    releaseId: options.releaseId,
    releaseYear: item.releaseYear,
    seasonNumber: options.seasonNumber,
    title: item.title,
    titleLocale: item.titleLocale,
    type: item.type
  }
}

const calendarReleases = [
  {
    episodeNumber: null,
    id: dune.id,
    originalTitle: dune.originalTitle,
    originalTitleLocale: dune.originalTitleLocale,
    posterUrl: dune.posterUrl,
    releaseDate: '2026-09-12',
    releaseId: '01991a00-0000-7000-8000-000000000101',
    releaseYear: dune.releaseYear,
    seasonNumber: null,
    title: dune.title,
    titleLocale: dune.titleLocale,
    type: dune.type
  },
  {
    episodeNumber: 7,
    id: dark.id,
    originalTitle: dark.originalTitle,
    originalTitleLocale: dark.originalTitleLocale,
    posterUrl: null,
    releaseDate: '2026-09-13',
    releaseId: '01991a00-0000-7000-8000-000000000102',
    releaseYear: dark.releaseYear,
    seasonNumber: 2,
    title: dark.title,
    titleLocale: dark.titleLocale,
    type: dark.type
  },
  {
    episodeNumber: 8,
    id: dark.id,
    originalTitle: dark.originalTitle,
    originalTitleLocale: dark.originalTitleLocale,
    posterUrl: null,
    releaseDate: '2026-09-13',
    releaseId: '01991a00-0000-7000-8000-000000000103',
    releaseYear: dark.releaseYear,
    seasonNumber: 2,
    title: dark.title,
    titleLocale: dark.titleLocale,
    type: dark.type
  },
  {
    episodeNumber: null,
    id: longTitle.id,
    originalTitle: longTitle.originalTitle,
    originalTitleLocale: longTitle.originalTitleLocale,
    posterUrl: null,
    releaseDate: '2026-09-18',
    releaseId: '01991a00-0000-7000-8000-000000000104',
    releaseYear: longTitle.releaseYear,
    seasonNumber: null,
    title: longTitle.title,
    titleLocale: longTitle.titleLocale,
    type: longTitle.type
  },
  createCalendarRelease(americanHorrorStory, {
    episodeNumber: 1,
    releaseDate: '2026-09-24',
    releaseId: '01991a00-0000-7000-8000-000000000105',
    seasonNumber: 13
  }),
  createCalendarRelease(americanHorrorStory, {
    episodeNumber: 2,
    releaseDate: '2026-09-24',
    releaseId: '01991a00-0000-7000-8000-000000000106',
    seasonNumber: 13
  }),
  createCalendarRelease(americanHorrorStory, {
    episodeNumber: 3,
    releaseDate: '2026-09-24',
    releaseId: '01991a00-0000-7000-8000-000000000107',
    seasonNumber: 13
  }),
  createCalendarRelease(americanHorrorStory, {
    episodeNumber: 4,
    releaseDate: '2026-10-01',
    releaseId: '01991a00-0000-7000-8000-000000000108',
    seasonNumber: 13
  }),
  createCalendarRelease(americanHorrorStory, {
    episodeNumber: 5,
    releaseDate: '2026-10-01',
    releaseId: '01991a00-0000-7000-8000-000000000109',
    seasonNumber: 13
  }),
  createCalendarRelease(americanHorrorStory, {
    episodeNumber: 6,
    releaseDate: '2026-10-01',
    releaseId: '01991a00-0000-7000-8000-000000000110',
    seasonNumber: 13
  }),
  createCalendarRelease(americanHorrorStory, {
    episodeNumber: 7,
    releaseDate: '2026-10-08',
    releaseId: '01991a00-0000-7000-8000-000000000111',
    seasonNumber: 13
  }),
  createCalendarRelease(americanHorrorStory, {
    episodeNumber: 8,
    releaseDate: '2026-10-08',
    releaseId: '01991a00-0000-7000-8000-000000000112',
    seasonNumber: 13
  }),
  createCalendarRelease(americanHorrorStory, {
    episodeNumber: 9,
    releaseDate: '2026-10-15',
    releaseId: '01991a00-0000-7000-8000-000000000113',
    seasonNumber: 13
  }),
  createCalendarRelease(americanHorrorStory, {
    episodeNumber: 10,
    releaseDate: '2026-10-15',
    releaseId: '01991a00-0000-7000-8000-000000000114',
    seasonNumber: 13
  }),
  createCalendarRelease(americanHorrorStory, {
    episodeNumber: 11,
    releaseDate: '2026-10-22',
    releaseId: '01991a00-0000-7000-8000-000000000115',
    seasonNumber: 13
  }),
  createCalendarRelease(americanHorrorStory, {
    episodeNumber: 12,
    releaseDate: '2026-10-22',
    releaseId: '01991a00-0000-7000-8000-000000000116',
    seasonNumber: 13
  }),
  createCalendarRelease(americanHorrorStory, {
    episodeNumber: 13,
    releaseDate: '2026-10-29',
    releaseId: '01991a00-0000-7000-8000-000000000117',
    seasonNumber: 13
  }),
  createCalendarRelease(percyJackson, {
    episodeNumber: null,
    releaseDate: '2026-11-20',
    releaseId: '01991a00-0000-7000-8000-000000000118',
    seasonNumber: 3
  }),
  createCalendarRelease(sunriseOnTheReaping, {
    episodeNumber: null,
    releaseDate: '2026-11-20',
    releaseId: '01991a00-0000-7000-8000-000000000119',
    seasonNumber: null
  }),
  createCalendarRelease(avengersDoomsday, {
    episodeNumber: null,
    releaseDate: '2026-12-18',
    releaseId: '01991a00-0000-7000-8000-000000000120',
    seasonNumber: null
  }),
  createCalendarRelease(americanHorrorStory, {
    episodeNumber: 14,
    releaseDate: '2026-12-18',
    releaseId: '01991a00-0000-7000-8000-000000000121',
    seasonNumber: 13
  }),
  createCalendarRelease(americanHorrorStory, {
    episodeNumber: 15,
    releaseDate: '2026-12-18',
    releaseId: '01991a00-0000-7000-8000-000000000122',
    seasonNumber: 13
  }),
  createCalendarRelease(americanHorrorStory, {
    episodeNumber: 16,
    releaseDate: '2026-12-18',
    releaseId: '01991a00-0000-7000-8000-000000000123',
    seasonNumber: 13
  }),
  createCalendarRelease(americanHorrorStory, {
    episodeNumber: 17,
    releaseDate: '2026-12-18',
    releaseId: '01991a00-0000-7000-8000-000000000124',
    seasonNumber: 13
  }),
  createCalendarRelease(americanHorrorStory, {
    episodeNumber: 18,
    releaseDate: '2026-12-18',
    releaseId: '01991a00-0000-7000-8000-000000000125',
    seasonNumber: 13
  }),
  ...paginationCalendarReleases
] as const satisfies readonly CatalogReleaseItem[]

export { calendarReleases }
