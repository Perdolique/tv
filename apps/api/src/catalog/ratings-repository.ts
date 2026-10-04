import type { Database } from '@tv/database'
import { catalogEpisodes, catalogItemRatings, catalogItems, catalogItemTitles } from '@tv/database/schema'
import type { CatalogRatingResponse, CatalogRatingSummaryResponse, CatalogRatingTarget } from '@tv/shared/catalog'
import { and, avg, count, eq, isNull, sql } from 'drizzle-orm'
import { CatalogHttpError } from './errors.ts'

// Seasons use catalog coordinates; checking existence must not multiply aggregate votes.
async function hasCatalogSeason(database: Database, catalogItemId: string, seasonNumber: number): Promise<boolean> {
  const rows = await database
    .select({
      type: catalogItems.type,

      hasEpisodes: sql<boolean>`EXISTS (
        SELECT 1 FROM ${catalogEpisodes}
        WHERE ${catalogEpisodes.catalogItemId} = ${catalogItems.id}
          AND ${catalogEpisodes.seasonNumber} = ${seasonNumber}
      )`
    })
    .from(catalogItems)
    .innerJoin(catalogItemTitles, and(eq(catalogItemTitles.catalogItemId, catalogItems.id), eq(catalogItemTitles.isOriginal, true)))
    .where(
      eq(catalogItems.id, catalogItemId)
    )
    .limit(1)

  const [item] = rows

  if (item === undefined) {
    return false
  }

  if (item.type !== 'series') {
    throw new CatalogHttpError('INVALID_REQUEST', 400)
  }

  return item.hasEpisodes
}

async function findCatalogItemRatingSummary(
  database: Database,
  catalogItemId: string,
  seasonNumber: number | null = null
): Promise<CatalogRatingSummaryResponse | null> {
  if (seasonNumber !== null) {
    const exists = await hasCatalogSeason(database, catalogItemId, seasonNumber)

    if (!exists) {
      return null
    }
  }

  const seasonFilter = seasonNumber === null ? isNull(catalogItemRatings.seasonNumber) : eq(catalogItemRatings.seasonNumber, seasonNumber)

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
    .leftJoin(
      catalogItemRatings,
      and(
        eq(catalogItemRatings.catalogItemId, catalogItems.id),
        seasonFilter,
        isNull(catalogItemRatings.catalogEpisodeId)
      )
    )
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
  { catalogItemId, seasonNumber }: CatalogRatingTarget
): Promise<CatalogRatingResponse | null> {
  if (seasonNumber !== null) {
    const exists = await hasCatalogSeason(database, catalogItemId, seasonNumber)

    if (!exists) {
      return null
    }
  }

  const seasonFilter = seasonNumber === null ? isNull(catalogItemRatings.seasonNumber) : eq(catalogItemRatings.seasonNumber, seasonNumber)

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
        eq(catalogItemRatings.userId, userId),
        isNull(catalogItemRatings.catalogEpisodeId),
        seasonFilter
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
  seasonNumber?: number | null;
}

async function setCatalogItemRating(
  database: Database,
  userId: string,
  { catalogItemId, score, seasonNumber = null }: CatalogRatingChange
): Promise<boolean> {
  return database.transaction(async (transaction) => {
    const items = await transaction
      .select({
        id: catalogItems.id,
        type: catalogItems.type
      })
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

    if (seasonNumber !== null) {
      if (items[0].type !== 'series') {
        throw new CatalogHttpError('INVALID_REQUEST', 400)
      }

      const episodes = await transaction
        .select({ id: catalogEpisodes.id })
        .from(catalogEpisodes)
        .where(
          and(
            eq(catalogEpisodes.catalogItemId, catalogItemId),
            eq(catalogEpisodes.seasonNumber, seasonNumber)
          )
        )
        .limit(1)
        .for('key share')

      if (episodes[0] === undefined) {
        return false
      }
    }

    const seasonFilter = seasonNumber === null ? isNull(catalogItemRatings.seasonNumber) : eq(catalogItemRatings.seasonNumber, seasonNumber)

    if (score === null) {
      await transaction
        .delete(catalogItemRatings)
        .where(
          and(
            eq(catalogItemRatings.userId, userId),
            isNull(catalogItemRatings.catalogEpisodeId),
            eq(catalogItemRatings.catalogItemId, catalogItemId),
            seasonFilter
          )
        )
    } else {
      await transaction
        .insert(catalogItemRatings)
        .values({
          userId,
          catalogItemId,
          seasonNumber,
          score
        })
        .onConflictDoUpdate({
          target: [catalogItemRatings.userId, catalogItemRatings.catalogItemId, catalogItemRatings.seasonNumber, catalogItemRatings.catalogEpisodeId],
          set: { score }
        })
    }

    return true
  })
}

export { findCatalogItemRating, findCatalogItemRatingSummary, hasCatalogSeason, setCatalogItemRating }
