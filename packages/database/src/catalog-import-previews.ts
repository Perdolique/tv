import type { Buffer } from 'node:buffer'
import { sql } from 'drizzle-orm'
import { check, customType, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { ImportPreviewData, ImportSelection } from './import-preview.ts'
import type { users } from './schema.ts'

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea'
})

function createCatalogImportPreviewsTable(operators: typeof users) {
  return pgTable('catalog_import_previews', {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    operatorId: uuid('operator_id').notNull().references(() => operators.id, { onDelete: 'cascade' }),
    status: text().$type<'ready' | 'blocked'>().notNull(),
    selection: jsonb().$type<ImportSelection>().notNull(),
    data: jsonb().$type<ImportPreviewData>().notNull(),
    catalogFingerprint: text('catalog_fingerprint').notNull(),
    posterBytes: bytea('poster_bytes'),

    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'date'
    }).notNull(),

    expiresAt: timestamp('expires_at', {
      withTimezone: true,
      mode: 'date'
    }).notNull()
  }, (table) => [
    index('catalog_import_previews_expires_at_index').on(table.expiresAt),
    check('catalog_import_previews_status', sql`${table.status} IN ('ready', 'blocked')`),
    check('catalog_import_previews_fingerprint', sql`${table.catalogFingerprint} ~ '^[0-9a-f]{64}$'`),
    check('catalog_import_previews_lifetime', sql`${table.expiresAt} = ${table.createdAt} + interval '24 hours'`),
    check('catalog_import_previews_poster_size', sql`octet_length(${table.posterBytes}) BETWEEN 1 AND 1048576`),
    check('catalog_import_previews_poster_pair', sql`(${table.posterBytes} IS NULL) = (${table.data}->>'poster' IS NULL)`)
  ])
}

export { createCatalogImportPreviewsTable }
