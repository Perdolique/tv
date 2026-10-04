import type { Database } from '@tv/database'
import { catalogEpisodes, catalogItemRatings, catalogItems, catalogItemTitles } from '@tv/database/schema'
import type { CatalogEpisodeRating, CatalogEpisodeRatingSummary } from '@tv/shared/catalog'
import { and, avg, count, eq } from 'drizzle-orm'
import { hasCatalogSeason } from './ratings-repository.ts'

type EpisodeRatingScope = { episodeId: string } | { catalogItemId: string; seasonNumber: number }

function episodeScopeFilter(scope: EpisodeRatingScope) {
  if ('episodeId' in scope) {
    return eq(catalogEpisodes.id, scope.episodeId)
  }

  return and(
    eq(catalogEpisodes.catalogItemId, scope.catalogItemId),
    eq(catalogEpisodes.seasonNumber, scope.seasonNumber)
  )
}

async function findCatalogEpisodeRatings(
  database: Database,
  userId: string,
  scope: EpisodeRatingScope
): Promise<CatalogEpisodeRating[] | null> {
  if (!('episodeId' in scope)) {
    const exists = await hasCatalogSeason(database, scope.catalogItemId, scope.seasonNumber)

    if (!exists) {
      return null
    }
  }

  const scopeFilter = episodeScopeFilter(scope)

  const rows = await database
    .select({
      episodeId: catalogEpisodes.id,
      score: catalogItemRatings.score
    })
    .from(catalogEpisodes)
    .innerJoin(
      catalogItems,
      and(
        eq(catalogItems.id, catalogEpisodes.catalogItemId),
        eq(catalogItems.type, 'series')
      )
    )
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
        eq(catalogItemRatings.catalogEpisodeId, catalogEpisodes.id),
        eq(catalogItemRatings.userId, userId)
      )
    )
    .where(scopeFilter)
    .orderBy(catalogEpisodes.episodeNumber, catalogEpisodes.id)

  return rows.length === 0 ? null : rows
}

async function findCatalogEpisodeRatingSummaries(
  database: Database,
  scope: EpisodeRatingScope
): Promise<CatalogEpisodeRatingSummary[] | null> {
  if (!('episodeId' in scope)) {
    const exists = await hasCatalogSeason(database, scope.catalogItemId, scope.seasonNumber)

    if (!exists) {
      return null
    }
  }

  const scopeFilter = episodeScopeFilter(scope)

  const rows = await database
    .select({
      episodeId: catalogEpisodes.id,
      averageScore: avg(catalogItemRatings.score),
      ratingCount: count(catalogItemRatings.id)
    })
    .from(catalogEpisodes)
    .innerJoin(
      catalogItems,
      and(
        eq(catalogItems.id, catalogEpisodes.catalogItemId),
        eq(catalogItems.type, 'series')
      )
    )
    .innerJoin(
      catalogItemTitles,
      and(
        eq(catalogItemTitles.catalogItemId, catalogItems.id),
        eq(catalogItemTitles.isOriginal, true)
      )
    )
    .leftJoin(catalogItemRatings, eq(catalogItemRatings.catalogEpisodeId, catalogEpisodes.id))
    .where(scopeFilter)
    .groupBy(catalogEpisodes.id)
    .orderBy(catalogEpisodes.episodeNumber, catalogEpisodes.id)

  if (rows.length === 0) {
    return null
  }

  return rows.map(row => {
    const averageScore = row.averageScore === null ? null : Number(row.averageScore)

    return {
      episodeId: row.episodeId,
      averageScore,
      ratingCount: row.ratingCount
    }
  })
}

interface CatalogEpisodeRatingChange {
  episodeId: string;
  score: number | null;
}

async function setCatalogEpisodeRating(database: Database, userId: string, { episodeId, score }: CatalogEpisodeRatingChange): Promise<boolean> {
  return database.transaction(async transaction => {
    const episodes = await transaction
      .select({ catalogItemId: catalogEpisodes.catalogItemId })
      .from(catalogEpisodes)
      .innerJoin(
        catalogItems,
        and(
          eq(catalogItems.id, catalogEpisodes.catalogItemId),
          eq(catalogItems.type, 'series')
        )
      )
      .innerJoin(
        catalogItemTitles,
        and(
          eq(catalogItemTitles.catalogItemId, catalogItems.id),
          eq(catalogItemTitles.isOriginal, true)
        )
      )
      .where(
        eq(catalogEpisodes.id, episodeId)
      )
      .limit(1)
      .for('key share', { of: [catalogEpisodes, catalogItems, catalogItemTitles] })

    const [episode] = episodes

    if (episode === undefined) {
      return false
    }

    if (score === null) {
      await transaction
        .delete(catalogItemRatings)
        .where(
          and(
            eq(catalogItemRatings.userId, userId),
            eq(catalogItemRatings.catalogEpisodeId, episodeId)
          )
        )
    } else {
      await transaction
        .insert(catalogItemRatings)
        .values({
          userId,
          catalogItemId: episode.catalogItemId,
          catalogEpisodeId: episodeId,
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

export { findCatalogEpisodeRatings, findCatalogEpisodeRatingSummaries, setCatalogEpisodeRating }
