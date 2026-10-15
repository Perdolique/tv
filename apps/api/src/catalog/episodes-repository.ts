import type { Database } from '@tv/database'
import { catalogEpisodes, catalogItemTitles, catalogItems } from '@tv/database/schema'
import { and, eq, sql } from 'drizzle-orm'
import type { CatalogEpisodeListing, CatalogEpisodeRow } from './types.ts'

interface CatalogEpisodeListingRow {
  airDate: string | null;
  episodeId: string | null;
  episodeNumber: number | null;
  seasonNumber: number | null;
  sourceTitle: string | null;
  type: 'movie' | 'series';
}

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

export { findCatalogEpisodeListing }
