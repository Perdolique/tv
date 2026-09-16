import type { Database } from '@tv/database'
import { catalogItemFollows, catalogItemTitles, catalogItems, catalogReleases } from '@tv/database/schema'
import { and, eq, gte, sql } from 'drizzle-orm'
import { UPCOMING_RELEASE_QUERY_LIMIT } from './releases.ts'
import type { CatalogReleaseCursor, CatalogReleaseRow, CatalogUpcomingReleaseQuery } from './types.ts'

function createUpcomingCursorCondition(cursor: CatalogReleaseCursor | null) {
  if (cursor === null) {
    return
  }

  return sql`(
    ${catalogReleases.releaseDate},
    ${catalogItems.id},
    ${catalogReleases.seasonNumber} IS NULL,
    coalesce(${catalogReleases.seasonNumber}, 0),
    ${catalogReleases.episodeNumber} IS NULL,
    coalesce(${catalogReleases.episodeNumber}, 0),
    ${catalogReleases.id}
  ) > (
    ${cursor.releaseDate}::date,
    ${cursor.catalogItemId}::uuid,
    ${cursor.seasonNumber === null}::boolean,
    coalesce(${cursor.seasonNumber}::integer, 0),
    ${cursor.episodeNumber === null}::boolean,
    coalesce(${cursor.episodeNumber}::integer, 0),
    ${cursor.releaseId}::uuid
  )`
}

async function findCatalogUpcomingReleaseRows(
  database: Database,
  userId: string,
  query: CatalogUpcomingReleaseQuery
): Promise<CatalogReleaseRow[]> {
  const cursorCondition = createUpcomingCursorCondition(query.cursor)

  const positions = database
    .select({
      catalogItemId: catalogReleases.catalogItemId,
      episodeNumber: catalogReleases.episodeNumber,
      releaseDate: catalogReleases.releaseDate,
      releaseId: catalogReleases.id,
      seasonNumber: catalogReleases.seasonNumber
    })
    .from(catalogItemFollows)
    .innerJoin(
      catalogReleases,
      eq(catalogReleases.catalogItemId, catalogItemFollows.catalogItemId)
    )
    .innerJoin(
      catalogItems,
      eq(catalogItems.id, catalogReleases.catalogItemId)
    )
    .where(
      and(
        eq(catalogItemFollows.userId, userId),
        gte(catalogReleases.releaseDate, query.from),
        cursorCondition
      )
    )
    .orderBy(
      catalogReleases.releaseDate,
      catalogItems.id,
      sql`${catalogReleases.seasonNumber} ASC NULLS LAST`,
      sql`${catalogReleases.episodeNumber} ASC NULLS LAST`,
      catalogReleases.id
    )
    .limit(UPCOMING_RELEASE_QUERY_LIMIT)
    .as('upcoming_release_positions')

  return database
    .select({
      catalogItemId: catalogItems.id,
      episodeNumber: positions.episodeNumber,
      isOriginal: catalogItemTitles.isOriginal,
      locale: catalogItemTitles.locale,
      posterPath: catalogItems.posterPath,
      releaseDate: positions.releaseDate,
      releaseId: positions.releaseId,
      releaseYear: catalogItems.releaseYear,
      seasonNumber: positions.seasonNumber,
      title: catalogItemTitles.title,
      type: catalogItems.type
    })
    .from(positions)
    .innerJoin(
      catalogItems,
      eq(catalogItems.id, positions.catalogItemId)
    )
    .innerJoin(
      catalogItemTitles,
      eq(catalogItemTitles.catalogItemId, catalogItems.id)
    )
    .orderBy(
      positions.releaseDate,
      positions.catalogItemId,
      sql`${positions.seasonNumber} ASC NULLS LAST`,
      sql`${positions.episodeNumber} ASC NULLS LAST`,
      positions.releaseId,
      catalogItemTitles.locale
    )
}

export { findCatalogUpcomingReleaseRows }
