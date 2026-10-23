import type { CatalogCollection, CatalogDiscoveryItem } from '../../../packages/shared/src/catalog-discovery.ts'
import type { CatalogSearchItem } from '../../../packages/shared/src/catalog.ts'
import { dune, chernobyl } from './details.fixtures.ts'
import { arrival, dark } from './fixtures.ts'

const discoveryCollection = {
  id: '019f0010-0000-7000-8000-000000009001',
  title: 'Screen worlds',
  description: 'Stories across movies and series.',
  isFeatured: true,
  revision: 1
} as const satisfies CatalogCollection

function createDiscoveryItem(item: CatalogSearchItem, averageScore: number, ratingCount: number) {
  const posterUrl = 'posterUrl' in item && typeof item.posterUrl === 'string' ? item.posterUrl : null

  return {
    id: item.id,
    title: item.title,
    titleLocale: item.titleLocale,
    originalTitle: item.originalTitle,
    originalTitleLocale: item.originalTitleLocale,
    releaseYear: item.releaseYear,
    type: item.type,
    posterUrl,
    averageScore,
    ratingCount
  } as const satisfies CatalogDiscoveryItem
}

const discoveryItems = [
  createDiscoveryItem(dune, 9, 1),
  createDiscoveryItem(chernobyl, 8.9, 2),
  createDiscoveryItem(arrival, 8.8, 3),
  createDiscoveryItem(dark, 8.7, 4)
] as const satisfies readonly CatalogDiscoveryItem[]

export { discoveryCollection, discoveryItems }
