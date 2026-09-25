import type { Database } from '@tv/database'
import { catalogImportPreviews } from '@tv/database/schema'
import { and, eq, gt, lte, sql } from 'drizzle-orm'
import { sha256 } from './poster.ts'

const PREVIEW_LIFETIME_MS = 24 * 60 * 60 * 1000
const CLEANUP_BATCH_SIZE = 100
const CLEANUP_MAX_BATCHES = 10

type StoredPreview = typeof catalogImportPreviews.$inferSelect

interface PreviewLookup {
  id: string;
  operatorId: string;
  now: Date;
}

// Both future review and application must use this expiry- and owner-checked reader.
async function findImportPreview(database: Pick<Database, 'select'>, lookup: PreviewLookup): Promise<StoredPreview | null> {
  const rows = await database
    .select()
    .from(catalogImportPreviews)
    .where(
      and(
        eq(catalogImportPreviews.id, lookup.id),
        eq(catalogImportPreviews.operatorId, lookup.operatorId),
        gt(catalogImportPreviews.expiresAt, lookup.now)
      )
    )
    .limit(1)

  const [preview] = rows

  if (preview === undefined) {
    return null
  }

  const { poster } = preview.data

  if (poster !== null) {
    const bytes = preview.posterBytes

    if (bytes === null || bytes.byteLength !== poster.byteLength) {
      throw new Error('Saved import poster failed its integrity check')
    }

    const savedHash = sha256(bytes)

    if (savedHash !== poster.sha256) {
      throw new Error('Saved import poster failed its integrity check')
    }
  } else if (preview.posterBytes !== null) {
    throw new Error('Saved import poster metadata is missing')
  }

  return preview
}

async function deleteExpiredImportPreviews(database: Database, now: Date): Promise<number> {
  let deleted = 0

  for (let batch = 0; batch < CLEANUP_MAX_BATCHES; batch += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Keep each cleanup batch bounded and stop when exhausted.
    const rows = await database.execute<{ id: string }>(sql`
      WITH expired AS (
        SELECT ${catalogImportPreviews.id} FROM ${catalogImportPreviews}
        WHERE ${lte(catalogImportPreviews.expiresAt, now)}
        ORDER BY ${catalogImportPreviews.expiresAt}, ${catalogImportPreviews.id}
        LIMIT ${CLEANUP_BATCH_SIZE} FOR UPDATE SKIP LOCKED
      )
      DELETE FROM ${catalogImportPreviews} USING expired
      WHERE ${catalogImportPreviews.id} = expired.id
      RETURNING ${catalogImportPreviews.id}
    `)

    deleted += rows.rows.length

    if (rows.rows.length < CLEANUP_BATCH_SIZE) {
      break
    }
  }

  return deleted
}

export { deleteExpiredImportPreviews, findImportPreview, PREVIEW_LIFETIME_MS }
export type { StoredPreview }
