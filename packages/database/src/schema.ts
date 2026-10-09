/* oxlint-disable eslint/max-lines -- The central schema keeps related catalog and account table exports in one place. */
import type { CatalogViewingCreateInput } from '@tv/shared/catalog-viewings'
import type { CatalogSeriesWatchesResponse } from '@tv/shared/catalog-series'
import { sql } from 'drizzle-orm'

import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  pgView,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar
} from 'drizzle-orm/pg-core'

import { createCatalogExternalLinksTable } from './catalog-external-links.ts'
import { createCatalogImportFieldsTable } from './catalog-import-fields.ts'
import { createCatalogImportPreviewsTable } from './catalog-import-previews.ts'

const catalogItemType = pgEnum('catalog_item_type', ['movie', 'series'])

const catalogItems = pgTable('catalog_items', {
  id:
    uuid()
    .default(sql`uuidv7()`)
    .primaryKey(),

  type:
    catalogItemType()
    .notNull(),

  releaseYear: integer('release_year'),
  posterPath: text('poster_path')
})

const catalogItemTitles = pgTable('catalog_item_titles', {
  catalogItemId:
    uuid('catalog_item_id')
    .notNull()
    .references(() => catalogItems.id, { onDelete: 'cascade' }),

  locale:
    varchar({ length: 35 })
    .notNull(),

  title:
    text()
    .notNull(),

  isOriginal:
    boolean('is_original')
    .default(false)
    .notNull()
}, (table) => [
  primaryKey({ columns: [table.catalogItemId, table.locale] }),
  uniqueIndex('catalog_item_titles_original_unique')
    .on(table.catalogItemId)
    .where(sql`${table.isOriginal}`)
])

const catalogItemDescriptions = pgTable('catalog_item_descriptions', {
  catalogItemId: uuid('catalog_item_id').notNull().references(() => catalogItems.id, { onDelete: 'cascade' }),
  locale: varchar({ length: 35 }).notNull(),
  description: text().notNull()
}, (table) => [
  primaryKey({ columns: [table.catalogItemId, table.locale] })
])

const catalogReleases = pgTable('catalog_releases', {
  id:
    uuid()
    .default(sql`uuidv7()`)
    .primaryKey(),

  catalogItemId:
    uuid('catalog_item_id')
    .notNull()
    .references(() => catalogItems.id, { onDelete: 'cascade' }),

  releaseDate:
    date('release_date', { mode: 'string' })
    .notNull(),

  seasonNumber: integer('season_number'),
  episodeNumber: integer('episode_number')
}, (table) => [
  index('catalog_releases_catalog_item_id_release_date_index')
    .on(table.catalogItemId, table.releaseDate)
])

const catalogEpisodes = pgTable('catalog_episodes', {
  id:
    uuid()
    .default(sql`uuidv7()`)
    .primaryKey(),

  catalogItemId:
    uuid('catalog_item_id')
    .notNull()
    .references(() => catalogItems.id, { onDelete: 'cascade' }),

  seasonNumber:
    integer('season_number')
    .notNull(),

  episodeNumber:
    integer('episode_number')
    .notNull(),

  sourceTitle: text('source_title'),
  airDate: date('air_date', { mode: 'string' })
}, (table) => [
  check('catalog_episodes_season_number_positive', sql`${table.seasonNumber} > 0`),
  check('catalog_episodes_episode_number_positive', sql`${table.episodeNumber} > 0`),
  unique('catalog_episodes_id_item_unique').on(table.id, table.catalogItemId),
  uniqueIndex('catalog_episodes_catalog_item_season_episode_unique')
    .on(table.catalogItemId, table.seasonNumber, table.episodeNumber)
])

const catalogExternalLinks = createCatalogExternalLinksTable(catalogItems, catalogEpisodes)
const catalogImportFields = createCatalogImportFieldsTable(catalogItems, catalogEpisodes)

const users = pgTable('users', {
  id:
    uuid()
    .default(sql`uuidv7()`)
    .primaryKey(),

  email:
    varchar({ length: 254 })
    .notNull(),

  createdAt:
    timestamp('created_at', {
      mode: 'date',
      withTimezone: true
    })
    .defaultNow()
    .notNull(),

  updatedAt:
    timestamp('updated_at', {
      mode: 'date',
      withTimezone: true
    })
    .defaultNow()
    .notNull()
}, (table) => [
  uniqueIndex('users_email_unique').on(table.email)
])

const catalogImportPreviews = createCatalogImportPreviewsTable(users)

const userPermissions = pgTable('user_permissions', {
  userId:
    uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  permission:
    text()
    .notNull()
}, (table) => [
  primaryKey({ columns: [table.userId, table.permission] })
])

const catalogItemFollows = pgTable('catalog_item_follows', {
  userId:
    uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  catalogItemId:
    uuid('catalog_item_id')
    .notNull()
    .references(() => catalogItems.id, { onDelete: 'cascade' }),

  followedAt:
    timestamp('followed_at', {
      mode: 'date',
      withTimezone: true
    })
    .defaultNow()
    .notNull()
}, (table) => [
  primaryKey({ columns: [table.userId, table.catalogItemId] }),
  index('catalog_item_follows_catalog_item_id_index')
    .on(table.catalogItemId),
  index('catalog_item_follows_user_followed_at_index')
    .on(table.userId, table.followedAt.desc())
])

// Ratings are current opinions, not viewing records. Their IDs stay stable on updates.
// Adding future viewing links must leave existing ratings unlinked.
const catalogItemRatings = pgTable('catalog_item_ratings', {
  id: uuid().default(sql`uuidv7()`).primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  catalogItemId: uuid('catalog_item_id').notNull().references(() => catalogItems.id, { onDelete: 'cascade' }),
  seasonNumber: integer('season_number'),
  catalogEpisodeId: uuid('catalog_episode_id'),
  score: integer().notNull()
}, (table) => [
  check('catalog_item_ratings_single_target', sql`${table.catalogEpisodeId} IS NULL OR ${table.seasonNumber} IS NULL`),
  foreignKey({
    columns: [table.catalogEpisodeId, table.catalogItemId],
    foreignColumns: [catalogEpisodes.id, catalogEpisodes.catalogItemId],
    name: 'catalog_item_ratings_episode_item_fk'
  }).onDelete('cascade'),
  check('catalog_item_ratings_season_number_positive', sql`${table.seasonNumber} > 0`),
  check('catalog_item_ratings_score_bounds', sql`${table.score} BETWEEN 1 AND 10`),
  unique('catalog_item_ratings_user_target_unique').on(table.userId, table.catalogItemId, table.seasonNumber, table.catalogEpisodeId).nullsNotDistinct(),
  index('catalog_item_ratings_episode_index').on(table.catalogEpisodeId),
  index('catalog_item_ratings_target_index').on(table.catalogItemId, table.seasonNumber)
])

const catalogViewings = pgTable('catalog_viewings', {
  id: uuid().default(sql`uuidv7()`).primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  catalogItemId: uuid('catalog_item_id').notNull().references(() => catalogItems.id, { onDelete: 'cascade' }),
  status: text().notNull().default('completed'),
  startedOn: date('started_on', { mode: 'string' }),
  completedOn: date('completed_on', { mode: 'string' }),

  recordedAt: timestamp('recorded_at', {
    withTimezone: true,
    mode: 'date'
  }).defaultNow().notNull(),

  revision: integer().notNull().default(1)
}, (table) => [
  unique('catalog_viewings_owner_item_id_unique').on(table.userId, table.catalogItemId, table.id),
  check('catalog_viewings_status', sql`${table.status} IN ('watching', 'paused', 'completed')`),
  uniqueIndex('catalog_viewings_one_watching_unique').on(table.userId, table.catalogItemId).where(sql`${table.status} = 'watching'`),
  check('catalog_viewings_revision_positive', sql`${table.revision} > 0`),
  check('catalog_viewings_date_order', sql`${table.startedOn} <= ${table.completedOn}`),
  check('catalog_viewings_date_range', sql`(${table.startedOn} IS NULL OR ${table.startedOn} BETWEEN '0001-01-01'::date AND '9999-12-31'::date) AND (${table.completedOn} IS NULL OR ${table.completedOn} BETWEEN '0001-01-01'::date AND '9999-12-31'::date)`),
  index('catalog_viewings_owner_item_recorded_index').on(table.userId, table.catalogItemId, table.recordedAt.desc(), table.id.desc()),
  index('catalog_viewings_owner_recorded_index').on(table.userId, table.recordedAt.desc(), table.id.desc()),
  index('catalog_viewings_item_index').on(table.catalogItemId)
])

const catalogViewingContexts = pgTable('catalog_viewing_contexts', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  catalogItemId: uuid('catalog_item_id').notNull().references(() => catalogItems.id, { onDelete: 'cascade' }),
  currentViewingId: uuid('current_viewing_id'),
  contextVersion: integer('context_version').notNull().default(0)
}, (table) => [
  primaryKey({ columns: [table.userId, table.catalogItemId] }),
  check('catalog_viewing_contexts_version_nonnegative', sql`${table.contextVersion} >= 0`),

  // The migration limits SET NULL to the viewing ID; Drizzle cannot express its column list.
  foreignKey({
    name: 'catalog_viewing_contexts_owner_item_fk',
    columns: [table.userId, table.catalogItemId, table.currentViewingId],
    foreignColumns: [catalogViewings.userId, catalogViewings.catalogItemId, catalogViewings.id]
  }).onDelete('set null'),
  index('catalog_viewing_contexts_current_index').on(table.currentViewingId)
])

// Creation keys survive viewing deletion so a late retry cannot restore a deleted record.
const catalogViewingCreations = pgTable('catalog_viewing_creations', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  requestId: uuid('request_id').notNull(),
  catalogItemId: uuid('catalog_item_id').notNull().references(() => catalogItems.id, { onDelete: 'cascade' }),
  input: jsonb().$type<CatalogViewingCreateInput>().notNull(),
  viewingId: uuid('viewing_id')
}, (table) => [
  primaryKey({ columns: [table.userId, table.requestId] }),

  // The migration limits SET NULL to the viewing ID; Drizzle cannot express its column list.
  foreignKey({
    name: 'catalog_viewing_creations_owner_item_fk',
    columns: [table.userId, table.catalogItemId, table.viewingId],
    foreignColumns: [catalogViewings.userId, catalogViewings.catalogItemId, catalogViewings.id]
  }).onDelete('set null'),
  index('catalog_viewing_creations_viewing_index').on(table.viewingId),
  index('catalog_viewing_creations_item_index').on(table.catalogItemId)
])

const catalogViewingEpisodeWatches = pgTable('catalog_viewing_episode_watches', {
  id: uuid().default(sql`uuidv7()`).primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  catalogItemId: uuid('catalog_item_id').notNull().references(() => catalogItems.id, { onDelete: 'cascade' }),
  viewingId: uuid('viewing_id').notNull(),
  catalogEpisodeId: uuid('catalog_episode_id').notNull(),

  markedAt: timestamp('marked_at', {
    mode: 'date',
    withTimezone: true
  }).default(sql`clock_timestamp()`).notNull()
}, table => [
  unique('catalog_viewing_episode_watches_viewing_episode_unique').on(table.viewingId, table.catalogEpisodeId),
  unique('catalog_viewing_episode_watches_owner_item_id_unique').on(table.userId, table.catalogItemId, table.id),
  foreignKey({
    name: 'catalog_viewing_episode_watches_viewing_fk',
    columns: [table.userId, table.catalogItemId, table.viewingId],
    foreignColumns: [catalogViewings.userId, catalogViewings.catalogItemId, catalogViewings.id]
  }).onDelete('cascade'),
  foreignKey({
    name: 'catalog_viewing_episode_watches_episode_fk',
    columns: [table.catalogEpisodeId, table.catalogItemId],
    foreignColumns: [catalogEpisodes.id, catalogEpisodes.catalogItemId]
  }).onDelete('cascade'),
  index('catalog_viewing_episode_watches_episode_index').on(table.catalogEpisodeId),
  index('catalog_viewing_episode_watches_user_marked_index').on(table.userId, table.markedAt.desc(), table.id.desc())
])

const catalogTimelineEvents = pgTable('catalog_timeline_events', {
  id: uuid().default(sql`uuidv7()`).primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  catalogItemId: uuid('catalog_item_id').notNull().references(() => catalogItems.id, { onDelete: 'cascade' }),
  kind: text().notNull(),

  occurredAt: timestamp('occurred_at', {
    mode: 'date',
    withTimezone: true
  }).default(sql`clock_timestamp()`).notNull(),

  viewingId: uuid('viewing_id'),
  watchId: uuid('watch_id'),
  catalogEpisodeId: uuid('catalog_episode_id'),
  seasonNumber: integer('season_number'),
  previousScore: integer('previous_score'),
  score: integer(),
  episodeIds: jsonb('episode_ids').$type<string[]>()
}, table => [
  check('catalog_timeline_events_kind', sql`${table.kind} IN ('movie_viewing', 'episode_watched', 'series_started', 'rewatch_started', 'series_paused', 'series_completed', 'season_completed', 'available_completed', 'rating_changed')`),
  check('catalog_timeline_events_score', sql`(${table.previousScore} IS NULL OR ${table.previousScore} BETWEEN 1 AND 10) AND (${table.score} IS NULL OR ${table.score} BETWEEN 1 AND 10)`),
  foreignKey({
    name: 'catalog_timeline_events_viewing_fk',
    columns: [table.userId, table.catalogItemId, table.viewingId],
    foreignColumns: [catalogViewings.userId, catalogViewings.catalogItemId, catalogViewings.id]
  }).onDelete('cascade'),
  foreignKey({
    name: 'catalog_timeline_events_watch_fk',
    columns: [table.userId, table.catalogItemId, table.watchId],
    foreignColumns: [catalogViewingEpisodeWatches.userId, catalogViewingEpisodeWatches.catalogItemId, catalogViewingEpisodeWatches.id]
  }).onDelete('cascade'),
  foreignKey({
    name: 'catalog_timeline_events_episode_fk',
    columns: [table.catalogEpisodeId, table.catalogItemId],
    foreignColumns: [catalogEpisodes.id, catalogEpisodes.catalogItemId]
  }).onDelete('cascade'),
  index('catalog_timeline_events_owner_item_time_index').on(table.userId, table.catalogItemId, table.occurredAt.desc(), table.id.desc()),
  uniqueIndex('catalog_timeline_events_episode_watch_unique').on(table.watchId).where(sql`${table.kind} = 'episode_watched'`),
  uniqueIndex('catalog_timeline_events_movie_viewing_unique').on(table.viewingId).where(sql`${table.kind} = 'movie_viewing'`),
  index('catalog_timeline_events_watch_index').on(table.watchId),
  index('catalog_timeline_events_viewing_index').on(table.viewingId)
])

const catalogTimelineEventWatches = pgTable('catalog_timeline_event_watches', {
  eventId: uuid('event_id').notNull().references(() => catalogTimelineEvents.id, { onDelete: 'cascade' }),
  watchId: uuid('watch_id').notNull().references(() => catalogViewingEpisodeWatches.id, { onDelete: 'cascade' })
}, table => [
  primaryKey({ columns: [table.eventId, table.watchId] }),
  index('catalog_timeline_event_watches_watch_index').on(table.watchId)
])

// Tombstones keep late retries from restoring marks removed by a correction.
const catalogSeriesRequests = pgTable('catalog_series_requests', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  requestId: uuid('request_id').notNull(),
  catalogItemId: uuid('catalog_item_id').notNull().references(() => catalogItems.id, { onDelete: 'cascade' }),
  action: text().notNull(),
  input: jsonb().notNull(),
  result: jsonb().$type<CatalogSeriesWatchesResponse>().notNull(),
  viewingId: uuid('viewing_id'),
  watchIds: jsonb('watch_ids').$type<string[]>().notNull(),
  tombstoned: boolean().notNull().default(false)
}, table => [
  primaryKey({ columns: [table.userId, table.requestId] }),

  // The migration limits SET NULL to the viewing ID; Drizzle cannot express its column list.
  foreignKey({
    name: 'catalog_series_requests_viewing_fk',
    columns: [table.userId, table.catalogItemId, table.viewingId],
    foreignColumns: [catalogViewings.userId, catalogViewings.catalogItemId, catalogViewings.id]
  }).onDelete('set null'),
  index('catalog_series_requests_viewing_index').on(table.viewingId)
])

// Read-only projections for the API version running between migration and deployment.
const catalogMovieWatches = pgView('catalog_movie_watches', {
  userId: uuid('user_id'),
  catalogItemId: uuid('catalog_item_id'),

  markedAt: timestamp('marked_at', {
    mode: 'date',
    withTimezone: true
  })
}).as(sql`SELECT viewings.user_id, viewings.catalog_item_id, max(viewings.recorded_at) AS marked_at FROM catalog_viewings viewings JOIN catalog_items items ON items.id = viewings.catalog_item_id WHERE items.type = 'movie' AND viewings.status = 'completed' GROUP BY viewings.user_id, viewings.catalog_item_id`)

const catalogEpisodeWatches = pgView('catalog_episode_watches', {
  userId: uuid('user_id'),
  catalogEpisodeId: uuid('catalog_episode_id'),

  markedAt: timestamp('marked_at', {
    mode: 'date',
    withTimezone: true
  })
}).as(sql`SELECT watches.user_id, watches.catalog_episode_id, watches.marked_at FROM catalog_viewing_episode_watches watches JOIN catalog_viewing_contexts contexts ON contexts.user_id = watches.user_id AND contexts.catalog_item_id = watches.catalog_item_id AND contexts.current_viewing_id = watches.viewing_id`)

const passwordCredentials = pgTable('password_credentials', {
  userId:
    uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),

  passwordHash:
    varchar('password_hash', { length: 256 })
    .notNull(),

  createdAt:
    timestamp('created_at', {
      mode: 'date',
      withTimezone: true
    })
    .defaultNow()
    .notNull(),

  updatedAt:
    timestamp('updated_at', {
      mode: 'date',
      withTimezone: true
    })
    .defaultNow()
    .notNull()
})

const emailVerificationTokens = pgTable('email_verification_tokens', {
  tokenHash:
    varchar('token_hash', { length: 64 })
    .primaryKey(),

  email:
    varchar({ length: 254 })
    .notNull(),

  redirectTo:
    text('redirect_to')
    .notNull(),

  createdAt:
    timestamp('created_at', {
      mode: 'date',
      withTimezone: true
    })
    .defaultNow()
    .notNull(),

  expiresAt:
    timestamp('expires_at', {
      mode: 'date',
      withTimezone: true
    })
    .notNull()
}, (table) => [
  index('email_verification_tokens_email_index').on(table.email),
  index('email_verification_tokens_expires_at_index').on(table.expiresAt)
])

const sessions = pgTable('sessions', {
  id:
    uuid()
    .default(sql`uuidv7()`)
    .primaryKey(),

  userId:
    uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  tokenHash:
    varchar('token_hash', { length: 64 })
    .notNull(),

  createdAt:
    timestamp('created_at', {
      mode: 'date',
      withTimezone: true
    })
    .defaultNow()
    .notNull(),

  expiresAt:
    timestamp('expires_at', {
      mode: 'date',
      withTimezone: true
    })
    .notNull()
}, (table) => [
  uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
  index('sessions_user_id_index').on(table.userId),
  index('sessions_expires_at_index').on(table.expiresAt)
])

export {
  catalogEpisodes,
  catalogEpisodeWatches,
  catalogExternalLinks,
  catalogImportFields,
  catalogImportPreviews,
  catalogItemFollows,
  catalogItemRatings,
  catalogItemDescriptions,
  catalogMovieWatches,
  catalogViewings,
  catalogViewingEpisodeWatches,
  catalogTimelineEvents,
  catalogTimelineEventWatches,
  catalogSeriesRequests,
  catalogViewingContexts,
  catalogViewingCreations,
  catalogItemTitles,
  catalogItems,
  catalogItemType,
  catalogReleases,
  emailVerificationTokens,
  passwordCredentials,
  sessions,
  userPermissions,
  users
}

export { catalogImportOperations } from './catalog-import-operations.ts'
