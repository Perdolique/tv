import type { Database } from '@tv/database'
import type { CatalogTimelineItem, CatalogTimelineQuery, CatalogTimelineResponse } from '@tv/shared/catalog-timeline'
import { sql } from 'drizzle-orm'
import { CatalogHttpError } from './errors.ts'

import {
  encodeTimelineCursor,
  readTimelinePageCursor,
  type TimelinePosition,
  type TimelineScope,
  type TimelineSourcePosition
} from './timeline-cursors.ts'

interface TimelineOwner {
  userId: string;
  catalogItemId: string;
}

interface TimelineDatabaseRow {
  item: CatalogTimelineItem;
  position: TimelinePosition;
}

interface TimelineDatabasePage {
  catalogExists: boolean;
  upper: TimelineSourcePosition | null;
  calendarVersion: string;
  rows: TimelineDatabaseRow[];
}

const TIMELINE_PAGE_SIZE = 20

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
    : sql`(local_date, occurred_at, id) < (${cursor.after.localDate}::date, ${cursor.after.occurredAt}::timestamptz, ${cursor.after.id}::text)`

  // Episode groups use their calendar day and viewing identity, never a deletable latest mark.
  // Calendar edits invalidate the bounded cursor; ratings do not participate in its version.
  const result = await database.execute<TimelineDatabasePage & Record<string, unknown>>(sql`
    WITH source_events AS MATERIALIZED (
      SELECT events.id, events.kind, events.viewing_id, events.catalog_episode_id, events.season_number, events.episode_ids, events.occurred_at
      FROM catalog_timeline_events events
      WHERE events.user_id = ${owner.userId}::uuid AND events.catalog_item_id = ${owner.catalogItemId}::uuid
        AND events.kind IN ('movie_viewing', 'episode_watched', 'series_started', 'rewatch_started', 'series_completed', 'season_completed', 'available_completed')
    ), upper_position AS (${upperQuery}), bounded_sources AS MATERIALIZED (
      SELECT events.* FROM source_events events CROSS JOIN upper_position upper_bound
      WHERE (events.occurred_at, events.id) <= (upper_bound.occurred_at, upper_bound.id)
    ), calendar_viewings AS (
      SELECT DISTINCT viewings.id, viewings.started_on, viewings.completed_on
      FROM bounded_sources events JOIN catalog_viewings viewings ON viewings.id = events.viewing_id
      WHERE events.kind IN ('movie_viewing', 'series_started', 'rewatch_started', 'series_completed')
    ), calendar_version AS (
      SELECT md5(coalesce(jsonb_agg(jsonb_build_array(id, started_on, completed_on) ORDER BY id)::text, '[]')) AS version
      FROM calendar_viewings
    ), dated_events AS MATERIALIZED (
      SELECT events.*,
        CASE events.kind
          WHEN 'movie_viewing' THEN viewings.completed_on::timestamp AT TIME ZONE 'UTC'
          WHEN 'series_started' THEN viewings.started_on::timestamp AT TIME ZONE 'UTC'
          WHEN 'rewatch_started' THEN viewings.started_on::timestamp AT TIME ZONE 'UTC'
          WHEN 'series_completed' THEN viewings.completed_on::timestamp AT TIME ZONE 'UTC'
          ELSE events.occurred_at END AS calendar_at
      FROM bounded_sources events JOIN catalog_viewings viewings ON viewings.id = events.viewing_id
    ), bounded AS MATERIALIZED (
      SELECT events.*,
        (events.calendar_at AT TIME ZONE CASE WHEN events.kind IN ('movie_viewing', 'series_started', 'rewatch_started', 'series_completed')
          THEN 'UTC' ELSE ${query.timeZone} END)::date AS local_date
      FROM dated_events events
    ), episode_groups AS (
      SELECT 'episode_group:' || viewing_id::text || ':' || local_date::text AS id,
        local_date::timestamp AT TIME ZONE 'UTC' AS occurred_at, viewing_id, local_date, count(*)::integer AS total_count
      FROM bounded WHERE kind = 'episode_watched' GROUP BY viewing_id, local_date
    ), numbered_episodes AS (
      SELECT events.viewing_id, events.local_date, episodes.season_number, episodes.episode_number,
        episodes.episode_number - row_number() OVER (
          PARTITION BY events.viewing_id, events.local_date, episodes.season_number ORDER BY episodes.episode_number
        ) AS range_key
      FROM bounded events JOIN catalog_episodes episodes ON episodes.id = events.catalog_episode_id
      WHERE events.kind = 'episode_watched'
    ), episode_ranges AS (
      SELECT viewing_id, local_date, season_number, min(episode_number) AS first_number, max(episode_number) AS last_number
      FROM numbered_episodes GROUP BY viewing_id, local_date, season_number, range_key
    ), episode_seasons AS (
      SELECT viewing_id, local_date, season_number,
        jsonb_agg(jsonb_build_object('firstEpisodeNumber', first_number, 'lastEpisodeNumber', last_number) ORDER BY first_number) AS ranges
      FROM episode_ranges GROUP BY viewing_id, local_date, season_number
    ), group_metadata AS (
      SELECT viewing_id, local_date,
        jsonb_agg(jsonb_build_object('seasonNumber', season_number, 'ranges', ranges) ORDER BY season_number) AS seasons
      FROM episode_seasons GROUP BY viewing_id, local_date
    ), timeline_rows AS (
      SELECT events.id::text AS id, events.calendar_at AS occurred_at, events.local_date,
        jsonb_build_object('id', events.id, 'kind', events.kind,
          'occurredAt', to_char(events.calendar_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'viewingId', events.viewing_id) ||
        CASE events.kind
          WHEN 'movie_viewing' THEN jsonb_build_object('startedOn', viewings.started_on::text, 'completedOn', viewings.completed_on::text, 'score', ratings.score)
          WHEN 'series_started' THEN jsonb_build_object('startedOn', viewings.started_on::text, 'score', ratings.score)
          WHEN 'rewatch_started' THEN jsonb_build_object('startedOn', viewings.started_on::text, 'score', ratings.score)
          WHEN 'series_completed' THEN jsonb_build_object('completedOn', viewings.completed_on::text)
          WHEN 'season_completed' THEN jsonb_build_object('seasonNumber', events.season_number, 'totalCount', jsonb_array_length(events.episode_ids))
          WHEN 'available_completed' THEN jsonb_build_object('seasonNumber', events.season_number, 'totalCount', jsonb_array_length(events.episode_ids))
          ELSE '{}'::jsonb END AS item
      FROM bounded events JOIN catalog_viewings viewings ON viewings.id = events.viewing_id
      LEFT JOIN catalog_item_ratings ratings ON ratings.viewing_id = viewings.id AND ratings.user_id = viewings.user_id
        AND ratings.catalog_item_id = viewings.catalog_item_id AND ratings.season_number IS NULL AND ratings.catalog_episode_id IS NULL
      WHERE events.kind <> 'episode_watched'
      UNION ALL
      SELECT groups.id, groups.occurred_at, groups.local_date,
        jsonb_build_object('id', groups.id, 'kind', 'episode_group',
          'occurredAt', to_char(groups.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'viewingId', groups.viewing_id, 'localDate', groups.local_date::text, 'totalCount', groups.total_count, 'seasons', metadata.seasons) AS item
      FROM episode_groups groups JOIN group_metadata metadata USING (viewing_id, local_date)
    ), page AS (
      SELECT * FROM timeline_rows WHERE ${position}
      ORDER BY local_date DESC, occurred_at DESC, id DESC LIMIT ${TIMELINE_PAGE_SIZE + 1}
    )
    SELECT EXISTS (SELECT 1 FROM catalog_items items
        JOIN catalog_item_titles titles ON titles.catalog_item_id = items.id AND titles.is_original
        WHERE items.id = ${owner.catalogItemId}::uuid) AS "catalogExists",
      (SELECT jsonb_build_object('id', id,
        'occurredAt', to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) FROM upper_position) AS upper,
      (SELECT version FROM calendar_version) AS "calendarVersion",
      coalesce((SELECT jsonb_agg(jsonb_build_object('item', item, 'position', jsonb_build_object('id', id,
        'occurredAt', to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'localDate', local_date::text))
        ORDER BY local_date DESC, occurred_at DESC, id DESC) FROM page), '[]'::jsonb) AS rows
  `)

  const [page] = result.rows

  if (page === undefined) {
    throw new Error('Timeline page is missing')
  }

  if (!page.catalogExists) {
    throw new CatalogHttpError('NOT_FOUND', 404)
  }

  if (cursor !== null && cursor.calendarVersion !== page.calendarVersion) {
    throw new CatalogHttpError('INVALID_REQUEST', 400, {
      fields: { cursor: 'Viewing dates changed. Reload the timeline.' }
    })
  }

  const rows = page.rows.slice(0, TIMELINE_PAGE_SIZE)
  const items = rows.map(row => row.item)
  const last = rows.at(-1)
  let nextCursor: string | null = null

  if (page.rows.length > TIMELINE_PAGE_SIZE && last !== undefined && page.upper !== null) {
    nextCursor = encodeTimelineCursor({
      kind: 'timeline',
      version: 4,
      userId: scope.userId,
      catalogItemId: scope.catalogItemId,
      timeZone: scope.timeZone,
      upper: page.upper,
      after: last.position,
      calendarVersion: page.calendarVersion
    })
  }

  return {
    items,
    nextCursor
  }
}

export { findCatalogTimeline }
