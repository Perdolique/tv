import type { Database } from '@tv/database'
import { catalogItemRatings, catalogItems, catalogItemTitles } from '@tv/database/schema'
import type { CatalogRatingResponse, CatalogRatingSummaryResponse } from '@tv/shared/catalog'
import { and, avg, count, eq } from 'drizzle-orm'

async function findCatalogItemRatingSummary(
  database: Database,
  catalogItemId: string
): Promise<CatalogRatingSummaryResponse | null> {
  const rows = await database
    .select({
      averageScore: avg(catalogItemRatings.score),
      ratingCount: count(catalogItemRatings.id)
    })
    .from(catalogItems)
    .innerJoin(
      catalogItemTitles,
      and(
        eq(catalogItemTitles.catalogItemId, catalogItems.id),
        eq(catalogItemTitles.isOriginal, true)
      )
    )
    .leftJoin(catalogItemRatings, eq(catalogItemRatings.catalogItemId, catalogItems.id))
    .where(
      eq(catalogItems.id, catalogItemId)
    )
    .groupBy(catalogItems.id)

  const [summary] = rows

  if (summary === undefined) {
    return null
  }

  const averageScore = summary.averageScore === null ? null : Number(summary.averageScore)

  return {
    averageScore,
    ratingCount: summary.ratingCount
  }
}

async function findCatalogItemRating(
  database: Database,
  userId: string,
  catalogItemId: string
): Promise<CatalogRatingResponse | null> {
  const rows = await database
    .select({ score: catalogItemRatings.score })
    .from(catalogItems)
    .innerJoin(
      catalogItemTitles,
      and(
        eq(catalogItemTitles.catalogItemId, catalogItems.id),
        eq(catalogItemTitles.isOriginal, true)
      )
    )
    .leftJoin(
      catalogItemRatings,
      and(
        eq(catalogItemRatings.catalogItemId, catalogItems.id),
        eq(catalogItemRatings.userId, userId)
      )
    )
    .where(
      eq(catalogItems.id, catalogItemId)
    )
    .limit(1)

  return rows[0] ?? null
}

interface CatalogRatingChange {
  catalogItemId: string;
  score: number | null;
}

async function setCatalogItemRating(
  database: Database,
  userId: string,
  { catalogItemId, score }: CatalogRatingChange
): Promise<boolean> {
  return database.transaction(async (transaction) => {
    const items = await transaction
      .select({ id: catalogItems.id })
      .from(catalogItems)
      .innerJoin(
        catalogItemTitles,
        and(
          eq(catalogItemTitles.catalogItemId, catalogItems.id),
          eq(catalogItemTitles.isOriginal, true)
        )
      )
      .where(
        eq(catalogItems.id, catalogItemId)
      )
      .limit(1)
      .for('key share', { of: [catalogItems, catalogItemTitles] })

    if (items[0] === undefined) {
      return false
    }

    if (score === null) {
      await transaction
        .delete(catalogItemRatings)
        .where(
          and(
            eq(catalogItemRatings.userId, userId),
            eq(catalogItemRatings.catalogItemId, catalogItemId)
          )
        )
    } else {
      await transaction
        .insert(catalogItemRatings)
        .values({
          userId,
          catalogItemId,
          score
        })
        .onConflictDoUpdate({
          target: [catalogItemRatings.userId, catalogItemRatings.catalogItemId],
          set: { score }
        })
    }

    return true
  })
}

export { findCatalogItemRating, findCatalogItemRatingSummary, setCatalogItemRating }
