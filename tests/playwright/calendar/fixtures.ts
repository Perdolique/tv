import type { CatalogReleaseItem } from '../../../packages/shared/src/catalog.ts'
import { catalogItems } from '../catalog/fixtures.ts'
import { dune } from '../catalog/details.fixtures.ts'

const [, dark, , longTitle] = catalogItems

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
  {
    episodeNumber: null,
    id: dark.id,
    originalTitle: dark.originalTitle,
    originalTitleLocale: dark.originalTitleLocale,
    posterUrl: null,
    releaseDate: '2026-10-05',
    releaseId: '01991a00-0000-7000-8000-000000000105',
    releaseYear: dark.releaseYear,
    seasonNumber: null,
    title: dark.title,
    titleLocale: dark.titleLocale,
    type: dark.type
  }
] as const satisfies readonly CatalogReleaseItem[]

export { calendarReleases }
