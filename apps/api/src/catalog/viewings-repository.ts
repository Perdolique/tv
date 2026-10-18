/* oxlint-disable eslint/max-lines -- Viewing mutations share one lock, replay and transaction boundary. */
import type { Database } from '@tv/database'

import {
  catalogItems,
  catalogItemTitles,
  catalogTimelineEvents,
  catalogViewingContexts,
  catalogViewingRequests,
  catalogViewings
} from '@tv/database/schema'

import {
  viewingDateSchema,
  type CatalogViewing,
  type CatalogViewingCreateInput,
  type CatalogViewingDeleteInput,
  type CatalogViewingDraft,
  type CatalogViewingMutationResponse,
  type CatalogViewingSummary,
  type CatalogViewingsResponse,
  type CatalogViewingUpdateInput
} from '@tv/shared/catalog-viewings'

import { and, eq, sql } from 'drizzle-orm'
import * as v from 'valibot'

// oxlint-disable-next-line import/no-relative-parent-imports -- Catalog cursors share the canonical Base64URL codec.
import { decodeBase64Url, encodeBase64Url } from '../auth/base64url.ts'
import { CatalogHttpError } from './errors.ts'

type CatalogTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type ViewingReader = Pick<Database, 'select' | 'execute'>

interface ViewingOwner {
  userId: string;
  catalogItemId: string;
}
interface ViewingTarget extends ViewingOwner {
  viewingId: string;
}
interface ViewingContext {
  currentViewingId: string | null;
  contextVersion: number;
  type: 'movie' | 'series';
}
interface ViewingRequestInput {
  requestId: string;
}
interface ViewingRequest {
  action: string;
  input: ViewingRequestInput;
  allowEmptyViewing?: boolean;
}

type ViewingRequestResult = (typeof catalogViewingRequests.$inferSelect)['result']

interface ViewingRequestRecord extends ViewingRequest {
  viewingId: string | null;
  watchIds?: string[];
  result?: ViewingRequestResult;
}
interface ViewingCreation extends CatalogViewingDraft {
  kind: 'movie_viewing' | 'series_started' | 'rewatch_started';
  actionAt?: string;
  makeCurrent: boolean;
  context: ViewingContext;
}

const PAGE_SIZE = 20

const viewingColumns = {
  id: catalogViewings.id,
  catalogItemId: catalogViewings.catalogItemId,
  status: sql<'watching' | 'completed'>`${catalogViewings.status}`,
  startedOn: catalogViewings.startedOn,
  completedOn: catalogViewings.completedOn,
  recordedAt: sql<string>`to_char(${catalogViewings.recordedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  revision: catalogViewings.revision,
  score: sql<number | null>`(SELECT score FROM catalog_item_ratings ratings WHERE ratings.viewing_id = catalog_viewings.id AND ratings.user_id = catalog_viewings.user_id AND ratings.catalog_item_id = catalog_viewings.catalog_item_id AND ratings.season_number IS NULL AND ratings.catalog_episode_id IS NULL)`,
  isRewatch: sql<boolean>`EXISTS (SELECT 1 FROM catalog_timeline_events events WHERE events.viewing_id = catalog_viewings.id AND events.kind = 'rewatch_started')`,

  canCancelRewatch: sql<boolean>`EXISTS (SELECT 1 FROM catalog_viewing_requests requests JOIN catalog_viewing_contexts contexts ON contexts.user_id = requests.user_id AND contexts.catalog_item_id = requests.catalog_item_id AND contexts.current_viewing_id = requests.viewing_id WHERE requests.viewing_id = catalog_viewings.id AND requests.action = 'viewing:create' AND requests.result ? 'previousViewingId' AND NOT requests.tombstoned
    AND EXISTS (SELECT 1 FROM catalog_viewings previous WHERE previous.id = (requests.result ->> 'previousViewingId')::uuid AND previous.user_id = requests.user_id AND previous.catalog_item_id = requests.catalog_item_id))
    AND NOT EXISTS (SELECT 1 FROM catalog_viewing_episode_watches watches WHERE watches.viewing_id = catalog_viewings.id)
    AND NOT EXISTS (SELECT 1 FROM catalog_item_ratings ratings WHERE ratings.viewing_id = catalog_viewings.id)`
}

function ownerCondition(owner: ViewingOwner) {
  return and(eq(catalogViewings.userId, owner.userId), eq(catalogViewings.catalogItemId, owner.catalogItemId))
}

function contextCondition(owner: ViewingOwner) {
  return and(eq(catalogViewingContexts.userId, owner.userId), eq(catalogViewingContexts.catalogItemId, owner.catalogItemId))
}

async function requireCatalogItem(reader: ViewingReader, owner: ViewingOwner, lock = false) {
  const query = reader
    .select({ type: catalogItems.type })
    .from(catalogItems)
    .innerJoin(catalogItemTitles, and(eq(catalogItemTitles.catalogItemId, catalogItems.id), eq(catalogItemTitles.isOriginal, true)))
    .where(
      eq(catalogItems.id, owner.catalogItemId)
    )
    .limit(1)

  const rows = lock ? await query.for('no key update', { of: [catalogItems, catalogItemTitles] }) : await query
  const [item] = rows

  if (item === undefined) { throw new CatalogHttpError('NOT_FOUND', 404) }

  return item
}

// All personal title mutations acquire catalog, context and viewing locks in this order.
async function lockViewingContext(transaction: CatalogTransaction, owner: ViewingOwner): Promise<ViewingContext> {
  const item = await requireCatalogItem(transaction, owner, true)

  await transaction.insert(catalogViewingContexts).values(owner).onConflictDoNothing()

  const condition = contextCondition(owner)
  const rows = await transaction.select().from(catalogViewingContexts).where(condition).for('update')
  const [context] = rows

  if (context === undefined) { throw new Error('Viewing context is missing') }

  if (context.currentViewingId !== null) {
    await transaction
      .select({ id: catalogViewings.id })
      .from(catalogViewings)
      .where(
        eq(catalogViewings.id, context.currentViewingId)
      )
      .for('update')
  }

  return {
    currentViewingId: context.currentViewingId,
    contextVersion: context.contextVersion,
    type: item.type
  }
}

function assertCurrentContext(context: ViewingContext, input: Pick<ViewingContext, 'currentViewingId' | 'contextVersion'>): void {
  if (context.currentViewingId !== input.currentViewingId || context.contextVersion !== input.contextVersion) {
    throw new CatalogHttpError('CONFLICT', 409)
  }
}

function summarySql(owner: ViewingOwner) {
  return sql`json_build_object(
    'completedCount', (SELECT count(*)::integer FROM catalog_viewings WHERE user_id = ${owner.userId}::uuid AND catalog_item_id = ${owner.catalogItemId}::uuid AND status = 'completed'),
    'currentViewingId', context.current_viewing_id, 'contextVersion', coalesce(context.context_version, 0),
    'currentViewingScore', (SELECT score FROM catalog_item_ratings WHERE user_id = ${owner.userId}::uuid AND catalog_item_id = ${owner.catalogItemId}::uuid AND viewing_id = context.current_viewing_id AND season_number IS NULL AND catalog_episode_id IS NULL),
    'currentVoteScore', (SELECT score FROM catalog_rating_votes WHERE user_id = ${owner.userId}::uuid AND catalog_item_id = ${owner.catalogItemId}::uuid AND season_number IS NULL AND catalog_episode_id IS NULL))`
}

async function readViewingSummary(reader: ViewingReader, owner: ViewingOwner): Promise<CatalogViewingSummary> {
  const summary = summarySql(owner)

  const result = await reader.execute<{ summary: CatalogViewingSummary } & Record<string, unknown>>(sql`
    SELECT ${summary} AS summary FROM (SELECT 1) anchor LEFT JOIN catalog_viewing_contexts context
      ON context.user_id = ${owner.userId}::uuid AND context.catalog_item_id = ${owner.catalogItemId}::uuid`)

  const value = result.rows[0]?.summary

  if (value === undefined) { throw new Error('Viewing summary is missing') }

  return value
}

async function findViewing(reader: ViewingReader, owner: ViewingOwner, viewingId: string): Promise<CatalogViewing> {
  await requireCatalogItem(reader, owner)

  const condition = ownerCondition(owner)

  const rows = await reader
    .select(viewingColumns)
    .from(catalogViewings)
    .where(
      and(condition, eq(catalogViewings.id, viewingId))
    )
    .limit(1)

  const [viewing] = rows

  if (viewing === undefined) { throw new CatalogHttpError('NOT_FOUND', 404) }

  return viewing
}

const cursorSchema = v.strictObject({
  version: v.literal(1),
  userId: v.pipe(v.string(), v.uuid()),
  catalogItemId: v.pipe(v.string(), v.uuid()),
  date: viewingDateSchema,
  id: v.pipe(v.string(), v.uuid())
})

function decodeCursor(value: string | null, owner: ViewingOwner) {
  if (value === null) { return null }

  try {
    if (value.length > 1024) { throw new Error('Viewing cursor is too long') }

    const bytes = decodeBase64Url(value)

    const decoder = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: false
    })

    const text = decoder.decode(bytes)
    const payload: unknown = JSON.parse(text)
    const cursor = v.parse(cursorSchema, payload)

    if (cursor.userId !== owner.userId || cursor.catalogItemId !== owner.catalogItemId) {
      throw new Error('Viewing cursor scope does not match')
    }

    const canonicalValue = encodeBase64Url(bytes)

    if (canonicalValue !== value) {
      throw new Error('Viewing cursor scope does not match')
    }

    return cursor
  } catch (error) {
    throw new CatalogHttpError('INVALID_REQUEST', 400, {
      cause: error,
      fields: { cursor: 'Use a valid viewing cursor.' }
    })
  }
}

async function findViewings(database: Database, owner: ViewingOwner, cursorValue: string | null): Promise<CatalogViewingsResponse> {
  await requireCatalogItem(database, owner)

  const cursor = decodeCursor(cursorValue, owner)
  const position = cursor === null ? sql`true` : sql`(coalesce(completed_on, started_on), id) < (${cursor.date}::date, ${cursor.id}::uuid)`
  const summary = summarySql(owner)

  const result = await database.execute<{ items: CatalogViewing[]; summary: CatalogViewingSummary } & Record<string, unknown>>(sql`
    SELECT coalesce((SELECT json_agg(page) FROM (
      SELECT id, catalog_item_id AS "catalogItemId", status, started_on::text AS "startedOn", completed_on::text AS "completedOn",
        to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "recordedAt", revision,
        (SELECT score FROM catalog_item_ratings ratings WHERE ratings.viewing_id = viewings.id AND ratings.season_number IS NULL AND ratings.catalog_episode_id IS NULL) AS score,
        EXISTS (SELECT 1 FROM catalog_timeline_events WHERE viewing_id = viewings.id AND kind = 'rewatch_started') AS "isRewatch",
        EXISTS (SELECT 1 FROM catalog_viewing_requests requests WHERE requests.viewing_id = viewings.id AND requests.action = 'viewing:create'
          AND requests.result ? 'previousViewingId' AND NOT requests.tombstoned AND context.current_viewing_id = viewings.id
          AND EXISTS (SELECT 1 FROM catalog_viewings previous WHERE previous.id = (requests.result ->> 'previousViewingId')::uuid AND previous.user_id = requests.user_id AND previous.catalog_item_id = requests.catalog_item_id))
          AND NOT EXISTS (SELECT 1 FROM catalog_viewing_episode_watches WHERE viewing_id = viewings.id)
          AND NOT EXISTS (SELECT 1 FROM catalog_item_ratings WHERE viewing_id = viewings.id) AS "canCancelRewatch"
      FROM catalog_viewings viewings WHERE user_id = ${owner.userId}::uuid AND catalog_item_id = ${owner.catalogItemId}::uuid AND ${position}
      ORDER BY coalesce(completed_on, started_on) DESC, id DESC LIMIT ${PAGE_SIZE + 1}) page), '[]'::json) AS items,
      ${summary} AS summary FROM (SELECT 1) anchor LEFT JOIN catalog_viewing_contexts context
      ON context.user_id = ${owner.userId}::uuid AND context.catalog_item_id = ${owner.catalogItemId}::uuid`)

  const [page] = result.rows

  if (page === undefined) { throw new Error('Viewing page is missing') }

  const items = page.items.slice(0, PAGE_SIZE)
  const last = items.at(-1)
  let nextCursor: string | null = null

  if (page.items.length > PAGE_SIZE && last !== undefined) {
    const payload = JSON.stringify({
      version: 1,
      userId: owner.userId,
      catalogItemId: owner.catalogItemId,
      date: last.completedOn ?? last.startedOn,
      id: last.id
    })

    const encoder = new TextEncoder()
    const bytes = encoder.encode(payload)

    nextCursor = encodeBase64Url(bytes)
  }

  return {
    items,
    summary: page.summary,
    nextCursor
  }
}

interface ViewingRequestReplay {
  viewingId: string | null;
  watchIds: string[];
  result: ViewingRequestResult;
}

interface NonEmptyViewingReplay extends ViewingRequestReplay {
  viewingId: string;
}

function replayViewingRequest(transaction: CatalogTransaction, owner: ViewingOwner, request: ViewingRequest & { allowEmptyViewing: true }): Promise<ViewingRequestReplay | null>
function replayViewingRequest(transaction: CatalogTransaction, owner: ViewingOwner, request: ViewingRequest): Promise<NonEmptyViewingReplay | null>
async function replayViewingRequest(transaction: CatalogTransaction, owner: ViewingOwner, request: ViewingRequest): Promise<ViewingRequestReplay | null> {
  const encodedInput = JSON.stringify(request.input)

  const rows = await transaction.select({
    catalogItemId: catalogViewingRequests.catalogItemId,
    action: catalogViewingRequests.action,
    matches: sql<boolean>`${catalogViewingRequests.input} = ${encodedInput}::jsonb`,
    tombstoned: catalogViewingRequests.tombstoned,
    viewingId: catalogViewingRequests.viewingId,
    watchIds: catalogViewingRequests.watchIds,
    result: catalogViewingRequests.result
  })
    .from(catalogViewingRequests)
    .where(
      and(eq(catalogViewingRequests.userId, owner.userId), eq(catalogViewingRequests.requestId, request.input.requestId))
    )
    .limit(1)

  const [previous] = rows

  if (previous === undefined) { return null }

  if (previous.catalogItemId !== owner.catalogItemId || previous.action !== request.action || !previous.matches || previous.tombstoned || (previous.viewingId === null && request.allowEmptyViewing !== true)) {
    throw new CatalogHttpError('CONFLICT', 409)
  }

  return {
    viewingId: previous.viewingId,
    watchIds: previous.watchIds,
    result: previous.result
  }
}

async function recordViewingRequest(transaction: CatalogTransaction, owner: ViewingOwner, record: ViewingRequestRecord): Promise<void> {
  const keys = await transaction.insert(catalogViewingRequests).values({
    userId: owner.userId,
    requestId: record.input.requestId,
    catalogItemId: owner.catalogItemId,
    action: record.action,
    input: record.input,
    result: record.result ?? {},
    viewingId: record.viewingId,
    watchIds: record.watchIds ?? []
  }).onConflictDoNothing().returning({ id: catalogViewingRequests.requestId })

  if (keys.length === 0) { throw new CatalogHttpError('CONFLICT', 409) }
}

async function captureActionTime(transaction: CatalogTransaction): Promise<string> {
  const result = await transaction.execute<{ actionAt: string } & Record<string, unknown>>(sql`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "actionAt"`)
  const actionAt = result.rows[0]?.actionAt

  if (actionAt === undefined) { throw new Error('Viewing action time is missing') }

  return actionAt
}

async function bumpContextVersion(transaction: CatalogTransaction, owner: ViewingOwner): Promise<void> {
  const condition = contextCondition(owner)

  await transaction.update(catalogViewingContexts).set({ contextVersion: sql`${catalogViewingContexts.contextVersion} + 1` }).where(condition)
}

async function bumpViewingRevision(transaction: CatalogTransaction, owner: ViewingOwner, viewingId: string): Promise<void> {
  const condition = ownerCondition(owner)

  await transaction
    .update(catalogViewings)
    .set({ revision: sql`${catalogViewings.revision} + 1` })
    .where(
      and(condition, eq(catalogViewings.id, viewingId))
    )
}

function requireViewingDates(type: 'movie' | 'series', draft: CatalogViewingDraft): void {
  const invalidMovie = type === 'movie' && (draft.status !== 'completed' || draft.completedOn === null)
  const invalidSeries = type === 'series' && (draft.startedOn === null || (draft.status === 'watching' ? draft.completedOn !== null : draft.completedOn === null))
  const reversedDates = draft.startedOn !== null && draft.completedOn !== null && draft.startedOn > draft.completedOn

  if (invalidMovie || invalidSeries || reversedDates) {
    throw new CatalogHttpError('INVALID_REQUEST', 400, { fields: { completedOn: 'Choose the required dates for this viewing.' } })
  }
}

// Called inside the mutation's transaction; ratings and marks are added by that owner.
async function createViewingInTransaction(transaction: CatalogTransaction, owner: ViewingOwner, input: ViewingCreation): Promise<string> {
  requireViewingDates(input.context.type, input)

  const actionAt = input.actionAt ?? await captureActionTime(transaction)

  const rows = await transaction.insert(catalogViewings).values({
    userId: owner.userId,
    catalogItemId: owner.catalogItemId,
    status: input.status,
    startedOn: input.startedOn,
    completedOn: input.completedOn,
    recordedAt: sql`${actionAt}::timestamptz`
  }).returning({ id: catalogViewings.id })

  const id = rows[0]?.id

  if (id === undefined) { throw new Error('Created viewing is missing') }

  await transaction.insert(catalogTimelineEvents).values({
    userId: owner.userId,
    catalogItemId: owner.catalogItemId,
    kind: input.kind,
    viewingId: id,
    occurredAt: sql`${actionAt}::timestamptz`
  })

  if (input.context.type === 'series' && input.status === 'completed') {
    await transaction.insert(catalogTimelineEvents).values({
      userId: owner.userId,
      catalogItemId: owner.catalogItemId,
      kind: 'series_completed',
      viewingId: id,
      occurredAt: sql`${actionAt}::timestamptz`
    })
  }

  if (input.makeCurrent) {
    const condition = contextCondition(owner)

    await transaction.update(catalogViewingContexts).set({
      currentViewingId: id,
      contextVersion: sql`${catalogViewingContexts.contextVersion} + 1`
    }).where(condition)
  }

  return id
}

async function mutationResponse(transaction: CatalogTransaction, owner: ViewingOwner, viewingId: string): Promise<CatalogViewingMutationResponse> {
  const viewing = await findViewing(transaction, owner, viewingId)
  const summary = await readViewingSummary(transaction, owner)

  return {
    viewing,
    summary
  }
}

async function requireSeriesRewatchActivity(transaction: CatalogTransaction, previous: CatalogViewing): Promise<void> {
  const allowsEmptyInitialViewing = previous.status === 'completed' && !previous.isRewatch

  if (allowsEmptyInitialViewing) { return }

  const activity = await transaction.execute<{ active: boolean } & Record<string, unknown>>(sql`SELECT EXISTS (SELECT 1 FROM catalog_viewing_episode_watches WHERE viewing_id = ${previous.id}::uuid) OR EXISTS (SELECT 1 FROM catalog_item_ratings WHERE viewing_id = ${previous.id}::uuid) AS active`)

  if (activity.rows[0]?.active !== true) {
    throw new CatalogHttpError('CONFLICT', 409, { fields: { currentViewingId: 'Add an episode mark or rating before starting another viewing.' } })
  }
}

async function createViewing(database: Database, owner: ViewingOwner, input: CatalogViewingCreateInput): Promise<CatalogViewingMutationResponse> {
  return database.transaction(async transaction => {
    const context = await lockViewingContext(transaction, owner)

    const request = {
      action: 'viewing:create',
      input
    }

    const replay = await replayViewingRequest(transaction, owner, request)

    if (replay !== null) { return mutationResponse(transaction, owner, replay.viewingId) }

    if (input.mode === 'current') { assertCurrentContext(context, input) }

    requireViewingDates(context.type, input)

    if (input.mode === 'history' && input.status === 'watching') {
      throw new CatalogHttpError('INVALID_REQUEST', 400, { fields: { status: 'Historical viewings must be completed.' } })
    }

    const actionAt = await captureActionTime(transaction)
    const result: ViewingRequestResult = {}
    const previous = input.mode === 'current' && context.currentViewingId !== null ? await findViewing(transaction, owner, context.currentViewingId) : null

    if (previous !== null && context.type === 'series') {
      await requireSeriesRewatchActivity(transaction, previous)

      result.previousViewingId = previous.id
      result.previousStatus = previous.status
      result.previousCompletedOn = previous.completedOn

      if (previous.status === 'watching') {
        if (input.completeCurrentOn === undefined || previous.startedOn === null || input.completeCurrentOn < previous.startedOn) {
          throw new CatalogHttpError('INVALID_REQUEST', 400, { fields: { completeCurrentOn: 'Choose the completion date for the current viewing.' } })
        }

        await transaction
          .update(catalogViewings)
          .set({
            status: 'completed',
            completedOn: input.completeCurrentOn,
            revision: previous.revision + 1
          })
          .where(
            eq(catalogViewings.id, previous.id)
          )

        const events = await transaction.insert(catalogTimelineEvents).values({
          userId: owner.userId,
          catalogItemId: owner.catalogItemId,
          viewingId: previous.id,
          kind: 'series_completed',
          occurredAt: sql`${actionAt}::timestamptz`
        }).returning({ id: catalogTimelineEvents.id })

        result.completionEventId = events[0]?.id ?? null
        result.completedByStartOn = input.completeCurrentOn
      }
    }

    let kind: ViewingCreation['kind'] = 'movie_viewing'

    if (context.type === 'series') { kind = previous === null ? 'series_started' : 'rewatch_started' }

    const id = await createViewingInTransaction(transaction, owner, {
      status: input.status,
      startedOn: input.startedOn,
      completedOn: input.completedOn,
      kind,
      actionAt,
      makeCurrent: input.mode === 'current',
      context
    })

    await recordViewingRequest(transaction, owner, {
      action: request.action,
      input,
      viewingId: id,
      result
    })

    return mutationResponse(transaction, owner, id)
  })
}

async function updateViewing(database: Database, owner: ViewingTarget, input: CatalogViewingUpdateInput): Promise<CatalogViewingMutationResponse> {
  return database.transaction(async transaction => {
    const context = await lockViewingContext(transaction, owner)

    const request = {
      action: `viewing:update:${owner.viewingId}`,
      input
    }

    const replay = await replayViewingRequest(transaction, owner, request)

    if (replay !== null) { return mutationResponse(transaction, owner, replay.viewingId) }

    const condition = ownerCondition(owner)

    await transaction
      .select({ id: catalogViewings.id })
      .from(catalogViewings)
      .where(
        and(condition, eq(catalogViewings.id, owner.viewingId))
      )
      .for('update')

    const viewing = await findViewing(transaction, owner, owner.viewingId)

    if (input.revision !== viewing.revision) { throw new CatalogHttpError('CONFLICT', 409) }

    requireViewingDates(context.type, input)

    const reopening = viewing.status === 'completed' && input.status === 'watching'

    if (reopening) {
      const active = await transaction
        .select({ id: catalogViewings.id })
        .from(catalogViewings)
        .where(
          and(condition, eq(catalogViewings.status, 'watching'))
        )
        .for('update')

      if (active.length > 0) { throw new CatalogHttpError('CONFLICT', 409, { fields: { status: 'Complete the other active viewing before reopening this one.' } }) }

      const ownerContext = contextCondition(owner)

      await transaction.update(catalogViewingContexts).set({ currentViewingId: owner.viewingId }).where(ownerContext)

      await transaction
        .delete(catalogTimelineEvents)
        .where(
          and(eq(catalogTimelineEvents.viewingId, owner.viewingId), eq(catalogTimelineEvents.kind, 'series_completed'))
        )
    }

    const changed = viewing.status !== input.status || viewing.startedOn !== input.startedOn || viewing.completedOn !== input.completedOn

    if (changed) {
      await transaction
        .update(catalogViewings)
        .set({
          status: input.status,
          startedOn: input.startedOn,
          completedOn: input.completedOn,
          revision: viewing.revision + 1
        })
        .where(
          eq(catalogViewings.id, owner.viewingId)
        )

      if (context.type === 'series' && viewing.status === 'watching' && input.status === 'completed') {
        await transaction.insert(catalogTimelineEvents).values({
          userId: owner.userId,
          catalogItemId: owner.catalogItemId,
          viewingId: owner.viewingId,
          kind: 'series_completed'
        })
      }

      await bumpContextVersion(transaction, owner)
    }

    await recordViewingRequest(transaction, owner, {
      action: request.action,
      input,
      viewingId: owner.viewingId
    })

    return mutationResponse(transaction, owner, owner.viewingId)
  })
}

async function deleteViewing(database: Database, owner: ViewingTarget, input: CatalogViewingDeleteInput): Promise<CatalogViewingSummary> {
  return database.transaction(async transaction => {
    const context = await lockViewingContext(transaction, owner)

    const request = {
      action: `viewing:delete:${owner.viewingId}`,
      input
    }

    await replayViewingRequest(transaction, owner, request)

    const condition = ownerCondition(owner)
    const target = and(condition, eq(catalogViewings.id, owner.viewingId))
    const rows = await transaction.select({ revision: catalogViewings.revision }).from(catalogViewings).where(target).for('update')
    const [viewing] = rows

    if (viewing === undefined) { return readViewingSummary(transaction, owner) }

    if (viewing.revision !== input.revision) { throw new CatalogHttpError('CONFLICT', 409) }

    await recordViewingRequest(transaction, owner, {
      action: request.action,
      input,
      viewingId: owner.viewingId
    })

    if (context.currentViewingId === owner.viewingId) {
      const ownerContext = contextCondition(owner)

      await transaction.update(catalogViewingContexts).set({
        currentViewingId: null,
        contextVersion: context.contextVersion + 1
      }).where(ownerContext)
    } else {
      await bumpContextVersion(transaction, owner)
    }

    await transaction.delete(catalogViewings).where(target)

    return readViewingSummary(transaction, owner)
  })
}

export { assertCurrentContext, bumpContextVersion, bumpViewingRevision, captureActionTime, createViewing, createViewingInTransaction, deleteViewing, findViewing, findViewings, lockViewingContext, readViewingSummary, recordViewingRequest, replayViewingRequest, requireCatalogItem, updateViewing }
export type { CatalogTransaction, ViewingContext, ViewingOwner, ViewingReader, ViewingRequestResult, ViewingTarget }
