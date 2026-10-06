/* oxlint-disable eslint/max-lines -- The central schema keeps related catalog and account table exports in one place. */
import type { CatalogViewingCreateInput } from '@tv/shared/catalog-viewings'
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
  check('catalog_viewings_completed_only', sql`${table.status} = 'completed'`),
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

// Read-only projection for the API version running between migration and deployment.
const catalogMovieWatches = pgView('catalog_movie_watches', {
  userId: uuid('user_id'),
  catalogItemId: uuid('catalog_item_id'),

  markedAt: timestamp('marked_at', {
    mode: 'date',
    withTimezone: true
  })
}).as(sql`SELECT user_id, catalog_item_id, max(recorded_at) AS marked_at FROM catalog_viewings WHERE status = 'completed' GROUP BY user_id, catalog_item_id`)

const catalogEpisodeWatches = pgTable('catalog_episode_watches', {
  userId:
    uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  catalogEpisodeId:
    uuid('catalog_episode_id')
    .notNull()
    .references(() => catalogEpisodes.id, { onDelete: 'cascade' }),

  markedAt:
    timestamp('marked_at', {
      mode: 'date',
      withTimezone: true
    })
    .defaultNow()
    .notNull()
}, (table) => [
  primaryKey({ columns: [table.userId, table.catalogEpisodeId] }),
  index('catalog_episode_watches_catalog_episode_id_index')
    .on(table.catalogEpisodeId),
  index('catalog_episode_watches_user_marked_at_episode_index')
    .on(table.userId, table.markedAt.desc(), table.catalogEpisodeId.desc())
])

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
