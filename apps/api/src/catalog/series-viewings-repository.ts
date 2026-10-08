/* oxlint-disable eslint/max-lines -- Series transactions keep context, marks, milestones and retry keys in one atomic boundary. */
import type { Database } from '@tv/database'

import {
  catalogEpisodes,
  catalogItems,
  catalogItemTitles,
  catalogSeriesRequests,
  catalogTimelineEvents,
  catalogTimelineEventWatches,
  catalogViewingContexts,
  catalogViewingEpisodeWatches,
  catalogViewings
} from '@tv/database/schema'

import type {
  CatalogSeriesBulkWatchInput,
  CatalogSeriesCancelRewatchInput,
  CatalogSeriesViewing,
  CatalogSeriesRewatchInput,
  CatalogSeriesUnwatchInput,
  CatalogSeriesWatchInput,
  CatalogSeriesWatchesResponse
} from '@tv/shared/catalog-series'

import { and, eq, sql } from 'drizzle-orm'
import { CatalogHttpError } from './errors.ts'

type SeriesReader = Pick<Database, 'select' | 'execute'>
type SeriesTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]

interface SeriesOwner {
  userId: string;
  catalogItemId: string;
}

interface LockedSeriesContext {
  currentViewingId: string | null;
  contextVersion: number;
}

interface SeriesEpisode {
  id: string;
  seasonNumber: number;
  airDate: string | null;
}

interface SeriesRequest {
  action: string;
  input: CatalogSeriesWatchInput;
}

interface SeriesRequestResult {
  request: SeriesRequest;
  result: CatalogSeriesWatchesResponse;
  watchIds: string[];
  previousStatus?: CatalogSeriesViewing['status'];
}

interface SeriesViewingCreation {
  context: LockedSeriesContext;
  kind: 'series_started' | 'rewatch_started';
  actionAt: string;
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
  actionAt: string;
}

interface SeriesWatchDependency {
  eventId: string;
  watchId: string;
}

interface SeriesMilestoneCalculation {
  response: CatalogSeriesWatchesResponse;
  episodes: SeriesEpisode[];
  today: string;
  actionAt: string;
}

function ownerCondition(owner: SeriesOwner) {
  return and(eq(catalogViewingContexts.userId, owner.userId), eq(catalogViewingContexts.catalogItemId, owner.catalogItemId))
}

async function requireSeries(database: SeriesReader, owner: SeriesOwner, lock = false): Promise<void> {
  const query = database.select({ type: catalogItems.type }).from(catalogItems)
    .innerJoin(catalogItemTitles, and(eq(catalogItemTitles.catalogItemId, catalogItems.id), eq(catalogItemTitles.isOriginal, true)))
    .where(
      eq(catalogItems.id, owner.catalogItemId)
    )
    .limit(1)

  const rows = lock ? await query.for('no key update', { of: [catalogItems, catalogItemTitles] }) : await query
  const [item] = rows

  if (item === undefined) {
    throw new CatalogHttpError('NOT_FOUND', 404)
  }

  if (item.type !== 'series') {
    throw new CatalogHttpError('INVALID_REQUEST', 400, { fields: { id: 'Only series support episode viewing actions.' } })
  }
}

async function readSeriesWatches(database: SeriesReader, owner: SeriesOwner): Promise<CatalogSeriesWatchesResponse> {
  const result = await database.execute<CatalogSeriesWatchesResponse & Record<string, unknown>>(sql`
    SELECT coalesce(context.context_version, 0) AS "contextVersion",
      CASE WHEN viewing.id IS NULL THEN NULL ELSE json_build_object('id', viewing.id, 'catalogItemId', viewing.catalog_item_id,
        'status', viewing.status, 'isRewatch', EXISTS (SELECT 1 FROM catalog_timeline_events WHERE viewing_id = viewing.id AND kind = 'rewatch_started'), 'recordedAt', to_char(viewing.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'revision', viewing.revision) END AS "currentViewing",
      coalesce((SELECT json_agg(watches.catalog_episode_id ORDER BY episodes.season_number, episodes.episode_number, watches.id)
        FROM catalog_viewing_episode_watches watches JOIN catalog_episodes episodes ON episodes.id = watches.catalog_episode_id
        WHERE watches.user_id = ${owner.userId}::uuid AND watches.catalog_item_id = ${owner.catalogItemId}::uuid AND watches.viewing_id = context.current_viewing_id), '[]'::json) AS "watchedEpisodeIds",
      coalesce((SELECT json_agg(json_build_object('id', watches.id, 'catalogEpisodeId', watches.catalog_episode_id, 'viewingId', watches.viewing_id,
        'markedAt', to_char(watches.marked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY episodes.season_number, episodes.episode_number, watches.id)
        FROM catalog_viewing_episode_watches watches JOIN catalog_episodes episodes ON episodes.id = watches.catalog_episode_id
        WHERE watches.user_id = ${owner.userId}::uuid AND watches.catalog_item_id = ${owner.catalogItemId}::uuid AND watches.viewing_id = context.current_viewing_id), '[]'::json) AS watches
    FROM (SELECT 1) anchor LEFT JOIN catalog_viewing_contexts context
      ON context.user_id = ${owner.userId}::uuid AND context.catalog_item_id = ${owner.catalogItemId}::uuid
    LEFT JOIN catalog_viewings viewing ON viewing.id = context.current_viewing_id
  `)

  const [response] = result.rows

  if (response === undefined) {
    throw new Error('Series watch context is missing')
  }

  return response
}

async function findSeriesWatches(database: Database, owner: SeriesOwner): Promise<CatalogSeriesWatchesResponse> {
  await requireSeries(database, owner)

  return readSeriesWatches(database, owner)
}

async function lockSeriesContext(transaction: SeriesTransaction, owner: SeriesOwner): Promise<LockedSeriesContext> {
  await requireSeries(transaction, owner, true)
  await transaction.insert(catalogViewingContexts).values(owner).onConflictDoNothing()

  const condition = ownerCondition(owner)

  const rows = await transaction.select({
    currentViewingId: catalogViewingContexts.currentViewingId,
    contextVersion: catalogViewingContexts.contextVersion
  })
    .from(catalogViewingContexts)
    .where(condition)
    .for('update')

  const [context] = rows

  if (context === undefined) {
    throw new Error('Series viewing context is missing')
  }

  if (context.currentViewingId !== null) {
    await transaction.select({ id: catalogViewings.id })
      .from(catalogViewings)
      .where(
        eq(catalogViewings.id, context.currentViewingId)
      )
      .for('update')
  }

  return context
}

function assertCurrentContext(context: LockedSeriesContext, input: Pick<CatalogSeriesWatchInput, 'currentViewingId' | 'contextVersion'>): void {
  if (context.currentViewingId !== input.currentViewingId || context.contextVersion !== input.contextVersion) {
    throw new CatalogHttpError('CONFLICT', 409)
  }
}

async function replaySeriesRequest(transaction: SeriesTransaction, owner: SeriesOwner, request: SeriesRequest): Promise<CatalogSeriesWatchesResponse | null> {
  const inputJson = JSON.stringify(request.input)

  const rows = await transaction.select({
    catalogItemId: catalogSeriesRequests.catalogItemId,
    action: catalogSeriesRequests.action,
    matches: sql<boolean>`${catalogSeriesRequests.input} = ${inputJson}::jsonb`,
    tombstoned: catalogSeriesRequests.tombstoned,
    viewingId: catalogSeriesRequests.viewingId
  })
    .from(catalogSeriesRequests)
    .where(
    and(eq(catalogSeriesRequests.userId, owner.userId), eq(catalogSeriesRequests.requestId, request.input.requestId))
    )
    .limit(1)

  const [previous] = rows

  if (previous === undefined) {
    return null
  }

  if (previous.catalogItemId !== owner.catalogItemId || previous.action !== request.action || !previous.matches || previous.tombstoned || previous.viewingId === null) {
    throw new CatalogHttpError('CONFLICT', 409)
  }

  return readSeriesWatches(transaction, owner)
}

async function recordSeriesRequest(transaction: SeriesTransaction, owner: SeriesOwner, record: SeriesRequestResult): Promise<void> {
  const { request, result, watchIds, previousStatus } = record

  const storedResult = previousStatus === undefined ? result : {
    watchedEpisodeIds: result.watchedEpisodeIds,
    watches: result.watches,
    currentViewing: result.currentViewing,
    contextVersion: result.contextVersion,
    previousStatus
  }

  const rows = await transaction.insert(catalogSeriesRequests).values({
    userId: owner.userId,
    requestId: request.input.requestId,
    catalogItemId: owner.catalogItemId,
    action: request.action,
    input: request.input,
    result: storedResult,
    viewingId: result.currentViewing?.id ?? null,
    watchIds
  }).onConflictDoNothing().returning({ requestId: catalogSeriesRequests.requestId })

  if (rows.length === 0) {
    throw new CatalogHttpError('CONFLICT', 409)
  }
}

async function createSeriesViewing(transaction: SeriesTransaction, owner: SeriesOwner, creation: SeriesViewingCreation): Promise<string> {
  const { context, kind, actionAt } = creation

  const rows = await transaction.insert(catalogViewings).values({
    userId: owner.userId,
    catalogItemId: owner.catalogItemId,
    status: 'watching',
    recordedAt: sql`${actionAt}::timestamptz`
  }).returning({ id: catalogViewings.id })

  const id = rows[0]?.id

  if (id === undefined) {
    throw new Error('Created series viewing is missing')
  }

  const condition = ownerCondition(owner)

  await transaction.update(catalogViewingContexts).set({
    currentViewingId: id,
    contextVersion: context.contextVersion + 1
  }).where(condition)

  await transaction.insert(catalogTimelineEvents).values({
    userId: owner.userId,
    catalogItemId: owner.catalogItemId,
    kind,
    viewingId: id,
    occurredAt: sql`${actionAt}::timestamptz`
  })

  return id
}

async function findEpisodeOwner(database: SeriesReader, userId: string, catalogEpisodeId: string): Promise<SeriesOwner> {
  const rows = await database.select({ catalogItemId: catalogEpisodes.catalogItemId })
    .from(catalogEpisodes)
    .where(
      eq(catalogEpisodes.id, catalogEpisodeId)
    )
    .limit(1)

  const [episode] = rows

  if (episode === undefined) {
    throw new CatalogHttpError('NOT_FOUND', 404)
  }

  return {
    userId,
    catalogItemId: episode.catalogItemId
  }
}

async function lockSeriesEpisodes(transaction: SeriesTransaction, owner: SeriesOwner): Promise<SeriesEpisode[]> {
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

async function captureSeriesActionTime(transaction: SeriesTransaction): Promise<string> {
  const result = await transaction.execute<{ actionAt: string } & Record<string, unknown>>(sql`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "actionAt"`)
  const actionAt = result.rows[0]?.actionAt

  if (actionAt === undefined) {
    throw new Error('Series action time is missing')
  }

  return actionAt
}

async function serverToday(transaction: SeriesTransaction, timeZone: string, actionAt: string): Promise<string> {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone })
  const timeZoneOptions = formatter.resolvedOptions()
  const canonicalTimeZone = timeZoneOptions.timeZone
  const result = await transaction.execute<{ today: string } & Record<string, unknown>>(sql`SELECT (${actionAt}::timestamptz AT TIME ZONE ${canonicalTimeZone})::date::text AS today`)
  const today = result.rows[0]?.today

  if (today === undefined) {
    throw new Error('Server calendar date is missing')
  }

  return today
}

async function insertEpisodeWatches(transaction: SeriesTransaction, owner: SeriesOwner, insertion: SeriesWatchInsertion): Promise<boolean> {
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
    return false
  }

  const rows = await transaction.insert(catalogViewingEpisodeWatches).values(values).onConflictDoNothing({ target: [catalogViewingEpisodeWatches.viewingId, catalogViewingEpisodeWatches.catalogEpisodeId] })
    .returning({
      id: catalogViewingEpisodeWatches.id,
      catalogEpisodeId: catalogViewingEpisodeWatches.catalogEpisodeId
    })

  if (rows.length === 0) {
    return false
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

  return true
}

async function recordMilestone(transaction: SeriesTransaction, owner: SeriesOwner, milestone: SeriesMilestone): Promise<void> {
  const { response, episodes, kind, seasonNumber, actionAt } = milestone
  const viewingId = response.currentViewing?.id

  if (viewingId === undefined || episodes.length === 0) {
    return
  }

  const watchEntries = response.watches.map(watch => [watch.catalogEpisodeId, watch.id] as const)
  const watches = new Map(watchEntries)
  const episodeIds = episodes.map(episode => episode.id)

  if (episodeIds.some(id => !watches.has(id))) {
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

async function recordSeriesMilestones(transaction: SeriesTransaction, owner: SeriesOwner, calculation: SeriesMilestoneCalculation): Promise<void> {
  const { response, episodes, today, actionAt } = calculation
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
      actionAt
    })
  }

  const available = episodes.filter(episode => episode.airDate !== null && episode.airDate <= today)

  await recordMilestone(transaction, owner, {
    response,
    episodes: available,
    kind: 'available_completed',
    seasonNumber: null,
    actionAt
  })
}

// oxlint-disable-next-line eslint/max-params -- The public mutation keeps the account, target and validated request separate.
async function markSeriesEpisodeWatched(database: Database, userId: string, catalogEpisodeId: string, input: CatalogSeriesWatchInput): Promise<CatalogSeriesWatchesResponse> {
  return database.transaction(async transaction => {
    const owner = await findEpisodeOwner(transaction, userId, catalogEpisodeId)
    const context = await lockSeriesContext(transaction, owner)
    const action = `episode:${catalogEpisodeId}`

    const request = {
      action,
      input
    }

    const replay = await replaySeriesRequest(transaction, owner, request)

    if (replay !== null) {
      return replay
    }

    assertCurrentContext(context, input)

    const episodes = await lockSeriesEpisodes(transaction, owner)

    if (!episodes.some(episode => episode.id === catalogEpisodeId)) {
      throw new CatalogHttpError('NOT_FOUND', 404)
    }

    const actionAt = await captureSeriesActionTime(transaction)

    const viewingId = context.currentViewingId ?? await createSeriesViewing(transaction, owner, {
      context,
      kind: 'series_started',
      actionAt
    })

    const created = await insertEpisodeWatches(transaction, owner, {
      viewingId,
      episodeIds: [catalogEpisodeId],
      actionAt
    })

    const response = await readSeriesWatches(transaction, owner)
    const today = await serverToday(transaction, input.timeZone, actionAt)

    if (created) {
      await recordSeriesMilestones(transaction, owner, {
        response,
        episodes,
        today,
        actionAt
      })
    }

    const episodeWatches = response.watches.filter(watch => watch.catalogEpisodeId === catalogEpisodeId)
    const watchIds = episodeWatches.map(watch => watch.id)

    await recordSeriesRequest(transaction, owner, {
      request,
      result: response,
      watchIds
    })

    return response
  })
}

// oxlint-disable-next-line eslint/max-params -- The public mutation keeps the account, target and validated request separate.
async function markSeriesEpisodesWatched(database: Database, owner: SeriesOwner, input: CatalogSeriesBulkWatchInput, seasonNumber: number | null): Promise<CatalogSeriesWatchesResponse> {
  return database.transaction(async transaction => {
    const context = await lockSeriesContext(transaction, owner)
    const action = seasonNumber === null ? 'all-available' : `season:${seasonNumber}`

    const request = {
      action,
      input
    }

    const replay = await replaySeriesRequest(transaction, owner, request)

    if (replay !== null) {
      return replay
    }

    assertCurrentContext(context, input)

    const episodes = await lockSeriesEpisodes(transaction, owner)
    const actionAt = await captureSeriesActionTime(transaction)
    const today = await serverToday(transaction, input.timeZone, actionAt)
    const eligible = episodes.filter(episode => (seasonNumber === null || episode.seasonNumber === seasonNumber) && episode.airDate !== null && episode.airDate <= today)

    if (eligible.length === 0) {
      throw new CatalogHttpError('INVALID_REQUEST', 400, { fields: { episodes: 'There are no released episodes with a known air date to mark.' } })
    }

    const viewingId = context.currentViewingId ?? await createSeriesViewing(transaction, owner, {
      context,
      kind: 'series_started',
      actionAt
    })

    const episodeIds = eligible.map(episode => episode.id)

    const created = await insertEpisodeWatches(transaction, owner, {
      viewingId,
      episodeIds,
      actionAt
    })

    const response = await readSeriesWatches(transaction, owner)

    if (created) {
      await recordSeriesMilestones(transaction, owner, {
        response,
        episodes,
        today,
        actionAt
      })
    }

    const selected = new Set(episodeIds)
    const selectedWatches = response.watches.filter(watch => selected.has(watch.catalogEpisodeId))
    const watchIds = selectedWatches.map(watch => watch.id)

    await recordSeriesRequest(transaction, owner, {
      request,
      result: response,
      watchIds
    })

    return response
  })
}

// oxlint-disable-next-line eslint/max-params -- The public mutation keeps the account, target and validated request separate.
async function unmarkSeriesEpisodeWatched(database: Database, userId: string, catalogEpisodeId: string, input: CatalogSeriesUnwatchInput): Promise<CatalogSeriesWatchesResponse> {
  return database.transaction(async transaction => {
    const owner = await findEpisodeOwner(transaction, userId, catalogEpisodeId)
    const context = await lockSeriesContext(transaction, owner)

    assertCurrentContext(context, input)

    await transaction.delete(catalogViewingEpisodeWatches).where(
      and(eq(catalogViewingEpisodeWatches.userId, userId), eq(catalogViewingEpisodeWatches.catalogItemId, owner.catalogItemId), eq(catalogViewingEpisodeWatches.viewingId, input.currentViewingId), eq(catalogViewingEpisodeWatches.catalogEpisodeId, catalogEpisodeId), eq(catalogViewingEpisodeWatches.id, input.watchId))
    )

    return readSeriesWatches(transaction, owner)
  })
}

async function startSeriesRewatch(database: Database, owner: SeriesOwner, input: CatalogSeriesRewatchInput): Promise<CatalogSeriesWatchesResponse> {
  return database.transaction(async transaction => {
    const context = await lockSeriesContext(transaction, owner)

    const request = {
      action: 'rewatch',
      input
    }

    const replay = await replaySeriesRequest(transaction, owner, request)

    if (replay !== null) {
      return replay
    }

    assertCurrentContext(context, input)

    if (context.currentViewingId === null) {
      throw new CatalogHttpError('INVALID_REQUEST', 400, { fields: { currentViewingId: 'Mark an episode before starting a rewatch.' } })
    }

    const previous = await readSeriesWatches(transaction, owner)
    const viewing = previous.currentViewing

    if (viewing === null) { throw new Error('Current series viewing is missing') }

    if (previous.watches.length === 0) {
      throw new CatalogHttpError('CONFLICT', 409, { fields: { currentViewingId: 'Watch an episode before starting another viewing.' } })
    }

    const actionAt = await captureSeriesActionTime(transaction)

    if (viewing.status === 'watching') {
      // A new viewing takes over the active context without recording a user pause or completion.
      await transaction.update(catalogViewings).set({
        status: 'paused',
        revision: viewing.revision + 1
      }).where(
        eq(catalogViewings.id, context.currentViewingId)
      )
    }

    await createSeriesViewing(transaction, owner, {
      context,
      kind: 'rewatch_started',
      actionAt
    })

    const response = await readSeriesWatches(transaction, owner)

    await recordSeriesRequest(transaction, owner, {
      request,
      result: response,
      watchIds: [],
      previousStatus: viewing.status
    })

    return response
  })
}

async function cancelSeriesRewatch(database: Database, owner: SeriesOwner, input: CatalogSeriesCancelRewatchInput): Promise<CatalogSeriesWatchesResponse> {
  return database.transaction(async transaction => {
    const context = await lockSeriesContext(transaction, owner)
    const target = and(eq(catalogViewings.userId, owner.userId), eq(catalogViewings.catalogItemId, owner.catalogItemId), eq(catalogViewings.id, input.currentViewingId))

    const targets = await transaction.select({
      recordedAt: sql<string>`to_char(${catalogViewings.recordedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
    }).from(catalogViewings).where(target).for('update')

    const [viewing] = targets

    // A repeated cancellation must not touch a later viewing.
    if (viewing === undefined) { return readSeriesWatches(transaction, owner) }

    assertCurrentContext(context, input)

    const current = await readSeriesWatches(transaction, owner)

    if (current.currentViewing?.isRewatch !== true || current.watches.length > 0) {
      throw new CatalogHttpError('CONFLICT', 409, { fields: { currentViewingId: 'Only an empty new viewing can be canceled.' } })
    }

    const requests = await transaction.select({
      previousViewingId: sql<string | null>`${catalogSeriesRequests.input}->>'currentViewingId'`,
      previousStatus: sql<CatalogSeriesViewing['status'] | null>`${catalogSeriesRequests.result}->>'previousStatus'`,
      hadCloseStatus: sql<boolean>`${catalogSeriesRequests.input} ? 'closeStatus'`
    }).from(catalogSeriesRequests).where(
      and(eq(catalogSeriesRequests.userId, owner.userId), eq(catalogSeriesRequests.catalogItemId, owner.catalogItemId), eq(catalogSeriesRequests.viewingId, input.currentViewingId), eq(catalogSeriesRequests.action, 'rewatch'), eq(catalogSeriesRequests.tombstoned, false))
    ).limit(1)

    const [creation] = requests

    if (creation?.previousViewingId === undefined || creation.previousViewingId === null) {
      throw new CatalogHttpError('CONFLICT', 409)
    }

    const previousTarget = and(eq(catalogViewings.userId, owner.userId), eq(catalogViewings.catalogItemId, owner.catalogItemId), eq(catalogViewings.id, creation.previousViewingId))

    const previousRows = await transaction.select({
      status: sql<CatalogSeriesViewing['status']>`${catalogViewings.status}`,
      revision: catalogViewings.revision,

      hasClosingEvent: sql<boolean>`EXISTS (SELECT 1 FROM catalog_timeline_events
        WHERE viewing_id = ${creation.previousViewingId}::uuid AND kind IN ('series_paused', 'series_completed')
        AND occurred_at = ${viewing.recordedAt}::timestamptz)`
    }).from(catalogViewings).where(previousTarget).for('update')

    const [previous] = previousRows

    if (previous === undefined) { throw new CatalogHttpError('CONFLICT', 409) }

    const previousStatus = creation.previousStatus ?? (creation.hadCloseStatus && previous.hasClosingEvent ? 'watching' : previous.status)
    const condition = ownerCondition(owner)

    await transaction.update(catalogViewingContexts).set({
      currentViewingId: creation.previousViewingId,
      contextVersion: context.contextVersion + 1
    }).where(condition)

    await transaction.update(catalogSeriesRequests).set({ tombstoned: true }).where(
      and(eq(catalogSeriesRequests.userId, owner.userId), eq(catalogSeriesRequests.catalogItemId, owner.catalogItemId), eq(catalogSeriesRequests.viewingId, input.currentViewingId))
    )

    await transaction.delete(catalogViewings).where(target)

    if (previous.status !== previousStatus) {
      await transaction.update(catalogViewings).set({
        status: previousStatus,
        revision: previous.revision + 1
      }).where(previousTarget)
    }

    if (creation.hadCloseStatus) {
      // Earlier clients recorded a closing event and the new start at the same action time.
      await transaction.delete(catalogTimelineEvents).where(
        and(eq(catalogTimelineEvents.viewingId, creation.previousViewingId), sql`${catalogTimelineEvents.kind} IN ('series_paused', 'series_completed')`, sql`${catalogTimelineEvents.occurredAt} = ${viewing.recordedAt}::timestamptz`)
      )
    }

    return readSeriesWatches(transaction, owner)
  })
}

export { cancelSeriesRewatch, findSeriesWatches, markSeriesEpisodeWatched, markSeriesEpisodesWatched, startSeriesRewatch, unmarkSeriesEpisodeWatched }
