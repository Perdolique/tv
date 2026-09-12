import type { CatalogWatchlistItem } from '@tv/shared/catalog'
import { createLocalizedCatalogItems } from './search.ts'
import type { CatalogWatchlistRow } from './types.ts'

function createCatalogWatchlistItems(
  rows: CatalogWatchlistRow[],
  requestedLocale: string
): CatalogWatchlistItem[] {
  const localizedItems = createLocalizedCatalogItems(rows, requestedLocale)
  const posterPaths = new Map<string, string | null>()

  for (const row of rows) {
    if (!posterPaths.has(row.catalogItemId)) {
      posterPaths.set(row.catalogItemId, row.posterPath)
    }
  }

  return localizedItems.map((item) => {
    return {
      id: item.id,
      originalTitle: item.originalTitle,
      originalTitleLocale: item.originalTitleLocale,
      posterUrl: posterPaths.get(item.id) ?? null,
      releaseYear: item.releaseYear,
      title: item.title,
      titleLocale: item.titleLocale,
      type: item.type
    }
  })
}

export { createCatalogWatchlistItems }
