import type { CatalogWatchlistItem } from '../../../packages/shared/src/catalog.ts'
import { catalogItems } from '../catalog/fixtures.ts'
import { dune } from '../catalog/details.fixtures.ts'

const [, dark, darkCity, longTitle] = catalogItems

const watchlistItems = [
  {
    id: dune.id,
    originalTitle: dune.originalTitle,
    originalTitleLocale: dune.originalTitleLocale,
    posterUrl: dune.posterUrl,
    releaseYear: dune.releaseYear,
    title: dune.title,
    titleLocale: dune.titleLocale,
    type: dune.type
  },
  {
    ...longTitle,
    posterUrl: null
  },
  {
    ...darkCity,
    posterUrl: null
  },
  {
    ...dark,
    posterUrl: null
  }
] as const satisfies readonly CatalogWatchlistItem[]

export { watchlistItems }
