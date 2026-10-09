import type { Database } from '@tv/database'

import type {
  CatalogTimelineEpisode,
  CatalogTimelineEpisodesQuery,
  CatalogTimelineEpisodesResponse,
  CatalogTimelineItem,
  CatalogTimelineQuery,
  CatalogTimelineResponse
} from '@tv/shared/catalog-timeline'

import { sql } from 'drizzle-orm'
import { CatalogHttpError } from './errors.ts'

import {
  encodeTimelineCursor,
  readTimelineEpisodesCursor,
  readTimelineGroupCursor,
  readTimelinePageCursor,
  type TimelinePageCursor,
  type TimelinePosition,
  type TimelineScope,
  type TimelineViewingPosition
} from './timeline-cursors.ts'

interface TimelineOwner {
  userId: string;
  catalogItemId: string;
}

type EpisodeGroup = Extract<CatalogTimelineItem, { kind: 'episode_group' }>
type TimelineDatabaseItem = Exclude<CatalogTimelineItem, EpisodeGroup> | Omit<EpisodeGroup, 'episodesCursor'>

interface TimelineDatabasePage {
  catalogExists: boolean;
  upper: TimelinePosition | null;
  items: TimelineDatabaseItem[];
  boundaryDate: string | null;
  oldestPageViewing: TimelineViewingPosition | null;
}

interface TimelineEpisodeRow {
  item: CatalogTimelineEpisode;
  position: TimelinePosition;
}

interface TimelineEpisodePage {
  catalogExists: boolean;
  items: TimelineEpisodeRow[];
}

const TIMELINE_PAGE_SIZE = 20

function oldestSeenViewing(page: TimelineDatabasePage, cursor: TimelinePageCursor | null): TimelineViewingPosition | null {
  const previous = cursor?.boundaryDate === page.boundaryDate ? cursor.oldestSeenViewing : null
  const candidate = page.oldestPageViewing

  if (candidate === null) {
    return previous
  }

  if (previous === null) {
    return candidate
  }

  const sameTime = candidate.recordedAt === previous.recordedAt
  const earlier = candidate.recordedAt < previous.recordedAt || (sameTime && candidate.id < previous.id)

  return earlier ? candidate : previous
}

function createTimelineItem(item: TimelineDatabaseItem, scope: TimelineScope, upper: TimelinePosition): CatalogTimelineItem {
  if (item.kind !== 'episode_group') {
    return item
  }

  const episodesCursor = encodeTimelineCursor({
    kind: 'group',
    version: 1,
    userId: scope.userId,
    catalogItemId: scope.catalogItemId,
    timeZone: scope.timeZone,
    viewingId: item.viewingId,
    localDate: item.localDate,
    upper
  })

  return {
    id: item.id,
    kind: item.kind,
    occurredAt: item.occurredAt,
    viewingId: item.viewingId,
    localDate: item.localDate,
    totalCount: item.totalCount,
    seasons: item.seasons,
    episodesCursor
  }
}

async function findCatalogTimeline(database: Database, owner: TimelineOwner, query: CatalogTimelineQuery): Promise<CatalogTimelineResponse> {
  const scope: TimelineScope = {
    userId: owner.userId,
    catalogItemId: owner.catalogItemId,
    timeZone: query.timeZone
  }

  const cursor = readTimelinePageCursor(query.cursor ?? null, scope)

  const upperQuery = cursor === null
    ? sql`SELECT occurred_at, id FROM source_events ORDER BY occurred_at DESC, id DESC LIMIT 1`
    : sql`SELECT ${cursor.upper.occurredAt}::timestamptz AS occurred_at, ${cursor.upper.id}::uuid AS id`

  const position = cursor === null
    ? sql`true`
    : sql`(occurred_at, id) < (${cursor.after.occurredAt}::timestamptz, ${cursor.after.id}::uuid)`

  // Only the current series viewing accepts marks; a rewatch permanently advances it.
  // Same-day groups form a prefix in viewing creation order.
  // Exclude that prefix even when deleting its latest mark moves a group behind the page boundary.
  const seenViewing = cursor?.oldestSeenViewing ?? null

  const unseenGroup = cursor === null || seenViewing === null
    ? sql`true`
    : sql`NOT (kind = 'episode_group' AND local_date = ${cursor.boundaryDate}::date
      AND (viewing_recorded_at, viewing_id) >= (${seenViewing.recordedAt}::timestamptz, ${seenViewing.id}::uuid))`

  // Group the complete bounded history before applying the row limit.
  // Read the metadata and initial upper bound in one PostgreSQL snapshot.
  const result = await database.execute<TimelineDatabasePage & Record<string, unknown>>(sql`
    WITH source_events AS MATERIALIZED (
      SELECT * FROM catalog_timeline_events
      WHERE user_id = ${owner.userId}::uuid AND catalog_item_id = ${owner.catalogItemId}::uuid
    ), upper_position AS (${upperQuery}), bounded AS MATERIALIZED (
      SELECT events.*, (events.occurred_at AT TIME ZONE ${query.timeZone})::date AS local_date
      FROM source_events events CROSS JOIN upper_position upper_bound
      WHERE (events.occurred_at, events.id) <= (upper_bound.occurred_at, upper_bound.id)
    ), episode_groups AS (
      SELECT DISTINCT ON (events.viewing_id, events.local_date) events.id, events.occurred_at, events.viewing_id, events.local_date,
        viewings.recorded_at AS viewing_recorded_at,
        count(*) OVER (PARTITION BY events.viewing_id, events.local_date)::integer AS total_count
      FROM bounded events JOIN catalog_viewings viewings ON viewings.id = events.viewing_id
      WHERE events.kind = 'episode_watched'
      ORDER BY events.viewing_id, events.local_date, events.occurred_at DESC, events.id DESC
    ), numbered_episodes AS (
      SELECT events.viewing_id, events.local_date, episodes.season_number, episodes.episode_number,
        episodes.episode_number - row_number() OVER (
          PARTITION BY events.viewing_id, events.local_date, episodes.season_number ORDER BY episodes.episode_number
        ) AS range_key
      FROM bounded events JOIN catalog_episodes episodes ON episodes.id = events.catalog_episode_id
      WHERE events.kind = 'episode_watched'
    ), episode_ranges AS (
      SELECT viewing_id, local_date, season_number,
        min(episode_number) AS first_number, max(episode_number) AS last_number
      FROM numbered_episodes GROUP BY viewing_id, local_date, season_number, range_key
    ), episode_seasons AS (
      SELECT viewing_id, local_date, season_number,
        jsonb_agg(jsonb_build_object('firstEpisodeNumber', first_number, 'lastEpisodeNumber', last_number)
          ORDER BY first_number) AS ranges
      FROM episode_ranges GROUP BY viewing_id, local_date, season_number
    ), group_metadata AS (
      SELECT viewing_id, local_date,
        jsonb_agg(jsonb_build_object('seasonNumber', season_number, 'ranges', ranges) ORDER BY season_number) AS seasons
      FROM episode_seasons GROUP BY viewing_id, local_date
    ), timeline_rows AS (
      SELECT events.id, events.occurred_at, events.local_date, events.viewing_id, viewings.recorded_at AS viewing_recorded_at, events.kind,
        jsonb_build_object('id', events.id, 'kind', events.kind,
          'occurredAt', to_char(events.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ||
        CASE events.kind
          WHEN 'movie_viewing' THEN jsonb_build_object('viewingId', events.viewing_id,
            'startedOn', viewings.started_on::text, 'completedOn', viewings.completed_on::text)
          WHEN 'rating_changed' THEN jsonb_build_object(
            'target', CASE WHEN events.catalog_episode_id IS NOT NULL THEN 'episode'
              WHEN events.season_number IS NOT NULL THEN 'season' ELSE 'item' END,
            'seasonNumber', coalesce(events.season_number, episodes.season_number),
            'catalogEpisodeId', events.catalog_episode_id, 'episodeNumber', episodes.episode_number,
            'previousScore', events.previous_score, 'score', events.score)
          WHEN 'season_completed' THEN jsonb_build_object('viewingId', events.viewing_id,
            'seasonNumber', events.season_number, 'totalCount', jsonb_array_length(events.episode_ids))
          WHEN 'available_completed' THEN jsonb_build_object('viewingId', events.viewing_id,
            'seasonNumber', events.season_number, 'totalCount', jsonb_array_length(events.episode_ids))
          ELSE jsonb_build_object('viewingId', events.viewing_id)
        END AS item
      FROM bounded events
      LEFT JOIN catalog_viewings viewings ON viewings.id = events.viewing_id
      LEFT JOIN catalog_episodes episodes ON episodes.id = events.catalog_episode_id
      WHERE events.kind <> 'episode_watched'
      UNION ALL
      SELECT groups.id, groups.occurred_at, groups.local_date, groups.viewing_id, groups.viewing_recorded_at, 'episode_group' AS kind,
        jsonb_build_object('id', groups.id, 'kind', 'episode_group',
        'occurredAt', to_char(groups.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'viewingId', groups.viewing_id, 'localDate', groups.local_date::text,
        'totalCount', groups.total_count, 'seasons', metadata.seasons) AS item
      FROM episode_groups groups JOIN group_metadata metadata USING (viewing_id, local_date)
    ), page AS (
      SELECT * FROM timeline_rows WHERE ${position} AND ${unseenGroup}
      ORDER BY occurred_at DESC, id DESC LIMIT ${TIMELINE_PAGE_SIZE + 1}
    ), visible_page AS (
      SELECT * FROM page ORDER BY occurred_at DESC, id DESC LIMIT ${TIMELINE_PAGE_SIZE}
    ), boundary AS (
      SELECT local_date FROM visible_page ORDER BY occurred_at, id LIMIT 1
    )
    SELECT EXISTS (SELECT 1 FROM catalog_items items
        JOIN catalog_item_titles titles ON titles.catalog_item_id = items.id AND titles.is_original
        WHERE items.id = ${owner.catalogItemId}::uuid) AS "catalogExists",
      (SELECT jsonb_build_object('id', id,
        'occurredAt', to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) FROM upper_position) AS upper,
      (SELECT local_date::text FROM boundary) AS "boundaryDate",
      (SELECT jsonb_build_object('id', viewing_id,
        'recordedAt', to_char(viewing_recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
        FROM visible_page WHERE kind = 'episode_group' AND local_date = (SELECT local_date FROM boundary)
        ORDER BY viewing_recorded_at, viewing_id LIMIT 1) AS "oldestPageViewing",
      coalesce((SELECT jsonb_agg(item ORDER BY occurred_at DESC, id DESC) FROM page), '[]'::jsonb) AS items
  `)

  const [page] = result.rows

  if (page === undefined) {
    throw new Error('Timeline page is missing')
  }

  if (!page.catalogExists) {
    throw new CatalogHttpError('NOT_FOUND', 404)
  }

  if (page.upper === null) {
    return {
      items: [],
      nextCursor: null
    }
  }

  const { upper } = page
  const visibleItems = page.items.slice(0, TIMELINE_PAGE_SIZE)
  const items = visibleItems.map(item => createTimelineItem(item, scope, upper))
  const last = items.at(-1)
  const { boundaryDate } = page
  let nextCursor: string | null = null

  if (page.items.length > TIMELINE_PAGE_SIZE && last !== undefined && boundaryDate !== null) {
    const oldestViewing = oldestSeenViewing(page, cursor)

    nextCursor = encodeTimelineCursor({
      kind: 'timeline',
      version: 1,
      userId: scope.userId,
      catalogItemId: scope.catalogItemId,
      timeZone: scope.timeZone,
      upper,
      boundaryDate,
      oldestSeenViewing: oldestViewing,

      after: {
        id: last.id,
        occurredAt: last.occurredAt
      }
    })
  }

  return {
    items,
    nextCursor
  }
}

async function findCatalogTimelineEpisodes(database: Database, owner: TimelineOwner, query: CatalogTimelineEpisodesQuery): Promise<CatalogTimelineEpisodesResponse> {
  const groupScope = {
    userId: owner.userId,
    catalogItemId: owner.catalogItemId,
    timeZone: query.timeZone,
    viewingId: query.viewingId,
    localDate: query.localDate
  }

  const group = readTimelineGroupCursor(query.groupCursor, groupScope)
  const cursor = readTimelineEpisodesCursor(query.cursor ?? null, group)

  const position = cursor === null
    ? sql`true`
    : sql`(events.occurred_at, events.id) < (${cursor.after.occurredAt}::timestamptz, ${cursor.after.id}::uuid)`

  const result = await database.execute<TimelineEpisodePage & Record<string, unknown>>(sql`
    WITH page AS (
      SELECT events.id, events.occurred_at,
        jsonb_build_object('id', events.id, 'watchId', watches.id, 'catalogEpisodeId', episodes.id,
          'seasonNumber', episodes.season_number, 'episodeNumber', episodes.episode_number,
          'sourceTitle', episodes.source_title,
          'markedAt', to_char(watches.marked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) AS item
      FROM catalog_timeline_events events
      JOIN catalog_viewing_episode_watches watches ON watches.id = events.watch_id
      JOIN catalog_episodes episodes ON episodes.id = events.catalog_episode_id
      WHERE events.user_id = ${owner.userId}::uuid AND events.catalog_item_id = ${owner.catalogItemId}::uuid
        AND events.kind = 'episode_watched' AND events.viewing_id = ${query.viewingId}::uuid
        AND (events.occurred_at AT TIME ZONE ${query.timeZone})::date = ${query.localDate}::date
        AND (events.occurred_at, events.id) <= (${group.upper.occurredAt}::timestamptz, ${group.upper.id}::uuid)
        AND ${position}
      ORDER BY events.occurred_at DESC, events.id DESC LIMIT ${TIMELINE_PAGE_SIZE + 1}
    )
    SELECT EXISTS (SELECT 1 FROM catalog_items items
        JOIN catalog_item_titles titles ON titles.catalog_item_id = items.id AND titles.is_original
        WHERE items.id = ${owner.catalogItemId}::uuid) AS "catalogExists",
      coalesce((SELECT jsonb_agg(jsonb_build_object('item', item,
        'position', jsonb_build_object('id', id,
          'occurredAt', to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))
        ORDER BY occurred_at DESC, id DESC) FROM page), '[]'::jsonb) AS items
  `)

  const [page] = result.rows

  if (page === undefined) {
    throw new Error('Timeline episode page is missing')
  }

  if (!page.catalogExists) {
    throw new CatalogHttpError('NOT_FOUND', 404)
  }

  const rows = page.items.slice(0, TIMELINE_PAGE_SIZE)
  const items = rows.map(row => row.item)
  const last = rows.at(-1)

  const nextCursor = page.items.length > TIMELINE_PAGE_SIZE && last !== undefined
    ? encodeTimelineCursor({
      kind: 'episodes',
      version: 1,
      userId: group.userId,
      catalogItemId: group.catalogItemId,
      timeZone: group.timeZone,
      viewingId: group.viewingId,
      localDate: group.localDate,
      upper: group.upper,
      after: last.position
    })
    : null

  return {
    items,
    nextCursor
  }
}

export { findCatalogTimeline, findCatalogTimelineEpisodes }
