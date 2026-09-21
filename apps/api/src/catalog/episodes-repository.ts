import type { Database } from '@tv/database'
import { catalogEpisodes, catalogEpisodeWatches, catalogItemTitles, catalogItems } from '@tv/database/schema'
import { and, eq, sql } from 'drizzle-orm'
import type { CatalogEpisodeListing, CatalogEpisodeRow, CatalogEpisodeWatchListing } from './types.ts'

interface CatalogEpisodeListingRow {
  airDate: string | null;
  episodeId: string | null;
  episodeNumber: number | null;
  seasonNumber: number | null;
  sourceTitle: string | null;
  type: 'movie' | 'series';
}

type MarkCatalogEpisodeResult = 'marked' | 'not-found'

function createCatalogEpisodeListing(
  rows: CatalogEpisodeListingRow[]
): CatalogEpisodeListing | null {
  const [firstRow] = rows

  if (firstRow === undefined) {
    return null
  }

  const items: CatalogEpisodeRow[] = []

  for (const row of rows) {
    if (
      row.episodeId !== null
      && row.episodeNumber !== null
      && row.seasonNumber !== null
    ) {
      items.push({
        airDate: row.airDate,
        episodeNumber: row.episodeNumber,
        id: row.episodeId,
        seasonNumber: row.seasonNumber,
        sourceTitle: row.sourceTitle
      })
    }
  }

  return {
    items,
    type: firstRow.type
  }
}

async function findCatalogEpisodeListing(
  database: Database,
  catalogItemId: string
): Promise<CatalogEpisodeListing | null> {
  const rows = await database
    .select({
      airDate: catalogEpisodes.airDate,
      episodeId: catalogEpisodes.id,
      episodeNumber: catalogEpisodes.episodeNumber,
      seasonNumber: catalogEpisodes.seasonNumber,
      sourceTitle: catalogEpisodes.sourceTitle,
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
    .leftJoin(
      catalogEpisodes,
      eq(catalogEpisodes.catalogItemId, catalogItems.id)
    )
    .where(
      eq(catalogItems.id, catalogItemId)
    )
    .orderBy(
      sql`${catalogEpisodes.seasonNumber} ASC NULLS LAST`,
      sql`${catalogEpisodes.episodeNumber} ASC NULLS LAST`,
      sql`${catalogEpisodes.id} ASC NULLS LAST`
    )

  return createCatalogEpisodeListing(rows)
}

async function findCatalogEpisodeWatchListing(
  database: Database,
  userId: string,
  catalogItemId: string
): Promise<CatalogEpisodeWatchListing | null> {
  const rows = await database
    .select({
      episodeId: catalogEpisodes.id,
      markedAt: catalogEpisodeWatches.markedAt,
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
    .leftJoin(
      catalogEpisodes,
      eq(catalogEpisodes.catalogItemId, catalogItems.id)
    )
    .leftJoin(
      catalogEpisodeWatches,
      and(
        eq(catalogEpisodeWatches.catalogEpisodeId, catalogEpisodes.id),
        eq(catalogEpisodeWatches.userId, userId)
      )
    )
    .where(
      eq(catalogItems.id, catalogItemId)
    )
    .orderBy(
      sql`${catalogEpisodes.seasonNumber} ASC NULLS LAST`,
      sql`${catalogEpisodes.episodeNumber} ASC NULLS LAST`,
      sql`${catalogEpisodes.id} ASC NULLS LAST`
    )

  const [firstRow] = rows

  if (firstRow === undefined) {
    return null
  }

  const watchedEpisodeIds = rows.flatMap(row => row.episodeId !== null && row.markedAt !== null
    ? [row.episodeId]
    : [])

  return {
    type: firstRow.type,
    watchedEpisodeIds
  }
}

async function markCatalogEpisodeWatched(
  database: Database,
  userId: string,
  catalogEpisodeId: string
): Promise<MarkCatalogEpisodeResult> {
  return database.transaction(async (transaction) => {
    const rows = await transaction
      .select({ id: catalogEpisodes.id })
      .from(catalogEpisodes)
      .innerJoin(
        catalogItems,
        eq(catalogItems.id, catalogEpisodes.catalogItemId)
      )
      .innerJoin(
        catalogItemTitles,
        and(
          eq(catalogItemTitles.catalogItemId, catalogItems.id),
          eq(catalogItemTitles.isOriginal, true)
        )
      )
      .where(
        eq(catalogEpisodes.id, catalogEpisodeId)
      )
      .limit(1)
      .for('key share', {
        of: [catalogEpisodes, catalogItems, catalogItemTitles]
      })

    if (rows[0] === undefined) {
      return 'not-found'
    }

    await transaction
      .insert(catalogEpisodeWatches)
      .values({
        catalogEpisodeId,
        userId
      })
      .onConflictDoNothing({
        target: [
          catalogEpisodeWatches.userId,
          catalogEpisodeWatches.catalogEpisodeId
        ]
      })

    return 'marked'
  })
}

async function unmarkCatalogEpisodeWatched(
  database: Database,
  userId: string,
  catalogEpisodeId: string
): Promise<boolean> {
  return database.transaction(async (transaction) => {
    const rows = await transaction
      .select({ id: catalogEpisodes.id })
      .from(catalogEpisodes)
      .innerJoin(
        catalogItemTitles,
        and(
          eq(catalogItemTitles.catalogItemId, catalogEpisodes.catalogItemId),
          eq(catalogItemTitles.isOriginal, true)
        )
      )
      .where(
        eq(catalogEpisodes.id, catalogEpisodeId)
      )
      .limit(1)
      .for('key share', {
        of: [catalogEpisodes, catalogItemTitles]
      })

    if (rows[0] === undefined) {
      return false
    }

    await transaction
      .delete(catalogEpisodeWatches)
      .where(
        and(
          eq(catalogEpisodeWatches.userId, userId),
          eq(catalogEpisodeWatches.catalogEpisodeId, catalogEpisodeId)
        )
      )

    return true
  })
}

export {
  findCatalogEpisodeListing,
  findCatalogEpisodeWatchListing,
  markCatalogEpisodeWatched,
  unmarkCatalogEpisodeWatched
}
