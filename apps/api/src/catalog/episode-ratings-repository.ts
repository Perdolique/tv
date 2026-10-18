import type { Database } from '@tv/database'

import {
  catalogEpisodes,
  catalogItemRatings,
  catalogItems,
  catalogItemTitles,
  catalogRatingVotes,
  catalogViewingContexts
} from '@tv/database/schema'

import type { CatalogEpisodeRating, CatalogEpisodeRatingSummary } from '@tv/shared/catalog'
import { and, avg, count, eq, sql } from 'drizzle-orm'
import { hasCatalogSeason, requireRatingViewing } from './ratings-repository.ts'
import { readRatingResponse } from './rating-mutations.ts'
import { CatalogHttpError } from './errors.ts'

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

// oxlint-disable-next-line eslint/max-params -- Keep the authenticated owner, episode scope and optional viewing selection separate.
async function findCatalogEpisodeRatings(
  database: Pick<Database, 'select' | 'execute'>,
  userId: string,
  scope: EpisodeRatingScope,
  viewingId?: string
): Promise<CatalogEpisodeRating[] | null> {
  if (!('episodeId' in scope)) {
    const exists = await hasCatalogSeason(database, scope.catalogItemId, scope.seasonNumber)

    if (!exists) {
      return null
    }
  }

  const scopeFilter = episodeScopeFilter(scope)

  if (viewingId !== undefined) {
    const episodes = await database.select({ catalogItemId: catalogEpisodes.catalogItemId }).from(catalogEpisodes).where(scopeFilter).limit(1)
    const [episode] = episodes

    if (episode === undefined) { return null }

    await requireRatingViewing(database, userId, episode.catalogItemId, viewingId)
  }

  const viewingFilter = viewingId === undefined ? eq(catalogItemRatings.viewingId, catalogViewingContexts.currentViewingId) : eq(catalogItemRatings.viewingId, viewingId)

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
      catalogViewingContexts,
      and(eq(catalogViewingContexts.userId, userId), eq(catalogViewingContexts.catalogItemId, catalogItems.id))
    )
    .leftJoin(
      catalogItemRatings,
      and(
        eq(catalogItemRatings.catalogEpisodeId, catalogEpisodes.id),
        eq(catalogItemRatings.userId, userId),
        viewingFilter
      )
    )
    .where(scopeFilter)
    .orderBy(catalogEpisodes.episodeNumber, catalogEpisodes.id)

  return rows.length === 0 ? null : rows
}

async function findCatalogEpisodeRatingSummaries(
  database: Pick<Database, 'select' | 'execute'>,
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
      averageScore: avg(catalogRatingVotes.score),
      ratingCount: count(catalogRatingVotes.id)
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
    .leftJoin(catalogRatingVotes, and(eq(catalogRatingVotes.catalogEpisodeId, catalogEpisodes.id)))
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

// oxlint-disable-next-line eslint/max-params -- Keep the authenticated owner, episode scope and optional viewing selection separate.
async function readEpisodeRatingSnapshot(database: Database, userId: string, scope: EpisodeRatingScope, viewingId?: string) {
  return database.transaction(async transaction => {
    await transaction.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`)

    const items = await findCatalogEpisodeRatings(transaction, userId, scope, viewingId)

    if (items === null) { throw new CatalogHttpError('NOT_FOUND', 404) }

    const scopeFilter = episodeScopeFilter(scope)
    const episodes = await transaction.select({ catalogItemId: catalogEpisodes.catalogItemId }).from(catalogEpisodes).where(scopeFilter).limit(1)
    const [episode] = episodes

    if (episode === undefined) { throw new CatalogHttpError('NOT_FOUND', 404) }

    const rating = await readRatingResponse(transaction, {
      userId,
      catalogItemId: episode.catalogItemId
    }, {
      seasonNumber: null,
      catalogEpisodeId: null
    }, viewingId)

    return {
      items,
      viewing: rating.viewing,
      summary: rating.summary
    }
  })
}

export { readEpisodeRatingSnapshot, findCatalogEpisodeRatings, findCatalogEpisodeRatingSummaries }
