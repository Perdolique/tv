import type { Database } from '@tv/database'
import { catalogItemFollows, catalogItemTitles, catalogItems } from '@tv/database/schema'
import { and, eq, sql } from 'drizzle-orm'
import { escapeLikePattern } from './search.ts'
import type { CatalogDetailsRow, CatalogTitleRow } from './types.ts'

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

async function findCatalogDetailsRows(
  database: Database,
  id: string
): Promise<CatalogDetailsRow[]> {
  return database
    .select({
      catalogItemId: catalogItems.id,
      description: catalogItemTitles.description,
      isOriginal: catalogItemTitles.isOriginal,
      locale: catalogItemTitles.locale,
      posterPath: catalogItems.posterPath,
      releaseYear: catalogItems.releaseYear,
      title: catalogItemTitles.title,
      type: catalogItems.type
    })
    .from(catalogItems)
    .innerJoin(catalogItemTitles, eq(catalogItemTitles.catalogItemId, catalogItems.id))
    .where(eq(catalogItems.id, id))
    .orderBy(catalogItemTitles.locale)
}

async function findCatalogItemFollowed(
  database: Database,
  userId: string,
  catalogItemId: string
): Promise<boolean | null> {
  const rows = await database
    .select({ followedAt: catalogItemFollows.followedAt })
    .from(catalogItems)
    .innerJoin(
      catalogItemTitles,
      eq(catalogItemTitles.catalogItemId, catalogItems.id)
    )
    .leftJoin(
      catalogItemFollows,
      and(
        eq(catalogItemFollows.catalogItemId, catalogItems.id),
        eq(catalogItemFollows.userId, userId)
      )
    )
    .where(
      eq(catalogItems.id, catalogItemId)
    )
    .limit(1)

  const [row] = rows

  return row === undefined ? null : row.followedAt !== null
}

async function followCatalogItem(
  database: Database,
  userId: string,
  catalogItemId: string
): Promise<boolean> {
  return database.transaction(async (transaction) => {
    const rows = await transaction
      .select({ id: catalogItems.id })
      .from(catalogItems)
      .innerJoin(
        catalogItemTitles,
        eq(catalogItemTitles.catalogItemId, catalogItems.id)
      )
      .where(
        eq(catalogItems.id, catalogItemId)
      )
      .limit(1)
      .for('key share', {
        of: [catalogItems, catalogItemTitles]
      })

    if (rows[0] === undefined) {
      return false
    }

    await transaction
      .insert(catalogItemFollows)
      .values({
        catalogItemId,
        userId
      })
      .onConflictDoNothing({
        target: [
          catalogItemFollows.userId,
          catalogItemFollows.catalogItemId
        ]
      })

    return true
  })
}

async function unfollowCatalogItem(
  database: Database,
  userId: string,
  catalogItemId: string
): Promise<void> {
  await database
    .delete(catalogItemFollows)
    .where(
      and(
        eq(catalogItemFollows.userId, userId),
        eq(catalogItemFollows.catalogItemId, catalogItemId)
      )
    )
}

export {
  findCatalogDetailsRows,
  findCatalogItemFollowed,
  findTitleRowsForMatchingCatalogItems,
  followCatalogItem,
  unfollowCatalogItem
}
