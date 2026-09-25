import type { ImportApplySummary } from '@tv/shared/catalog-import'
import { sql } from 'drizzle-orm'
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, boolean } from 'drizzle-orm/pg-core'
import type { ImportSelection } from './import-preview.ts'

const catalogImportOperations = pgTable('catalog_import_operations', {
  id: uuid().default(sql`uuidv7()`).primaryKey(),
  previewId: uuid('preview_id').notNull(),
  operatorId: uuid('operator_id').notNull(),
  selection: jsonb().$type<ImportSelection>().notNull(),
  title: text().notNull(),
  posterId: text('poster_id'),
  status: text().$type<'pending' | 'succeeded' | 'failed'>().notNull(),

  startedAt: timestamp('started_at', {
    withTimezone: true,
    mode: 'date'
  }).notNull(),

  leaseExpiresAt: timestamp('lease_expires_at', {
    withTimezone: true,
    mode: 'date'
  }),

  finishedAt: timestamp('finished_at', {
    withTimezone: true,
    mode: 'date'
  }),

  result: jsonb().$type<ImportApplySummary>(),
  failureCode: text('failure_code'),
  failureMessage: text('failure_message'),
  retryable: boolean().default(false).notNull()
}, (table) => [
  check('catalog_import_operations_status', sql`${table.status} IN ('pending', 'succeeded', 'failed')`),
  check('catalog_import_operations_lifecycle', sql`
    (${table.status} = 'pending' AND ${table.leaseExpiresAt} IS NOT NULL AND ${table.finishedAt} IS NULL AND ${table.result} IS NULL AND ${table.failureCode} IS NULL AND ${table.failureMessage} IS NULL AND NOT ${table.retryable})
    OR (${table.status} = 'succeeded' AND ${table.leaseExpiresAt} IS NULL AND ${table.finishedAt} IS NOT NULL AND ${table.result} IS NOT NULL AND ${table.failureCode} IS NULL AND ${table.failureMessage} IS NULL AND NOT ${table.retryable})
    OR (${table.status} = 'failed' AND ${table.leaseExpiresAt} IS NULL AND ${table.finishedAt} IS NOT NULL AND ${table.result} IS NULL AND ${table.failureCode} IS NOT NULL AND ${table.failureMessage} IS NOT NULL)
  `),
  uniqueIndex('catalog_import_operations_active_preview_unique')
    .on(table.previewId)
    .where(sql`${table.status} IN ('pending', 'succeeded')`),
  index('catalog_import_operations_started_at_index').on(table.startedAt.desc(), table.id.desc()),
  index('catalog_import_operations_operator_index').on(table.operatorId, table.startedAt.desc())
])

export { catalogImportOperations }
export type { ImportApplySummary } from '@tv/shared/catalog-import'
