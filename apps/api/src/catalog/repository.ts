import type { Database } from '@tv/database'
import { catalogItemTitles, catalogItems } from '@tv/database/schema'
import { eq, sql } from 'drizzle-orm'
import { escapeLikePattern } from './search.ts'
import type { CatalogTitleRow } from './types.ts'

async function findTitleRowsForMatchingCatalogItems(
  database: Database,
  query: string
): Promise<CatalogTitleRow[]> {
  const escapedQuery = escapeLikePattern(query)
  const pattern = `%${escapedQuery}%`

  const matchingCatalogItems = database
    .selectDistinct({
      catalogItemId: catalogItemTitles.catalogItemId
    })
    .from(catalogItemTitles)
    .where(
      sql`${catalogItemTitles.title} ILIKE ${pattern} ESCAPE '\\'`
    )
    .as('matching_catalog_items')

  return database
    .select({
      catalogItemId: catalogItemTitles.catalogItemId,
      isOriginal: catalogItemTitles.isOriginal,
      locale: catalogItemTitles.locale,
      releaseYear: catalogItems.releaseYear,
      title: catalogItemTitles.title,
      type: catalogItems.type
    })
    .from(catalogItemTitles)
    .innerJoin(
      catalogItems,
      eq(catalogItems.id, catalogItemTitles.catalogItemId)
    )
    .innerJoin(
      matchingCatalogItems,
      eq(matchingCatalogItems.catalogItemId, catalogItems.id)
    )
    .orderBy(catalogItemTitles.catalogItemId, catalogItemTitles.locale)
}

export { findTitleRowsForMatchingCatalogItems }
