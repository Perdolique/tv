import { Buffer } from 'node:buffer'
import type { Database } from '@tv/database'
import type { ImportHistoryResponse, ImportOperationView } from '@tv/shared/catalog-import'
import { catalogImportOperations, catalogImportPreviews, users } from '@tv/database/schema'
import { and, desc, eq, getColumns, gt, lt, notExists, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import * as v from 'valibot'

// oxlint-disable-next-line import/no-relative-parent-imports -- History uses the shared catalog HTTP error contract.
import { CatalogHttpError } from '../errors.ts'
import { expirePendingImportOperations } from './apply-service.ts'
import { FAILURES, isFailureCode } from './apply-failures.ts'
import { requireImportPermission, type ImportSession } from './service.ts'

const PAGE_SIZE = 20
const operationColumns = getColumns(catalogImportOperations)
const cursorIdSchema = v.pipe(v.string(), v.uuid())

interface HistoryCursor {
  startedAt: Date;
  id: string;
}

function parseHistoryCursor(value: string | null): HistoryCursor | null {
  if (value === null) {
    return null
  }

  if (!/^[A-Za-z0-9_-]{1,160}$/u.test(value)) {
    throw new CatalogHttpError('INVALID_REQUEST', 400)
  }

  const decoded = Buffer.from(value, 'base64url').toString('utf8')
  const pieces = decoded.split('|')
  const [timestamp, id] = pieces
  const startedAt = timestamp === undefined ? new Date(Number.NaN) : new Date(timestamp)
  const canonical = Buffer.from(decoded).toString('base64url')

  if (pieces.length !== 2 || timestamp === undefined || id === undefined
    || !v.is(cursorIdSchema, id) || !Number.isFinite(startedAt.getTime())
    || startedAt.toISOString() !== timestamp || canonical !== value) {
    throw new CatalogHttpError('INVALID_REQUEST', 400)
  }

  return {
    startedAt,
    id
  }
}

function createHistoryCursor(operation: typeof catalogImportOperations.$inferSelect): string {
  const payload = `${operation.startedAt.toISOString()}|${operation.id}`

  return Buffer.from(payload).toString('base64url')
}

interface OperationViewInput {
  operation: typeof catalogImportOperations.$inferSelect;
  actorEmail: string | null;
  previewStatus: 'ready' | 'blocked' | null;
  previewExpiresAt: Date | null;
  isLatest: boolean;
}

function createImportOperationView(row: OperationViewInput, viewerId: string, now: Date): ImportOperationView {
  const { operation } = row
  const {failureCode} = operation
  const code = failureCode !== null && isFailureCode(failureCode) ? failureCode : 'apply_failed'

  const issue = operation.status === 'failed'
    ? {
      code,
      message: FAILURES[code]
    }
    : null

  const canRetry = operation.status === 'failed'
    && operation.retryable
    && row.isLatest
    && operation.operatorId === viewerId
    && row.previewStatus === 'ready'
    && row.previewExpiresAt !== null
    && row.previewExpiresAt > now

  return {
    id: operation.id,
    previewId: operation.previewId,
    operatorId: operation.operatorId,
    actor: row.actorEmail ?? operation.operatorId,
    selection: operation.selection,
    title: operation.title,
    status: operation.status,
    startedAt: operation.startedAt.toISOString(),
    finishedAt: operation.finishedAt?.toISOString() ?? null,
    result: operation.result,
    issue,
    canRetry
  }
}

function operationRows(database: Database) {
  const newerOperation = alias(catalogImportOperations, 'newer_operation')

  const newerAttempts = database.select({ id: newerOperation.id })
    .from(newerOperation)
    .where(
      and(
        eq(newerOperation.previewId, catalogImportOperations.previewId),
        eq(newerOperation.operatorId, catalogImportOperations.operatorId),
        or(
          gt(newerOperation.startedAt, catalogImportOperations.startedAt),
          and(
            eq(newerOperation.startedAt, catalogImportOperations.startedAt),
            gt(newerOperation.id, catalogImportOperations.id)
          )
        )
      )
    )

  return database.select({
    ...operationColumns,
    actorEmail: users.email,
    previewStatus: catalogImportPreviews.status,
    previewExpiresAt: catalogImportPreviews.expiresAt,
    isLatest: notExists(newerAttempts).mapWith(Boolean)
  }).from(catalogImportOperations)
    .leftJoin(users, eq(users.id, catalogImportOperations.operatorId))
    .leftJoin(catalogImportPreviews, eq(catalogImportPreviews.id, catalogImportOperations.previewId))
}

function toViewInput(row: Awaited<ReturnType<ReturnType<typeof operationRows>['limit']>>[number]): OperationViewInput {
  const { actorEmail, previewStatus, previewExpiresAt, isLatest, ...operation } = row

  return {
    operation,
    actorEmail,
    previewStatus,
    previewExpiresAt,
    isLatest
  }
}

async function listImportOperationPage(session: ImportSession, cursorValue: string | null, now = new Date()): Promise<ImportHistoryResponse> {
  await requireImportPermission(session)

  const cursor = parseHistoryCursor(cursorValue)

  await expirePendingImportOperations(session.database, now)

  const cursorCondition = cursor === null ? undefined : or(
    lt(catalogImportOperations.startedAt, cursor.startedAt),
    and(
      eq(catalogImportOperations.startedAt, cursor.startedAt),
      lt(catalogImportOperations.id, cursor.id)
    )
  )

  const rows = await operationRows(session.database)
    .where(cursorCondition)
    .orderBy(desc(catalogImportOperations.startedAt), desc(catalogImportOperations.id))
    .limit(PAGE_SIZE + 1)

  const visible = rows.slice(0, PAGE_SIZE)

  const items = visible.map(row => {
    const viewInput = toViewInput(row)

    return createImportOperationView(viewInput, session.user.id, now)
  })

  const last = visible.at(-1)
  const nextCursor = rows.length > PAGE_SIZE && last !== undefined ? createHistoryCursor(last) : null

  return {
    items,
    nextCursor
  }
}

async function findImportOperationView(session: ImportSession, id: string, now = new Date()): Promise<ImportOperationView | null> {
  await requireImportPermission(session)

  if (!v.is(cursorIdSchema, id)) {
    throw new CatalogHttpError('INVALID_REQUEST', 400)
  }

  await expirePendingImportOperations(session.database, now)

  const rows = await operationRows(session.database)
    .where(
      eq(catalogImportOperations.id, id)
    )
    .limit(1)

  const [row] = rows

  if (row === undefined) {
    return null
  }

  const viewInput = toViewInput(row)

  return createImportOperationView(viewInput, session.user.id, now)
}

export { findImportOperationView, listImportOperationPage }
