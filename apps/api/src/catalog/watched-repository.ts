import type { Database } from '@tv/database'
import { catalogItemTitles, catalogItems, catalogMovieWatches } from '@tv/database/schema'
import { and, eq } from 'drizzle-orm'

interface CatalogItemWatchState {
  type: 'movie' | 'series';
  watched: boolean;
}

async function findCatalogItemWatchState(
  database: Database,
  userId: string,
  catalogItemId: string
): Promise<CatalogItemWatchState | null> {
  const rows = await database
    .select({
      markedAt: catalogMovieWatches.markedAt,
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
      catalogMovieWatches,
      and(
        eq(catalogMovieWatches.catalogItemId, catalogItems.id),
        eq(catalogMovieWatches.userId, userId)
      )
    )
    .where(
      eq(catalogItems.id, catalogItemId)
    )
    .limit(1)

  const [row] = rows

  if (row === undefined) {
    return null
  }

  return {
    type: row.type,
    watched: row.markedAt !== null
  }
}

export { findCatalogItemWatchState }
