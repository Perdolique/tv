import type { Database } from '@tv/database'
import type { CatalogViewingHistoryResponse, CatalogViewingSummaryResponse } from '@tv/shared/catalog'
import { sql } from 'drizzle-orm'
import { CatalogHttpError } from './errors.ts'

import {
  createViewingHistoryResponse,
  decodeViewingCursor,
  VIEWING_HISTORY_QUERY_LIMIT,
  type CatalogViewingHistoryRow,
  type CatalogViewingScope
} from './viewing-history.ts'

import { createCatalogWatchlistItems } from './watchlist.ts'
import type { CatalogWatchlistRow } from './types.ts'

interface ViewingHistoryPage {
  historyVersion: string;
  rows: CatalogViewingHistoryRow[];
}

interface ViewingSeriesRow extends CatalogWatchlistRow {
  viewingId: string;
  startedOn: string;
  watchedEpisodeCount: number;
}

interface ViewingSummaryRow {
  watchedMovieCount: number;
  watchedEpisodeCount: number;
  completedSeriesCount: number;
  watchingSeriesCount: number;
  seriesRows: ViewingSeriesRow[];
}

async function findViewingHistory(
  database: Database,
  scope: CatalogViewingScope,
  cursorValue: string | null
): Promise<CatalogViewingHistoryResponse> {
  const cursor = decodeViewingCursor(cursorValue, scope)
  const status = scope.status === null ? sql`true` : sql`status = ${scope.status}`

  const position = cursor === null ? sql`true` : sql`
    (coalesce(completed_on, started_on), id) < (${cursor.calendarDate}::date, ${cursor.viewingId}::uuid)
  `

  // The version and bounded identities share a snapshot. Only the page joins translations and ratings.
  const result = await database.execute<ViewingHistoryPage & Record<string, unknown>>(sql`
    WITH history_version AS (
      SELECT md5(coalesce(string_agg(id::text || ':' || revision::text, ',' ORDER BY id), '')) AS version
      FROM catalog_viewings WHERE user_id = ${scope.userId}::uuid AND ${status}
    ), page AS MATERIALIZED (
      SELECT id, user_id, catalog_item_id, status, started_on, completed_on,
        coalesce(completed_on, started_on) AS calendar_date
      FROM catalog_viewings
      WHERE user_id = ${scope.userId}::uuid AND ${status} AND ${position}
      ORDER BY coalesce(completed_on, started_on) DESC, id DESC NULLS LAST
      LIMIT ${VIEWING_HISTORY_QUERY_LIMIT}
    )
    SELECT (SELECT version FROM history_version) AS "historyVersion",
      coalesce((SELECT json_agg(localized) FROM (
        SELECT item.id AS "catalogItemId", item.type, item.release_year AS "releaseYear",
          item.poster_path AS "posterPath", title.title, title.locale, title.is_original AS "isOriginal",
          page.id AS "viewingId", page.status, page.started_on::text AS "startedOn",
          page.completed_on::text AS "completedOn", rating.score
        FROM page
        INNER JOIN catalog_items item ON item.id = page.catalog_item_id
        INNER JOIN catalog_item_titles title ON title.catalog_item_id = item.id
        LEFT JOIN catalog_item_ratings rating ON rating.viewing_id = page.id AND rating.user_id = page.user_id
          AND rating.catalog_item_id = page.catalog_item_id AND rating.season_number IS NULL AND rating.catalog_episode_id IS NULL
        ORDER BY page.calendar_date DESC, page.id DESC, title.locale
      ) localized), '[]'::json) AS rows
  `)

  const [page] = result.rows

  if (page === undefined) { throw new Error('Viewing history page is missing') }

  if (cursor !== null && cursor.historyVersion !== page.historyVersion) {
    throw new CatalogHttpError('INVALID_REQUEST', 400, {
      fields: { cursor: 'Your viewings changed. Refresh history.' }
    })
  }

  return createViewingHistoryResponse(page.rows, scope, page.historyVersion)
}

async function findViewingSummary(
  database: Database,
  userId: string,
  requestedLocale: string
): Promise<CatalogViewingSummaryResponse> {
  // All-time counts and the bounded active list share one PostgreSQL snapshot.
  const result = await database.execute<ViewingSummaryRow & Record<string, unknown>>(sql`
    WITH viewings AS MATERIALIZED (
      SELECT viewing.id, viewing.catalog_item_id, viewing.status, viewing.started_on, item.type
      FROM catalog_viewings viewing INNER JOIN catalog_items item ON item.id = viewing.catalog_item_id
      WHERE viewing.user_id = ${userId}::uuid
    ), active AS (
      SELECT * FROM viewings WHERE type = 'series' AND status = 'watching'
      ORDER BY started_on DESC, id DESC LIMIT 5
    )
    SELECT
      (SELECT count(*)::integer FROM viewings WHERE type = 'movie') AS "watchedMovieCount",
      (SELECT count(*)::integer FROM viewings WHERE type = 'series' AND status = 'completed') AS "completedSeriesCount",
      (SELECT count(*)::integer FROM viewings WHERE type = 'series' AND status = 'watching') AS "watchingSeriesCount",
      (SELECT count(*)::integer FROM catalog_viewing_episode_watches WHERE user_id = ${userId}::uuid) AS "watchedEpisodeCount",
      coalesce((SELECT json_agg(localized) FROM (
        SELECT item.id AS "catalogItemId", item.type, item.release_year AS "releaseYear",
          item.poster_path AS "posterPath", title.title, title.locale, title.is_original AS "isOriginal",
          active.id AS "viewingId", active.started_on::text AS "startedOn",
          (SELECT count(*)::integer FROM catalog_viewing_episode_watches watch WHERE watch.viewing_id = active.id) AS "watchedEpisodeCount"
        FROM active
        INNER JOIN catalog_items item ON item.id = active.catalog_item_id
        INNER JOIN catalog_item_titles title ON title.catalog_item_id = item.id
        ORDER BY active.started_on DESC, active.id DESC, title.locale
      ) localized), '[]'::json) AS "seriesRows"
  `)

  const [summary] = result.rows

  if (summary === undefined) { throw new Error('Viewing summary is missing') }

  const localized = createCatalogWatchlistItems(summary.seriesRows, requestedLocale)
  const viewingEntries = summary.seriesRows.map(row => [row.catalogItemId, row] as const)
  const viewingsById = new Map(viewingEntries)

  return {
    watchedMovieCount: summary.watchedMovieCount,
    watchedEpisodeCount: summary.watchedEpisodeCount,
    completedSeriesCount: summary.completedSeriesCount,
    watchingSeriesCount: summary.watchingSeriesCount,

    activeSeries: localized.map(item => {
      const viewing = viewingsById.get(item.id)

      if (viewing === undefined) { throw new Error('Active viewing is missing') }

      return {
        id: item.id,
        originalTitle: item.originalTitle,
        originalTitleLocale: item.originalTitleLocale,
        posterUrl: item.posterUrl,
        releaseYear: item.releaseYear,
        title: item.title,
        titleLocale: item.titleLocale,
        type: 'series',
        viewingId: viewing.viewingId,
        startedOn: viewing.startedOn,
        watchedEpisodeCount: viewing.watchedEpisodeCount
      }
    })
  }
}

export { findViewingHistory, findViewingSummary }
