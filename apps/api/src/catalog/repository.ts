import type { Database } from '@tv/database'
import { catalogItemTitles, catalogItems } from '@tv/database/schema'
import { eq, inArray, sql } from 'drizzle-orm'
import { escapeLikePattern } from './search.ts'
import type { CatalogTitleRow } from './types.ts'

async function searchCatalogTitleRows(
  database: Database,
  query: string
): Promise<CatalogTitleRow[]> {
  const escapedQuery = escapeLikePattern(query)
  const pattern = `%${escapedQuery}%`

  const matches = await database
    .selectDistinct({
      catalogItemId: catalogItemTitles.catalogItemId
    })
    .from(catalogItemTitles)
    .where(
      sql`${catalogItemTitles.title} ILIKE ${pattern} ESCAPE '\\'`
    )

  const catalogItemIds = matches.map(match => match.catalogItemId)

  if (catalogItemIds.length === 0) {
    return []
  }

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
    .where(
      inArray(catalogItems.id, catalogItemIds)
    )
    .orderBy(catalogItemTitles.catalogItemId, catalogItemTitles.locale)
}

export { searchCatalogTitleRows }
