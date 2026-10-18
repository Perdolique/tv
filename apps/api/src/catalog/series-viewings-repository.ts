/* oxlint-disable eslint/max-lines -- Series marks, milestones and retries commit in one transaction. */
import type { Database } from '@tv/database'

import {
  catalogEpisodes,
  catalogItemRatings,
  catalogTimelineEvents,
  catalogTimelineEventWatches,
  catalogViewingContexts,
  catalogViewingEpisodeWatches,
  catalogViewingRequests,
  catalogViewings
} from '@tv/database/schema'

import type {
  CatalogSeriesBulkWatchInput,
  CatalogSeriesCancelRewatchInput,
  CatalogSeriesEpisodeWatch,
  CatalogSeriesUnwatchInput,
  CatalogSeriesWatchInput,
  CatalogSeriesWatchesResponse
} from '@tv/shared/catalog-series'

import type { CatalogViewingSummary } from '@tv/shared/catalog-viewings'
import { and, eq, sql } from 'drizzle-orm'
import { CatalogHttpError } from './errors.ts'

import {
  assertCurrentContext,
  bumpContextVersion,
  bumpViewingRevision,
  captureActionTime,
  createViewingInTransaction,
  findViewing,
  lockViewingContext,
  readViewingSummary,
  recordViewingRequest,
  replayViewingRequest,
  requireCatalogItem,
  type CatalogTransaction,
  type ViewingContext,
  type ViewingOwner,
  type ViewingReader
} from './viewings-repository.ts'

interface SeriesEpisode {
  id: string;
  seasonNumber: number;
  airDate: string | null;
}
interface SeriesWatchInsertion {
  viewingId: string;
  episodeIds: string[];
  actionAt: string;
}
interface SeriesMilestone {
  response: CatalogSeriesWatchesResponse;
  episodes: SeriesEpisode[];
  kind: 'season_completed' | 'available_completed';
  seasonNumber: number | null;
  newEpisodeIds: Set<string>;
  actionAt: string;
}
interface SeriesWatchDependency {
  eventId: string;
  watchId: string;
}
interface SeriesMilestoneCalculation {
  response: CatalogSeriesWatchesResponse;
  episodes: SeriesEpisode[];
  newEpisodeIds: string[];
  today: string;
  actionAt: string;
}
interface SeriesViewingStart {
  context: ViewingContext;
  input: CatalogSeriesWatchInput;
  actionAt: string;
}
interface EpisodeWatchInput {
  viewingId: string;
  episodeId: string;
  timeZone: string;
  actionAt?: string;
}

async function requireSeries(reader: ViewingReader, owner: ViewingOwner): Promise<void> {
  const item = await requireCatalogItem(reader, owner)

  if (item.type !== 'series') { throw new CatalogHttpError('INVALID_REQUEST', 400, { fields: { id: 'Only series support episode viewing actions.' } }) }
}

async function readSeriesWatches(reader: ViewingReader, owner: ViewingOwner, selectedViewingId?: string): Promise<CatalogSeriesWatchesResponse> {
  const summary = await readViewingSummary(reader, owner)
  const selected = selectedViewingId ?? summary.currentViewingId
  const viewing = selected === null ? null : await findViewing(reader, owner, selected)

  const rows = selected === null ? [] : await reader.select({
    id: catalogViewingEpisodeWatches.id,
    catalogEpisodeId: catalogViewingEpisodeWatches.catalogEpisodeId,
    viewingId: catalogViewingEpisodeWatches.viewingId,
    markedAt: sql<string>`to_char(${catalogViewingEpisodeWatches.markedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
  }).from(catalogViewingEpisodeWatches)
    .innerJoin(catalogEpisodes, eq(catalogEpisodes.id, catalogViewingEpisodeWatches.catalogEpisodeId))
    .where(
      and(eq(catalogViewingEpisodeWatches.userId, owner.userId), eq(catalogViewingEpisodeWatches.catalogItemId, owner.catalogItemId), eq(catalogViewingEpisodeWatches.viewingId, selected))
    )
    .orderBy(catalogEpisodes.seasonNumber, catalogEpisodes.episodeNumber, catalogViewingEpisodeWatches.id)

  return {
    viewing,
    watches: rows,
    summary
  }
}

async function findSeriesWatches(database: Database, owner: ViewingOwner, viewingId?: string): Promise<CatalogSeriesWatchesResponse> {
  return database.transaction(async transaction => {
    await transaction.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`)
    await requireSeries(transaction, owner)

    return readSeriesWatches(transaction, owner, viewingId)
  })
}

async function findEpisodeOwner(reader: ViewingReader, userId: string, episodeId: string): Promise<ViewingOwner> {
  const rows = await reader
    .select({ catalogItemId: catalogEpisodes.catalogItemId })
    .from(catalogEpisodes)
    .where(
      eq(catalogEpisodes.id, episodeId)
    )
    .limit(1)

  const [episode] = rows

  if (episode === undefined) { throw new CatalogHttpError('NOT_FOUND', 404) }

  return {
    userId,
    catalogItemId: episode.catalogItemId
  }
}

async function lockSeriesEpisodes(transaction: CatalogTransaction, owner: ViewingOwner): Promise<SeriesEpisode[]> {
  return transaction.select({
    id: catalogEpisodes.id,
    seasonNumber: catalogEpisodes.seasonNumber,
    airDate: catalogEpisodes.airDate
  })
    .from(catalogEpisodes)
    .where(
      eq(catalogEpisodes.catalogItemId, owner.catalogItemId)
    )
    .orderBy(catalogEpisodes.id)
    .for('share')
}

async function serverToday(transaction: CatalogTransaction, timeZone: string, actionAt: string): Promise<string> {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone })
  const canonicalTimeZone = formatter.resolvedOptions().timeZone
  const result = await transaction.execute<{ today: string } & Record<string, unknown>>(sql`SELECT (${actionAt}::timestamptz AT TIME ZONE ${canonicalTimeZone})::date::text AS today`)
  const today = result.rows[0]?.today

  if (today === undefined) { throw new Error('Server calendar date is missing') }

  return today
}
async function insertEpisodeWatches(transaction: CatalogTransaction, owner: ViewingOwner, insertion: SeriesWatchInsertion): Promise<string[]> {
  const { viewingId, episodeIds, actionAt } = insertion

  const values = episodeIds.map(catalogEpisodeId => {
    const watch = {
      userId: owner.userId,
      catalogItemId: owner.catalogItemId,
      viewingId,
      catalogEpisodeId,
      markedAt: sql`${actionAt}::timestamptz`
    }

    return watch
  })

  if (values.length === 0) {
    return []
  }

  const rows = await transaction.insert(catalogViewingEpisodeWatches).values(values).onConflictDoNothing({ target: [catalogViewingEpisodeWatches.viewingId, catalogViewingEpisodeWatches.catalogEpisodeId] })
    .returning({
      id: catalogViewingEpisodeWatches.id,
      catalogEpisodeId: catalogViewingEpisodeWatches.catalogEpisodeId
    })

  if (rows.length === 0) {
    return []
  }

  const events = rows.map(watch => {
    const event = {
      userId: owner.userId,
      catalogItemId: owner.catalogItemId,
      kind: 'episode_watched',
      viewingId,
      watchId: watch.id,
      catalogEpisodeId: watch.catalogEpisodeId,
      occurredAt: sql`${actionAt}::timestamptz`
    }

    return event
  })

  await transaction.insert(catalogTimelineEvents).values(events)

  const createdEpisodeIds = rows.map(watch => watch.catalogEpisodeId)

  return createdEpisodeIds
}

async function recordMilestone(transaction: CatalogTransaction, owner: ViewingOwner, milestone: SeriesMilestone): Promise<void> {
  const { response, episodes, kind, seasonNumber, newEpisodeIds, actionAt } = milestone
  const viewingId = response.viewing?.id

  if (viewingId === undefined || episodes.length === 0) {
    return
  }

  const hasNewRequiredEpisode = episodes.some(episode => newEpisodeIds.has(episode.id))

  if (!hasNewRequiredEpisode) { return }

  const watchEntries = response.watches.map(watch => [watch.catalogEpisodeId, watch.id] as const)
  const watches = new Map(watchEntries)
  const episodeIds = episodes.map(episode => episode.id)
  const hasMissingWatch = episodeIds.some(id => !watches.has(id))

  if (hasMissingWatch) {
    return
  }

  const snapshotJson = JSON.stringify(episodeIds)

  const previous = await transaction.select({ id: catalogTimelineEvents.id })
    .from(catalogTimelineEvents)
    .where(
    and(eq(catalogTimelineEvents.viewingId, viewingId), eq(catalogTimelineEvents.kind, kind), sql`${catalogTimelineEvents.seasonNumber} IS NOT DISTINCT FROM ${seasonNumber}::integer`, sql`${catalogTimelineEvents.episodeIds} = ${snapshotJson}::jsonb`)
    )
    .limit(1)

  if (previous.length > 0) {
    return
  }

  const inserted = await transaction.insert(catalogTimelineEvents).values({
    userId: owner.userId,
    catalogItemId: owner.catalogItemId,
    kind,
    viewingId,
    seasonNumber,
    episodeIds,
    occurredAt: sql`${actionAt}::timestamptz`
  }).returning({ id: catalogTimelineEvents.id })

  const eventId = inserted[0]?.id

  if (eventId === undefined) {
    throw new Error('Created milestone event is missing')
  }

  const dependencies: SeriesWatchDependency[] = []

  for (const id of episodeIds) {
    const watchId = watches.get(id)

    if (watchId === undefined) { throw new Error('Milestone watch is missing') }

    dependencies.push({
      eventId,
      watchId
    })
  }

  await transaction.insert(catalogTimelineEventWatches).values(dependencies)
}

async function recordSeriesMilestones(transaction: CatalogTransaction, owner: ViewingOwner, calculation: SeriesMilestoneCalculation): Promise<void> {
  const { response, episodes, today, actionAt } = calculation
  const newEpisodeIds = new Set(calculation.newEpisodeIds)
  const seasons = new Map<number, SeriesEpisode[]>()

  for (const episode of episodes) {
    const season = seasons.get(episode.seasonNumber) ?? []

    season.push(episode)
    seasons.set(episode.seasonNumber, season)
  }

  for (const [seasonNumber, season] of seasons) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- One PostgreSQL transaction records milestones in deterministic order.
    await recordMilestone(transaction, owner, {
      response,
      episodes: season,
      kind: 'season_completed',
      seasonNumber,
      newEpisodeIds,
      actionAt
    })
  }

  const available = episodes.filter(episode => episode.airDate !== null && episode.airDate <= today)

  await recordMilestone(transaction, owner, {
    response,
    episodes: available,
    kind: 'available_completed',
    seasonNumber: null,
    newEpisodeIds,
    actionAt
  })
}


// Ratings call this within their transaction, after acquiring the shared viewing context lock.
async function ensureEpisodeWatch(transaction: CatalogTransaction, owner: ViewingOwner, input: EpisodeWatchInput): Promise<CatalogSeriesEpisodeWatch> {
  await requireSeries(transaction, owner)
  await findViewing(transaction, owner, input.viewingId)

  const episodes = await lockSeriesEpisodes(transaction, owner)
  const episode = episodes.find(value => value.id === input.episodeId)

  if (episode === undefined) { throw new CatalogHttpError('NOT_FOUND', 404) }

  const existing = await transaction.select({
    id: catalogViewingEpisodeWatches.id,
    catalogEpisodeId: catalogViewingEpisodeWatches.catalogEpisodeId,
    viewingId: catalogViewingEpisodeWatches.viewingId,
    markedAt: sql<string>`to_char(${catalogViewingEpisodeWatches.markedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
  })
    .from(catalogViewingEpisodeWatches)
    .where(
      and(eq(catalogViewingEpisodeWatches.viewingId, input.viewingId), eq(catalogViewingEpisodeWatches.catalogEpisodeId, input.episodeId))
    )
    .limit(1)

  const [previous] = existing

  if (previous !== undefined) { return previous }

  const actionAt = input.actionAt ?? await captureActionTime(transaction)
  const today = await serverToday(transaction, input.timeZone, actionAt)

  if (episode.airDate === null || episode.airDate > today) {
    throw new CatalogHttpError('INVALID_REQUEST', 400, { fields: { episodes: 'This episode has no released air date in your local day.' } })
  }

  const created = await insertEpisodeWatches(transaction, owner, {
    viewingId: input.viewingId,
    episodeIds: [input.episodeId],
    actionAt
  })

  const response = await readSeriesWatches(transaction, owner, input.viewingId)

  await recordSeriesMilestones(transaction, owner, {
    response,
    episodes,
    newEpisodeIds: created,
    today,
    actionAt
  })

  const watch = response.watches.find(value => value.catalogEpisodeId === input.episodeId)

  if (watch === undefined) { throw new Error('Created episode watch is missing') }

  return watch
}

async function ensureCurrentSeriesViewing(transaction: CatalogTransaction, owner: ViewingOwner, start: SeriesViewingStart): Promise<string> {
  const { context, input, actionAt } = start

  if (context.type !== 'series') { throw new CatalogHttpError('INVALID_REQUEST', 400) }

  if (context.currentViewingId !== null) { return context.currentViewingId }

  if (input.viewingDate === undefined) { throw new CatalogHttpError('INVALID_REQUEST', 400, { fields: { viewingDate: 'Choose the start date for this viewing.' } }) }

  return createViewingInTransaction(transaction, owner, {
    status: 'watching',
    startedOn: input.viewingDate,
    completedOn: null,
    kind: 'series_started',
    actionAt,
    makeCurrent: true,
    context
  })
}

// oxlint-disable-next-line eslint/max-params -- The mutation separates database, authenticated owner, target and validated input.
async function markSeriesEpisodeWatched(database: Database, userId: string, episodeId: string, input: CatalogSeriesWatchInput): Promise<CatalogSeriesWatchesResponse> {
  return database.transaction(async transaction => {
    const owner = await findEpisodeOwner(transaction, userId, episodeId)
    const context = await lockViewingContext(transaction, owner)

    const request = {
      action: `episode:watch:${episodeId}`,
      input
    }

    const replay = await replayViewingRequest(transaction, owner, request)

    if (replay !== null) { return readSeriesWatches(transaction, owner) }

    assertCurrentContext(context, input)

    const actionAt = await captureActionTime(transaction)

    const viewingId = await ensureCurrentSeriesViewing(transaction, owner, {
      context,
      input,
      actionAt
    })

    const previous = await transaction
      .select({ id: catalogViewingEpisodeWatches.id })
      .from(catalogViewingEpisodeWatches)
      .where(
        and(eq(catalogViewingEpisodeWatches.viewingId, viewingId), eq(catalogViewingEpisodeWatches.catalogEpisodeId, episodeId))
      )
      .limit(1)

    const watch = await ensureEpisodeWatch(transaction, owner, {
      viewingId,
      episodeId,
      timeZone: input.timeZone,
      actionAt
    })

    if (previous.length === 0 && context.currentViewingId !== null) {
      await bumpViewingRevision(transaction, owner, viewingId)
      await bumpContextVersion(transaction, owner)
    }

    await recordViewingRequest(transaction, owner, {
      action: request.action,
      input,
      viewingId,
      watchIds: [watch.id]
    })

    return readSeriesWatches(transaction, owner)
  })
}

// oxlint-disable-next-line eslint/max-params -- The mutation separates database, authenticated owner, target and validated input.
async function markSeriesEpisodesWatched(database: Database, owner: ViewingOwner, input: CatalogSeriesBulkWatchInput, seasonNumber: number | null): Promise<CatalogSeriesWatchesResponse> {
  return database.transaction(async transaction => {
    const context = await lockViewingContext(transaction, owner)

    const request = {
      action: seasonNumber === null ? 'episodes:watch:available' : `episodes:watch:season:${seasonNumber}`,
      input
    }

    const replay = await replayViewingRequest(transaction, owner, request)

    if (replay !== null) { return readSeriesWatches(transaction, owner) }

    assertCurrentContext(context, input)

    if (context.type !== 'series') { throw new CatalogHttpError('INVALID_REQUEST', 400) }

    const episodes = await lockSeriesEpisodes(transaction, owner)
    const actionAt = await captureActionTime(transaction)
    const today = await serverToday(transaction, input.timeZone, actionAt)
    const eligible = episodes.filter(episode => (seasonNumber === null || episode.seasonNumber === seasonNumber) && episode.airDate !== null && episode.airDate <= today)

    if (eligible.length === 0) { throw new CatalogHttpError('INVALID_REQUEST', 400, { fields: { episodes: 'There are no released episodes with a known air date to mark.' } }) }

    const viewingId = await ensureCurrentSeriesViewing(transaction, owner, {
      context,
      input,
      actionAt
    })

    const episodeIds = eligible.map(episode => episode.id)

    const created = await insertEpisodeWatches(transaction, owner, {
      viewingId,
      episodeIds,
      actionAt
    })

    const response = await readSeriesWatches(transaction, owner)

    await recordSeriesMilestones(transaction, owner, {
      response,
      episodes,
      newEpisodeIds: created,
      today,
      actionAt
    })

    if (created.length > 0 && context.currentViewingId !== null) {
      await bumpViewingRevision(transaction, owner, viewingId)
      await bumpContextVersion(transaction, owner)
    }

    const selected = new Set(episodeIds)
    const selectedWatches = response.watches.filter(watch => selected.has(watch.catalogEpisodeId))
    const watchIds = selectedWatches.map(watch => watch.id)

    await recordViewingRequest(transaction, owner, {
      action: request.action,
      input,
      viewingId,
      watchIds
    })

    return readSeriesWatches(transaction, owner)
  })
}

// oxlint-disable-next-line eslint/max-params -- The mutation separates database, authenticated owner, target and validated input.
async function unmarkSeriesEpisodeWatched(database: Database, userId: string, episodeId: string, input: CatalogSeriesUnwatchInput): Promise<CatalogSeriesWatchesResponse> {
  return database.transaction(async transaction => {
    const owner = await findEpisodeOwner(transaction, userId, episodeId)
    const context = await lockViewingContext(transaction, owner)

    const request = {
      action: `episode:unwatch:${episodeId}`,
      input
    }

    const replay = await replayViewingRequest(transaction, owner, request)

    if (replay !== null) { return readSeriesWatches(transaction, owner) }

    assertCurrentContext(context, input)

    const target = and(eq(catalogViewingEpisodeWatches.userId, userId), eq(catalogViewingEpisodeWatches.catalogItemId, owner.catalogItemId), eq(catalogViewingEpisodeWatches.viewingId, input.currentViewingId), eq(catalogViewingEpisodeWatches.catalogEpisodeId, episodeId), eq(catalogViewingEpisodeWatches.id, input.watchId))
    const marks = await transaction.select({ id: catalogViewingEpisodeWatches.id }).from(catalogViewingEpisodeWatches).where(target).for('update')

    const ratings = await transaction
      .select({ id: catalogItemRatings.id })
      .from(catalogItemRatings)
      .where(
        and(eq(catalogItemRatings.viewingId, input.currentViewingId), eq(catalogItemRatings.catalogEpisodeId, episodeId))
      )
      .for('update')

    if (marks.length > 0 && ratings.length > 0 && !input.confirmRatingRemoval) {
      throw new CatalogHttpError('CONFLICT', 409, { fields: { confirmRatingRemoval: 'Removing this mark also removes its episode rating. Confirm to continue.' } })
    }

    if (marks.length > 0) {
      await transaction.delete(catalogViewingEpisodeWatches).where(target)
      await bumpViewingRevision(transaction, owner, input.currentViewingId)
      await bumpContextVersion(transaction, owner)
    }

    await recordViewingRequest(transaction, owner, {
      action: request.action,
      input,
      viewingId: input.currentViewingId
    })

    return readSeriesWatches(transaction, owner)
  })
}

async function cancelSeriesRewatch(database: Database, owner: ViewingOwner, input: CatalogSeriesCancelRewatchInput): Promise<CatalogViewingSummary> {
  return database.transaction(async transaction => {
    const context = await lockViewingContext(transaction, owner)

    const request = {
      action: 'viewing:cancel-rewatch',
      input
    }

    const replay = await replayViewingRequest(transaction, owner, request)

    if (replay !== null) { return readViewingSummary(transaction, owner) }

    assertCurrentContext(context, input)

    const viewing = await findViewing(transaction, owner, input.currentViewingId)

    if (!viewing.canCancelRewatch || !viewing.isRewatch) { throw new CatalogHttpError('CONFLICT', 409, { fields: { currentViewingId: 'Only a new viewing without marks or ratings can be canceled.' } }) }

    const rows = await transaction.select({ result: catalogViewingRequests.result })
      .from(catalogViewingRequests)
      .where(
        and(eq(catalogViewingRequests.userId, owner.userId), eq(catalogViewingRequests.catalogItemId, owner.catalogItemId), eq(catalogViewingRequests.viewingId, input.currentViewingId), eq(catalogViewingRequests.action, 'viewing:create'), eq(catalogViewingRequests.tombstoned, false))
      )
      .limit(1)

    const creation = rows[0]?.result
    const previousId = creation?.previousViewingId

    if (creation === undefined || previousId === undefined) { throw new CatalogHttpError('CONFLICT', 409) }

    await transaction
      .select({ id: catalogViewings.id })
      .from(catalogViewings)
      .where(
        eq(catalogViewings.id, previousId)
      )
      .for('update')

    const previous = await findViewing(transaction, owner, previousId)

    if (creation.completionEventId !== undefined && creation.completionEventId !== null) {
      const closing = await transaction
        .select({ id: catalogTimelineEvents.id })
        .from(catalogTimelineEvents)
        .where(
          and(eq(catalogTimelineEvents.id, creation.completionEventId), eq(catalogTimelineEvents.viewingId, previousId), eq(catalogTimelineEvents.kind, 'series_completed'))
        )
        .limit(1)

      if (previous.status !== 'completed' || previous.completedOn !== creation.completedByStartOn || closing.length === 0) {
        throw new CatalogHttpError('CONFLICT', 409, { fields: { currentViewingId: 'The previous viewing was corrected after this rewatch started.' } })
      }
    }

    await recordViewingRequest(transaction, owner, {
      action: request.action,
      input,
      viewingId: previousId
    })

    const contextTarget = and(eq(catalogViewingContexts.userId, owner.userId), eq(catalogViewingContexts.catalogItemId, owner.catalogItemId))

    await transaction.update(catalogViewingContexts).set({
      currentViewingId: previousId,
      contextVersion: context.contextVersion + 1
    }).where(contextTarget)

    await transaction
      .delete(catalogViewings)
      .where(
        eq(catalogViewings.id, input.currentViewingId)
      )

    if (creation.completionEventId !== undefined && creation.completionEventId !== null) {
      await transaction
        .delete(catalogTimelineEvents)
        .where(
          and(eq(catalogTimelineEvents.id, creation.completionEventId), eq(catalogTimelineEvents.viewingId, previousId))
        )

      await transaction
        .update(catalogViewings)
        .set({
          status: creation.previousStatus ?? previous.status,
          completedOn: creation.previousCompletedOn ?? null,
          revision: previous.revision + 1
        })
        .where(
          eq(catalogViewings.id, previousId)
        )
    }

    return readViewingSummary(transaction, owner)
  })
}

export { cancelSeriesRewatch, ensureEpisodeWatch, findEpisodeOwner, findSeriesWatches, lockSeriesEpisodes, markSeriesEpisodeWatched, markSeriesEpisodesWatched, readSeriesWatches, unmarkSeriesEpisodeWatched }
