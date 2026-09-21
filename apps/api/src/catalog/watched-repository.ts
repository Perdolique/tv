import type { Database } from '@tv/database'
import { catalogItemTitles, catalogItems, catalogMovieWatches } from '@tv/database/schema'
import { and, eq } from 'drizzle-orm'

interface CatalogItemWatchState {
  type: 'movie' | 'series';
  watched: boolean;
}

type MarkCatalogMovieResult = 'marked' | 'not-found' | 'not-movie'

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

async function markCatalogMovieWatched(
  database: Database,
  userId: string,
  catalogItemId: string
): Promise<MarkCatalogMovieResult> {
  return database.transaction(async (transaction) => {
    const rows = await transaction
      .select({
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
      .for('no key update', {
        of: [catalogItems, catalogItemTitles]
      })

    const [item] = rows

    if (item === undefined) {
      return 'not-found'
    }

    if (item.type !== 'movie') {
      return 'not-movie'
    }

    await transaction
      .insert(catalogMovieWatches)
      .values({
        catalogItemId,
        userId
      })
      .onConflictDoNothing({
        target: [
          catalogMovieWatches.userId,
          catalogMovieWatches.catalogItemId
        ]
      })

    return 'marked'
  })
}

async function unmarkCatalogMovieWatched(
  database: Database,
  userId: string,
  catalogItemId: string
): Promise<void> {
  await database
    .delete(catalogMovieWatches)
    .where(
      and(
        eq(catalogMovieWatches.userId, userId),
        eq(catalogMovieWatches.catalogItemId, catalogItemId)
      )
    )
}

export {
  findCatalogItemWatchState,
  markCatalogMovieWatched,
  unmarkCatalogMovieWatched
}
