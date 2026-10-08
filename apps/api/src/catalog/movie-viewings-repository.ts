import type { Database } from '@tv/database'

import {
  catalogItems,
  catalogItemTitles,
  catalogViewings,
  catalogViewingContexts,
  catalogViewingCreations,
  catalogTimelineEvents
} from '@tv/database/schema'

import type {
  CatalogMovieViewingSummary,
  CatalogMovieViewingsResponse,
  CatalogViewing,
  CatalogViewingCreateInput,
  CatalogViewingMutationResponse,
  CatalogViewingUpdateInput
} from '@tv/shared/catalog-viewings'

import { and, eq, sql } from 'drizzle-orm'
import { CatalogHttpError } from './errors.ts'
import { decodeViewingCursor, encodeViewingCursor } from './viewing-history.ts'

type ViewingReader = Pick<Database, 'select' | 'execute'>

interface ViewingOwner {
  userId: string;
  catalogItemId: string;
}

interface ViewingTarget extends ViewingOwner {
  viewingId: string;
}

const PAGE_SIZE = 20

const viewingColumns = {
  id: catalogViewings.id,
  catalogItemId: catalogViewings.catalogItemId,
  status: sql<'completed'>`${catalogViewings.status}`,
  startedOn: catalogViewings.startedOn,
  completedOn: catalogViewings.completedOn,
  recordedAt: sql<string>`to_char(${catalogViewings.recordedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  revision: catalogViewings.revision
}

function viewingOwnerCondition(owner: ViewingOwner) {
  return and(eq(catalogViewings.userId, owner.userId), eq(catalogViewings.catalogItemId, owner.catalogItemId))
}

function contextOwnerCondition(owner: ViewingOwner) {
  return and(eq(catalogViewingContexts.userId, owner.userId), eq(catalogViewingContexts.catalogItemId, owner.catalogItemId))
}

async function requireMovie(database: ViewingReader, owner: ViewingOwner, lock = false): Promise<void> {
  const query = database.select({ type: catalogItems.type })
    .from(catalogItems)
    .innerJoin(catalogItemTitles, and(eq(catalogItemTitles.catalogItemId, catalogItems.id), eq(catalogItemTitles.isOriginal, true)))
    .where(
      eq(catalogItems.id, owner.catalogItemId)
    )
    .limit(1)

  const rows = lock
    ? await query.for('no key update', { of: [catalogItems, catalogItemTitles] })
    : await query

  if (rows[0] === undefined) {
    throw new CatalogHttpError('NOT_FOUND', 404)
  }

  if (rows[0].type !== 'movie') {
    throw new CatalogHttpError('INVALID_REQUEST', 400, { fields: { id: 'Only movies support these viewing actions.' } })
  }
}

async function readMovieViewingSummary(database: ViewingReader, owner: ViewingOwner): Promise<CatalogMovieViewingSummary> {
  const result = await database.execute<CatalogMovieViewingSummary & Record<string, unknown>>(sql`
    SELECT (SELECT count(*)::integer FROM catalog_viewings WHERE user_id = ${owner.userId}::uuid AND catalog_item_id = ${owner.catalogItemId}::uuid) AS "completedCount",
      context.current_viewing_id AS "currentViewingId", coalesce(context.context_version, 0) AS "contextVersion"
    FROM (SELECT 1) anchor
    LEFT JOIN catalog_viewing_contexts context ON context.user_id = ${owner.userId}::uuid AND context.catalog_item_id = ${owner.catalogItemId}::uuid
  `)

  const [summary] = result.rows

  if (summary === undefined) {
    throw new Error('Movie viewing summary is missing')
  }

  return summary
}

async function findMovieViewing(database: ViewingReader, owner: ViewingOwner, viewingId: string): Promise<CatalogViewing> {
  await requireMovie(database, owner)

  const condition = viewingOwnerCondition(owner)

  const rows = await database.select(viewingColumns).from(catalogViewings)
    .where(
      and(condition, eq(catalogViewings.id, viewingId))
    )
    .limit(1)

  const [viewing] = rows

  if (viewing === undefined) {
    throw new CatalogHttpError('NOT_FOUND', 404)
  }

  return viewing
}

async function findMovieViewings(database: Database, owner: ViewingOwner, cursorValue: string | null): Promise<CatalogMovieViewingsResponse> {
  await requireMovie(database, owner)

  const cursor = decodeViewingCursor(cursorValue)

  if (cursor !== null && cursor.kind !== 'movie') {
    throw new CatalogHttpError('INVALID_REQUEST', 400, { fields: { cursor: 'Use a movie viewing cursor.' } })
  }

  const position = cursor === null ? sql`true` : sql`(recorded_at, id) < (${cursor.markedAt}::timestamptz, ${cursor.entryId}::uuid)`

  // Read the count, current context and bounded page in one PostgreSQL snapshot.
  const result = await database.execute<{ items: CatalogViewing[]; summary: CatalogMovieViewingSummary } & Record<string, unknown>>(sql`
    SELECT coalesce((SELECT json_agg(page) FROM (
      SELECT id, catalog_item_id AS "catalogItemId", status, started_on::text AS "startedOn", completed_on::text AS "completedOn",
        to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "recordedAt", revision
      FROM catalog_viewings WHERE user_id = ${owner.userId}::uuid AND catalog_item_id = ${owner.catalogItemId}::uuid AND ${position}
      ORDER BY recorded_at DESC NULLS LAST, id DESC NULLS LAST LIMIT ${PAGE_SIZE + 1}
    ) page), '[]'::json) AS items,
    json_build_object('completedCount', (SELECT count(*)::integer FROM catalog_viewings WHERE user_id = ${owner.userId}::uuid AND catalog_item_id = ${owner.catalogItemId}::uuid),
      'currentViewingId', context.current_viewing_id, 'contextVersion', coalesce(context.context_version, 0)) AS summary
    FROM (SELECT 1) anchor
    LEFT JOIN catalog_viewing_contexts context ON context.user_id = ${owner.userId}::uuid AND context.catalog_item_id = ${owner.catalogItemId}::uuid
  `)

  const [page] = result.rows

  if (page === undefined) {
    throw new Error('Movie viewing page is missing')
  }

  const items = page.items.slice(0, PAGE_SIZE)
  const last = items.at(-1)

  const nextCursor = page.items.length > PAGE_SIZE && last !== undefined
    ? encodeViewingCursor({
      entryId: last.id,
      kind: 'movie',
      markedAt: last.recordedAt
    })
    : null

  return {
    items,
    summary: page.summary,
    nextCursor
  }
}

async function lockViewingContext(transaction: Parameters<Parameters<Database['transaction']>[0]>[0], owner: ViewingOwner) {
  await requireMovie(transaction, owner, true)
  await transaction.insert(catalogViewingContexts).values(owner).onConflictDoNothing()

  const condition = contextOwnerCondition(owner)
  const rows = await transaction.select().from(catalogViewingContexts).where(condition).for('update')
  const [context] = rows

  if (context === undefined) {
    throw new Error('Movie viewing context is missing')
  }

  return context
}

async function createMovieViewing(database: Database, owner: ViewingOwner, input: CatalogViewingCreateInput): Promise<CatalogViewingMutationResponse> {
  return database.transaction(async transaction => {
    const context = await lockViewingContext(transaction, owner)
    const encodedInput = JSON.stringify(input)

    const creations = await transaction.select({
      viewingId: catalogViewingCreations.viewingId,
      catalogItemId: catalogViewingCreations.catalogItemId,
      matches: sql<boolean>`${catalogViewingCreations.input} = ${encodedInput}::jsonb`
    }).from(catalogViewingCreations)
      .where(
        and(eq(catalogViewingCreations.userId, owner.userId), eq(catalogViewingCreations.requestId, input.requestId))
      )
      .limit(1)

    const [creation] = creations

    if (creation !== undefined) {
      if (!creation.matches || creation.catalogItemId !== owner.catalogItemId || creation.viewingId === null) {
        throw new CatalogHttpError('CONFLICT', 409)
      }

      const viewing = await findMovieViewing(transaction, owner, creation.viewingId)
      const summary = await readMovieViewingSummary(transaction, owner)

      return {
        viewing,
        summary
      }
    }

    if (input.mode === 'current' && input.contextVersion !== context.contextVersion) {
      throw new CatalogHttpError('CONFLICT', 409)
    }

    const rows = await transaction.insert(catalogViewings).values({
      userId: owner.userId,
      catalogItemId: owner.catalogItemId,
      startedOn: input.startedOn,
      completedOn: input.completedOn
    }).returning({ id: catalogViewings.id })

    const id = rows[0]?.id

    if (id === undefined) {
      throw new Error('Created movie viewing is missing')
    }

    await transaction.insert(catalogTimelineEvents).values({
      userId: owner.userId,
      catalogItemId: owner.catalogItemId,
      kind: 'movie_viewing',
      viewingId: id,
      occurredAt: sql`(SELECT recorded_at FROM catalog_viewings WHERE id = ${id}::uuid)`
    })

    const keys = await transaction.insert(catalogViewingCreations).values({
      userId: owner.userId,
      requestId: input.requestId,
      catalogItemId: owner.catalogItemId,
      input,
      viewingId: id
    }).onConflictDoNothing().returning({ requestId: catalogViewingCreations.requestId })

    if (keys.length === 0) {
      // A reused key on another title must roll back this transaction's new viewing.
      throw new CatalogHttpError('CONFLICT', 409)
    }

    if (input.mode === 'current') {
      const condition = contextOwnerCondition(owner)

      await transaction.update(catalogViewingContexts).set({
        currentViewingId: id,
        contextVersion: context.contextVersion + 1
      }).where(condition)
    }

    const viewing = await findMovieViewing(transaction, owner, id)
    const summary = await readMovieViewingSummary(transaction, owner)

    return {
      viewing,
      summary
    }
  })
}

async function updateMovieViewing(database: Database, owner: ViewingTarget, input: CatalogViewingUpdateInput): Promise<CatalogViewingMutationResponse> {
  return database.transaction(async transaction => {
    await lockViewingContext(transaction, owner)

    const condition = viewingOwnerCondition(owner)
    const target = and(condition, eq(catalogViewings.id, owner.viewingId))
    const rows = await transaction.select(viewingColumns).from(catalogViewings).where(target).for('update')
    const [viewing] = rows

    if (viewing === undefined) {
      throw new CatalogHttpError('NOT_FOUND', 404)
    }

    const hasSameDates = viewing.startedOn === input.startedOn && viewing.completedOn === input.completedOn

    if (!hasSameDates && input.revision !== viewing.revision) {
      throw new CatalogHttpError('CONFLICT', 409)
    }

    if (!hasSameDates) {
      await transaction.update(catalogViewings).set({
        startedOn: input.startedOn,
        completedOn: input.completedOn,
        revision: viewing.revision + 1
      }).where(target)
    }

    const updated = await findMovieViewing(transaction, owner, owner.viewingId)
    const summary = await readMovieViewingSummary(transaction, owner)

    return {
      viewing: updated,
      summary
    }
  })
}

async function deleteMovieViewing(database: Database, owner: ViewingTarget, revision: number): Promise<CatalogMovieViewingSummary> {
  return database.transaction(async transaction => {
    const context = await lockViewingContext(transaction, owner)
    const condition = viewingOwnerCondition(owner)
    const target = and(condition, eq(catalogViewings.id, owner.viewingId))
    const rows = await transaction.select({ revision: catalogViewings.revision }).from(catalogViewings).where(target).for('update')
    const [viewing] = rows

    if (viewing !== undefined) {
      if (revision !== viewing.revision) {
        throw new CatalogHttpError('CONFLICT', 409)
      }

      if (context.currentViewingId === owner.viewingId) {
        const contextCondition = contextOwnerCondition(owner)

        await transaction.update(catalogViewingContexts).set({
          currentViewingId: null,
          contextVersion: context.contextVersion + 1
        }).where(contextCondition)
      }

      await transaction.delete(catalogViewings).where(target)
    }

    return readMovieViewingSummary(transaction, owner)
  })
}

export { createMovieViewing, deleteMovieViewing, findMovieViewing, findMovieViewings, updateMovieViewing }
