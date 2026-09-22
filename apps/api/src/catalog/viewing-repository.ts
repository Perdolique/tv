import type { Database } from '@tv/database'
import type { CatalogViewingSummaryResponse } from '@tv/shared/catalog'
import { sql } from 'drizzle-orm'

import {
  VIEWING_HISTORY_QUERY_LIMIT,
  type CatalogViewingCursor,
  type CatalogViewingHistoryRow
} from './viewing-history.ts'

import { createCatalogWatchlistItems } from './watchlist.ts'
import type { CatalogWatchlistRow } from './types.ts'

interface ViewingSeriesRow extends CatalogWatchlistRow {
  watchedEpisodeCount: number;
}

interface ViewingSummaryRow {
  watchedMovieCount: number;
  watchedEpisodeCount: number;
  seriesRows: ViewingSeriesRow[];
}

async function findViewingHistoryRows(
  database: Database,
  userId: string,
  cursor: CatalogViewingCursor | null
): Promise<CatalogViewingHistoryRow[]> {
  const cursorKindRank = cursor?.kind === 'episode' ? 1 : 0

  const moviePosition = cursor === null ? sql`true` : sql`
    (marked_at, 0, catalog_item_id) < (${cursor.markedAt}::timestamptz, ${cursorKindRank}::integer, ${cursor.entryId}::uuid)
  `

  const episodePosition = cursor === null ? sql`true` : sql`
    (marked_at, 1, catalog_episode_id) < (${cursor.markedAt}::timestamptz, ${cursorKindRank}::integer, ${cursor.entryId}::uuid)
  `

  // Limit identities before joining translations; preserve timestamp microseconds as text.
  const result = await database.execute<CatalogViewingHistoryRow & Record<string, unknown>>(sql`
    WITH movies AS (
      SELECT catalog_item_id AS entry_id, marked_at, 0 AS kind_rank
      FROM catalog_movie_watches
      WHERE user_id = ${userId}::uuid AND ${moviePosition}
      ORDER BY marked_at DESC NULLS LAST, catalog_item_id DESC NULLS LAST
      LIMIT ${VIEWING_HISTORY_QUERY_LIMIT}
    ), episodes AS (
      SELECT catalog_episode_id AS entry_id, marked_at, 1 AS kind_rank
      FROM catalog_episode_watches
      WHERE user_id = ${userId}::uuid AND ${episodePosition}
      ORDER BY marked_at DESC NULLS LAST, catalog_episode_id DESC NULLS LAST
      LIMIT ${VIEWING_HISTORY_QUERY_LIMIT}
    ), positions AS (
      SELECT * FROM movies UNION ALL SELECT * FROM episodes
      ORDER BY marked_at DESC, kind_rank DESC, entry_id DESC
      LIMIT ${VIEWING_HISTORY_QUERY_LIMIT}
    )
    SELECT item.id AS "catalogItemId", item.type, item.release_year AS "releaseYear",
      item.poster_path AS "posterPath", title.title, title.locale, title.is_original AS "isOriginal",
      positions.entry_id AS "entryId",
      CASE positions.kind_rank WHEN 0 THEN 'movie' ELSE 'episode' END AS kind,
      to_char(positions.marked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "markedAt",
      episode.season_number AS "seasonNumber", episode.episode_number AS "episodeNumber",
      episode.source_title AS "sourceTitle"
    FROM positions
    LEFT JOIN catalog_episodes episode ON positions.kind_rank = 1 AND episode.id = positions.entry_id
    INNER JOIN catalog_items item ON item.id = CASE positions.kind_rank
      WHEN 0 THEN positions.entry_id ELSE episode.catalog_item_id END
    INNER JOIN catalog_item_titles title ON title.catalog_item_id = item.id
    ORDER BY positions.marked_at DESC, positions.kind_rank DESC, positions.entry_id DESC, title.locale
  `)

  return result.rows
}

async function findViewingSummary(
  database: Database,
  userId: string,
  requestedLocale: string
): Promise<CatalogViewingSummaryResponse> {
  // Keep counts and series in one PostgreSQL snapshot, including concurrent mark changes.
  const result = await database.execute<ViewingSummaryRow & Record<string, unknown>>(sql`
    WITH watched_series AS (
      SELECT episode.catalog_item_id, count(*)::integer AS watched_count, max(watch.marked_at) AS latest_mark
      FROM catalog_episode_watches watch
      INNER JOIN catalog_episodes episode ON episode.id = watch.catalog_episode_id
      WHERE watch.user_id = ${userId}::uuid
      GROUP BY episode.catalog_item_id
    )
    SELECT
      (SELECT count(*)::integer FROM catalog_movie_watches WHERE user_id = ${userId}::uuid) AS "watchedMovieCount",
      (SELECT count(*)::integer FROM catalog_episode_watches WHERE user_id = ${userId}::uuid) AS "watchedEpisodeCount",
      COALESCE((
        SELECT json_agg(series_titles) FROM (
          SELECT item.id AS "catalogItemId", item.type, item.release_year AS "releaseYear",
            item.poster_path AS "posterPath", title.title, title.locale, title.is_original AS "isOriginal",
            watched_series.watched_count AS "watchedEpisodeCount"
          FROM watched_series
          INNER JOIN catalog_items item ON item.id = watched_series.catalog_item_id
          INNER JOIN catalog_item_titles title ON title.catalog_item_id = item.id
          ORDER BY watched_series.latest_mark DESC, item.id DESC, title.locale
        ) series_titles
      ), '[]'::json) AS "seriesRows"
  `)

  const [summary] = result.rows
  const seriesRows = summary?.seriesRows ?? []
  const localized = createCatalogWatchlistItems(seriesRows, requestedLocale)
  const countEntries = seriesRows.map(row => [row.catalogItemId, row.watchedEpisodeCount] as const)
  const countsById = new Map(countEntries)

  return {
    watchedMovieCount: summary?.watchedMovieCount ?? 0,
    watchedEpisodeCount: summary?.watchedEpisodeCount ?? 0,

    series: localized.map(item => {
      return {
        id: item.id,
        originalTitle: item.originalTitle,
        originalTitleLocale: item.originalTitleLocale,
        posterUrl: item.posterUrl,
        releaseYear: item.releaseYear,
        title: item.title,
        titleLocale: item.titleLocale,
        type: item.type,
        watchedEpisodeCount: countsById.get(item.id) ?? 0
      }
    })
  }
}

export { findViewingHistoryRows, findViewingSummary }
