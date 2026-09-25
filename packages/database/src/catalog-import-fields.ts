import { sql } from 'drizzle-orm'
import { check, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'
import type { FieldOrigin } from './import-preview.ts'
import type { catalogEpisodes, catalogItems } from './schema.ts'

interface StoredFieldValue {
  value: string | number | null;
  hash?: string | null;
}

function createCatalogImportFieldsTable(items: typeof catalogItems, episodes: typeof catalogEpisodes) {
  return pgTable('catalog_import_fields', {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    catalogItemId: uuid('catalog_item_id').references(() => items.id, { onDelete: 'cascade' }),
    catalogEpisodeId: uuid('catalog_episode_id').references(() => episodes.id, { onDelete: 'cascade' }),
    fieldName: text('field_name').notNull(),
    locale: varchar({ length: 35 }).default('').notNull(),
    source: jsonb().$type<FieldOrigin>().notNull(),
    lastSourceValue: jsonb('last_source_value').$type<StoredFieldValue>().notNull(),
    lastAppliedValue: jsonb('last_applied_value').$type<StoredFieldValue>().notNull(),

    reviewedAt: timestamp('reviewed_at', {
      withTimezone: true,
      mode: 'date'
    }).notNull()
  }, (table) => [
    check('catalog_import_fields_target', sql`(${table.catalogItemId} IS NULL) <> (${table.catalogEpisodeId} IS NULL)`),
    check('catalog_import_fields_name', sql`
      (${table.catalogItemId} IS NOT NULL AND (
        (${table.fieldName} IN ('title', 'description') AND ${table.locale} <> '')
        OR (${table.fieldName} IN ('releaseYear', 'posterPath') AND ${table.locale} = '')
      ))
      OR (${table.catalogEpisodeId} IS NOT NULL AND ${table.fieldName} IN ('seasonNumber', 'episodeNumber', 'sourceTitle', 'airDate') AND ${table.locale} = '')
    `),
    uniqueIndex('catalog_import_fields_item_unique')
      .on(table.catalogItemId, table.fieldName, table.locale)
      .where(sql`${table.catalogItemId} IS NOT NULL`),
    uniqueIndex('catalog_import_fields_episode_unique')
      .on(table.catalogEpisodeId, table.fieldName)
      .where(sql`${table.catalogEpisodeId} IS NOT NULL`)
  ])
}

export { createCatalogImportFieldsTable }
export type { StoredFieldValue }
