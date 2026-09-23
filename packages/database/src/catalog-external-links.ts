import { sql } from 'drizzle-orm'
import { check, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import type { catalogEpisodes, catalogItems } from './schema.ts'

function createCatalogExternalLinksTable(
  items: typeof catalogItems,
  episodes: typeof catalogEpisodes
) {
  return pgTable('catalog_external_links', {
    provider:
      text()
      .notNull(),

    entityType:
      text('entity_type')
      .notNull(),

    externalId:
      text('external_id')
      .notNull(),

    catalogItemId:
      uuid('catalog_item_id')
      .references(() => items.id, { onDelete: 'cascade' }),

    catalogEpisodeId:
      uuid('catalog_episode_id')
      .references(() => episodes.id, { onDelete: 'cascade' })
  }, (table) => [
    primaryKey({ columns: [table.provider, table.entityType, table.externalId] }),
    check('catalog_external_links_external_id_positive', sql`${table.externalId} ~ '^[1-9][0-9]*$'`),
    check('catalog_external_links_target', sql`(${table.catalogItemId} IS NULL) <> (${table.catalogEpisodeId} IS NULL)`),
    check('catalog_external_links_source', sql`
      (${table.provider} = 'tmdb' AND ${table.entityType} IN ('movie', 'tv') AND ${table.catalogItemId} IS NOT NULL)
      OR (${table.provider} = 'tvmaze' AND ${table.entityType} = 'show' AND ${table.catalogItemId} IS NOT NULL)
      OR (${table.provider} = 'tvmaze' AND ${table.entityType} = 'episode' AND ${table.catalogEpisodeId} IS NOT NULL)
    `),
    uniqueIndex('catalog_external_links_item_source_unique')
      .on(table.catalogItemId, table.provider, table.entityType)
      .where(sql`${table.catalogItemId} IS NOT NULL`),
    uniqueIndex('catalog_external_links_episode_source_unique')
      .on(table.catalogEpisodeId, table.provider, table.entityType)
      .where(sql`${table.catalogEpisodeId} IS NOT NULL`)
  ])
}

export { createCatalogExternalLinksTable }
