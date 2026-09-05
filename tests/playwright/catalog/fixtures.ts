import type { CatalogSearchItem } from '../../../packages/shared/src/catalog.ts'

const catalogItems = [
  {
    id: 'movie-arrival',
    originalTitle: 'Arrival',
    originalTitleLocale: 'en',
    releaseYear: 2016,
    title: 'Arrival',
    titleLocale: 'en',
    type: 'movie'
  },
  {
    id: 'series-dark',
    originalTitle: 'Dark',
    originalTitleLocale: 'de',
    releaseYear: 2017,
    title: 'Dark',
    titleLocale: 'en',
    type: 'series'
  },
  {
    id: 'movie-dark-city',
    originalTitle: 'Dark City',
    originalTitleLocale: 'en',
    releaseYear: null,
    title: 'Dark City',
    titleLocale: 'en',
    type: 'movie'
  },
  {
    id: 'movie-long',
    originalTitle: 'A very long title',
    originalTitleLocale: 'en',
    releaseYear: 2026,
    title: 'A very long title that keeps going across the screen and still needs to stay readable with SupercalifragilisticexpialidociousSupercalifragilisticexpialidocious',
    titleLocale: 'en',
    type: 'movie'
  }
] as const satisfies readonly CatalogSearchItem[]

export { catalogItems }
