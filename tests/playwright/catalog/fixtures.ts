import type { CatalogSearchItem } from '../../../packages/shared/src/catalog.ts'

const catalogItems = [
  {
    id: '01991a00-0000-7000-8000-000000000001',
    originalTitle: 'Arrival',
    originalTitleLocale: 'en',
    releaseYear: 2016,
    title: 'Arrival',
    titleLocale: 'en',
    type: 'movie'
  },
  {
    id: '01991a00-0000-7000-8000-000000000002',
    originalTitle: 'Dark',
    originalTitleLocale: 'de',
    releaseYear: 2017,
    title: 'Dark',
    titleLocale: 'en',
    type: 'series'
  },
  {
    id: '01991a00-0000-7000-8000-000000000003',
    originalTitle: 'Dark City',
    originalTitleLocale: 'en',
    releaseYear: null,
    title: 'Dark City',
    titleLocale: 'en',
    type: 'movie'
  },
  {
    id: '01991a00-0000-7000-8000-000000000004',
    originalTitle: 'A very long title',
    originalTitleLocale: 'en',
    releaseYear: 2026,
    title: 'A very long title that keeps going across the screen and still needs to stay readable with SupercalifragilisticexpialidociousSupercalifragilisticexpialidocious',
    titleLocale: 'en',
    type: 'movie'
  }
] as const satisfies readonly CatalogSearchItem[]

export { catalogItems }
