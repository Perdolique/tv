import type { Database } from '@tv/database'

import {
  catalogEpisodes,
  catalogItems,
  catalogItemTitles,
  catalogRatingVotes,
  catalogViewings
} from '@tv/database/schema'

import type { CatalogRatingSummaryResponse } from '@tv/shared/catalog'
import { and, avg, count, eq, isNull, sql } from 'drizzle-orm'
import { CatalogHttpError } from './errors.ts'


// Seasons use catalog coordinates; checking existence must not multiply aggregate votes.
async function hasCatalogSeason(database: Pick<Database, 'select' | 'execute'>, catalogItemId: string, seasonNumber: number): Promise<boolean> {
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
  database: Pick<Database, 'select' | 'execute'>,
  catalogItemId: string,
  seasonNumber: number | null = null
): Promise<CatalogRatingSummaryResponse | null> {
  if (seasonNumber !== null) {
    const exists = await hasCatalogSeason(database, catalogItemId, seasonNumber)

    if (!exists) {
      return null
    }
  }

  const seasonFilter = seasonNumber === null ? isNull(catalogRatingVotes.seasonNumber) : eq(catalogRatingVotes.seasonNumber, seasonNumber)

  const rows = await database
    .select({
      averageScore: avg(catalogRatingVotes.score),
      ratingCount: count(catalogRatingVotes.id)
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
      catalogRatingVotes,
      and(
        eq(catalogRatingVotes.catalogItemId, catalogItems.id),
        seasonFilter,
        isNull(catalogRatingVotes.catalogEpisodeId)
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

// oxlint-disable-next-line eslint/max-params -- Validate the selected viewing against its authenticated owner and title.
async function requireRatingViewing(database: Pick<Database, 'select' | 'execute'>, userId: string, catalogItemId: string, viewingId: string): Promise<void> {
  const rows = await database.select({ id: catalogViewings.id }).from(catalogViewings)
    .where(
      and(eq(catalogViewings.id, viewingId), eq(catalogViewings.userId, userId), eq(catalogViewings.catalogItemId, catalogItemId))
    )
    .limit(1)

  if (rows[0] === undefined) {
    throw new CatalogHttpError('NOT_FOUND', 404)
  }
}


export { findCatalogItemRatingSummary, hasCatalogSeason, requireRatingViewing }
