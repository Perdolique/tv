import { sql } from 'drizzle-orm'

import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from 'drizzle-orm/pg-core'

import { createCatalogExternalLinksTable } from './catalog-external-links.ts'

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

  description: text(),

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
  uniqueIndex('catalog_episodes_catalog_item_season_episode_unique')
    .on(table.catalogItemId, table.seasonNumber, table.episodeNumber)
])

const catalogExternalLinks = createCatalogExternalLinksTable(catalogItems, catalogEpisodes)

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

const catalogMovieWatches = pgTable('catalog_movie_watches', {
  userId:
    uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  catalogItemId:
    uuid('catalog_item_id')
    .notNull()
    .references(() => catalogItems.id, { onDelete: 'cascade' }),

  markedAt:
    timestamp('marked_at', {
      mode: 'date',
      withTimezone: true
    })
    .defaultNow()
    .notNull()
}, (table) => [
  primaryKey({ columns: [table.userId, table.catalogItemId] }),
  index('catalog_movie_watches_catalog_item_id_index')
    .on(table.catalogItemId),
  index('catalog_movie_watches_user_marked_at_item_index')
    .on(table.userId, table.markedAt.desc(), table.catalogItemId.desc())
])

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
  catalogItemFollows,
  catalogMovieWatches,
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
