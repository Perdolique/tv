/* oxlint-disable eslint/max-lines -- Keep the preview lease and transactional apply lifecycle together. */
import type { Database } from '@tv/database'
import type { ImportApplySummary } from '@tv/database/catalog-import-operations'
import type { ImportCard, ImportPreviewData, PreviewIssue } from '@tv/database/import-preview'
import { catalogImportOperations } from '@tv/database/schema'
import { and, desc, eq, lte, sql } from 'drizzle-orm'
import * as v from 'valibot'

// oxlint-disable-next-line import/no-relative-parent-imports -- Import application shares the catalog access boundary.
import { hasCatalogImportPermission } from '../permissions.ts'
import { inspectCatalogState, readCatalogState } from './catalog-state.ts'
import { writeCatalogImport } from './apply-catalog.ts'

import {
  FAILURES,
  ImportApplyFailureError,
  classifyFailure,
  isFailureCode,
  issue,
  logApplyFailure,
  sameData,
  type FailureCode
} from './apply-failures.ts'

import { planImportChanges } from './changes.ts'
import { hostedPosterId, uploadPreparedPoster } from './hosted-poster.ts'
import { findImportPreview, type StoredPreview } from './repository.ts'
import { requireImportPermission, type ImportSession } from './service.ts'

type ImportOperation = typeof catalogImportOperations.$inferSelect
type OperationReader = Pick<Database, 'select'>

interface ReadyPreviewData extends ImportPreviewData {
  card: ImportCard;
}

interface ReadyStoredPreview extends StoredPreview {
  data: ReadyPreviewData;
}

interface ApplyImportOptions {
  hosted: ImagesBinding['hosted'];
  namespace: string;
  retry?: boolean;
  now?: () => Date;
}

interface PendingInput {
  session: ImportSession;
  preview: StoredPreview;
  operation: ImportOperation;
  posterPath: string | null;
  now: Date;
}

interface FailureInput {
  database: Database;
  operation: ImportOperation;
  failure: ImportApplyFailureError;
  now: Date;
}

type ApplyImportResult =
  | { status: 'succeeded'; operation: ImportOperation; result: ImportApplySummary }
  | { status: 'pending'; operation: ImportOperation }
  | { status: 'failed'; operation: ImportOperation; issue: PreviewIssue }
  | { status: 'blocked'; issue: PreviewIssue }

const LEASE_MS = 5 * 60 * 1000

async function latestOperation(database: OperationReader, previewId: string, operatorId: string): Promise<ImportOperation | null> {
  const rows = await database.select()
    .from(catalogImportOperations)
    .where(
      and(
        eq(catalogImportOperations.previewId, previewId),
        eq(catalogImportOperations.operatorId, operatorId)
      )
    )
    .orderBy(desc(catalogImportOperations.startedAt), desc(catalogImportOperations.id))
    .limit(1)

  return rows[0] ?? null
}

function operationResult(operation: ImportOperation): ApplyImportResult {
  if (operation.status === 'succeeded' && operation.result !== null) {
    return {
      status: 'succeeded',
      operation,
      result: operation.result
    }
  }

  if (operation.status === 'pending') {
    return {
      status: 'pending',
      operation
    }
  }

  const code = operation.failureCode

  if (code !== null && isFailureCode(code)) {
    return {
      status: 'failed',
      operation,
      issue: issue(code)
    }
  }

  return {
    status: 'failed',
    operation,
    issue: issue('apply_failed')
  }
}

async function expirePending(database: Database, operation: ImportOperation, now: Date): Promise<ImportOperation> {
  if (operation.status !== 'pending' || operation.leaseExpiresAt === null || operation.leaseExpiresAt > now) {
    return operation
  }

  const rows = await database.update(catalogImportOperations)
    .set({
      status: 'failed',
      leaseExpiresAt: null,
      finishedAt: now,
      failureCode: 'interrupted',
      failureMessage: FAILURES.interrupted,
      retryable: true
    })
    .where(
      and(
        eq(catalogImportOperations.id, operation.id),
        eq(catalogImportOperations.status, 'pending'),
        lte(catalogImportOperations.leaseExpiresAt, now)
      )
    )
    .returning()

  if (rows[0] !== undefined) {
    return rows[0]
  }

  return await latestOperation(database, operation.previewId, operation.operatorId) ?? operation
}

function readyPreview(preview: StoredPreview | null): preview is ReadyStoredPreview {
  if (preview?.status !== 'ready') {
    return false
  }

  const version: unknown = preview.data.version

  return version === 2 && preview.data.card !== null && preview.data.errors.length === 0
}

function previewFailure(preview: StoredPreview | null): FailureCode {
  if (preview === null) {
    return 'preview_unavailable'
  }

  const version: unknown = preview.data.version

  if (version !== 2) {
    return 'preview_version'
  }

  return 'preview_not_ready'
}

function needsPoster(preview: StoredPreview): boolean {
  return preview.data.changes.some(change => change.target === 'item'
    && change.field === 'posterPath'
    && change.sourceValue !== null
    && (change.action === 'add' || change.action === 'update'))
}

async function applyPending({ session, preview, operation, posterPath, now }: PendingInput): Promise<ImportOperation> {
  return session.database.transaction(async (transaction) => {
    const locked = await transaction.select()
      .from(catalogImportOperations)
      .where(
        eq(catalogImportOperations.id, operation.id)
      )
      .for('update')
      .limit(1)

    if (locked[0]?.status !== 'pending' || locked[0].leaseExpiresAt === null || locked[0].leaseExpiresAt <= now) {
      throw new ImportApplyFailureError('interrupted', true)
    }

    if (!await hasCatalogImportPermission(transaction, session.user.id)) {
      throw new ImportApplyFailureError('access_revoked', true)
    }

    const current = await findImportPreview(transaction, {
      id: preview.id,
      operatorId: session.user.id,
      now
    })

    if (!readyPreview(current)) {
      throw new ImportApplyFailureError(previewFailure(current))
    }

    if (!sameData(current.data, preview.data) || current.catalogFingerprint !== preview.catalogFingerprint) {
      throw new ImportApplyFailureError('preview_changed')
    }

    const state = await readCatalogState(transaction, current.selection, current.data.episodes)
    const inspection = inspectCatalogState(state, current.selection, current.data.episodes)

    const plan = planImportChanges(state, {
      card: current.data.card,
      episodes: current.data.episodes,
      catalogItemId: inspection.additions.catalogItemId,
      posterHash: current.data.poster?.sha256 ?? null
    })

    if (inspection.fingerprint !== current.catalogFingerprint) {
      throw new ImportApplyFailureError('catalog_changed')
    }

    if (inspection.errors.length > 0 || plan.errors.length > 0
      || !sameData(inspection.additions, current.data.additions)
      || !sameData(plan.changes, current.data.changes)) {
      throw new ImportApplyFailureError('preview_changed')
    }

    const result = await writeCatalogImport({
      database: transaction,
      preview: current,
      state,
      uploadedPosterPath: posterPath,
      now
    })

    const rows = await transaction.update(catalogImportOperations)
      .set({
        status: 'succeeded',
        leaseExpiresAt: null,
        finishedAt: now,
        result
      })
      .where(
        and(
          eq(catalogImportOperations.id, operation.id),
          eq(catalogImportOperations.status, 'pending')
        )
      )
      .returning()

    if (rows[0] === undefined) {
      throw new Error('Pending import operation could not be completed')
    }

    return rows[0]
  }, { isolationLevel: 'repeatable read' })
}

async function failPending({ database, operation, failure, now }: FailureInput): Promise<ImportOperation> {
  const rows = await database.update(catalogImportOperations)
    .set({
      status: 'failed',
      leaseExpiresAt: null,
      finishedAt: now,
      failureCode: failure.code,
      failureMessage: failure.message,
      retryable: failure.retryable
    })
    .where(
      and(
        eq(catalogImportOperations.id, operation.id),
        eq(catalogImportOperations.status, 'pending')
      )
    )
    .returning()

  return rows[0] ?? await latestOperation(database, operation.previewId, operation.operatorId) ?? operation
}

// oxlint-disable-next-line eslint/complexity -- Authorization, idempotency, lease, poster, and transaction decisions belong to one operation boundary.
async function applyImportPreview(session: ImportSession, previewId: string, options: ApplyImportOptions): Promise<ApplyImportResult> {
  await requireImportPermission(session)

  if (!v.safeParse(v.pipe(v.string(), v.uuid()), previewId).success) {
    return {
      status: 'blocked',
      issue: issue('preview_unavailable')
    }
  }

  const now = options.now?.() ?? new Date()
  const existing = await latestOperation(session.database, previewId, session.user.id)

  if (existing !== null) {
    const latest = await expirePending(session.database, existing, now)

    if (latest.status !== 'failed' || options.retry !== true) {
      return operationResult(latest)
    }

    if (!latest.retryable) {
      return operationResult(latest)
    }
  }

  // oxlint-disable-next-line eslint/init-declarations -- The lookup can throw; its failure returns a safe result below.
  let preview: StoredPreview | null

  try {
    preview = await findImportPreview(session.database, {
      id: previewId,
      operatorId: session.user.id,
      now
    })
  } catch (error) {
    logApplyFailure(error, previewId)

    return {
      status: 'blocked',
      issue: issue('preview_changed')
    }
  }

  if (!readyPreview(preview)) {
    return {
      status: 'blocked',
      issue: issue(previewFailure(preview))
    }
  }

  const { card, poster } = preview.data
  const uploadPoster = needsPoster(preview)

  if (uploadPoster && (poster === null || preview.posterBytes === null)) {
    return {
      status: 'blocked',
      issue: issue('preview_changed')
    }
  }

  const posterId = uploadPoster && poster !== null
    ? hostedPosterId(options.namespace, preview.selection, poster)
    : null

  const created = await session.database.insert(catalogImportOperations).values({
    previewId,
    operatorId: session.user.id,
    selection: preview.selection,
    title: card.originalTitle.value,
    posterId,
    status: 'pending',
    startedAt: now,
    leaseExpiresAt: new Date(now.getTime() + LEASE_MS)
  }).onConflictDoNothing({
    target: catalogImportOperations.previewId,
    where: sql`${catalogImportOperations.status} IN ('pending', 'succeeded')`
  }).returning()

  const [operation] = created

  if (operation === undefined) {
    const active = await latestOperation(session.database, previewId, session.user.id)

    return active === null
      ? {
        status: 'blocked',
        issue: issue('conflict')
      }
      : operationResult(active)
  }

  let phase: 'poster' | 'catalog' = 'poster'

  try {
    const uploaded = uploadPoster && poster !== null && preview.posterBytes !== null
      ? await uploadPreparedPoster({
        hosted: options.hosted,
        namespace: options.namespace,
        selection: preview.selection,
        poster,
        bytes: preview.posterBytes
      })
      : null

    phase = 'catalog'

    const completed = await applyPending({
      session,
      preview,
      operation,
      posterPath: uploaded?.path ?? null,
      now: options.now?.() ?? new Date()
    })

    return operationResult(completed)
  } catch (error) {
    logApplyFailure(error, operation.id)

    const failure = classifyFailure(error, phase)

    const failed = await failPending({
      database: session.database,
      operation,
      failure,
      now: options.now?.() ?? new Date()
    })

    return operationResult(failed)
  }
}

async function expirePendingImportOperations(database: Database, now: Date): Promise<void> {
  await database.update(catalogImportOperations)
    .set({
      status: 'failed',
      leaseExpiresAt: null,
      finishedAt: now,
      failureCode: 'interrupted',
      failureMessage: FAILURES.interrupted,
      retryable: true
    })
    .where(
      and(
        eq(catalogImportOperations.status, 'pending'),
        lte(catalogImportOperations.leaseExpiresAt, now)
      )
    )
}

async function listImportOperations(session: ImportSession, limit = 50, now = new Date()): Promise<ImportOperation[]> {
  await requireImportPermission(session)
  await expirePendingImportOperations(session.database, now)

  return session.database.select()
    .from(catalogImportOperations)
    .orderBy(desc(catalogImportOperations.startedAt), desc(catalogImportOperations.id))
    .limit(Math.min(Math.max(limit, 1), 100))
}

export { applyImportPreview, expirePendingImportOperations, listImportOperations }
export type { ApplyImportOptions, ApplyImportResult }
