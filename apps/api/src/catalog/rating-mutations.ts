import type { Database } from '@tv/database'

import {
  catalogEpisodes,
  catalogItemRatings,
  catalogItems,
  catalogItemTitles,
  catalogViewingEpisodeWatches,
  catalogViewings
} from '@tv/database/schema'

import type {
  CatalogRatingMutationResponse,
  CatalogRatingSaveInput,
  CatalogHistoricalRatingSaveInput
} from '@tv/shared/catalog-viewings'

import { and, eq, isNull, sql } from 'drizzle-orm'
import { CatalogHttpError } from './errors.ts'
import { writeRatingVote, writeViewingScore, type RatingTarget } from './rating-writes.ts'
import { ensureEpisodeWatch } from './series-viewings-repository.ts'

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
  type CatalogTransaction as RatingTransaction,
  type ViewingOwner,
  type ViewingTarget
} from './viewings-repository.ts'

type CurrentRatingChange = Omit<CatalogRatingSaveInput, 'score'> & { score: number | null }
type HistoricalRatingChange = Omit<CatalogHistoricalRatingSaveInput, 'score'> & { score: number | null }

function ratingAction(target: RatingTarget, historical: boolean): string {
  const scope = target.catalogEpisodeId === null ? `season:${String(target.seasonNumber)}` : `episode:${target.catalogEpisodeId}`
  const context = historical ? 'history' : 'current'

  return `rating:${context}:${scope}`
}

// oxlint-disable-next-line eslint/max-params -- Keep the database, owner, rating target and validated context separate.
async function requireRatingTarget(transaction: Pick<Database, 'select'>, owner: ViewingOwner, target: RatingTarget, type: 'movie' | 'series', lock = true): Promise<void> {
  const hasChildTarget = target.seasonNumber !== null || target.catalogEpisodeId !== null

  if (!hasChildTarget) { return }

  if (type !== 'series' || (target.seasonNumber !== null && target.catalogEpisodeId !== null)) {
    throw new CatalogHttpError('INVALID_REQUEST', 400)
  }

  const scope = target.catalogEpisodeId === null ? eq(catalogEpisodes.seasonNumber, target.seasonNumber ?? 0) : eq(catalogEpisodes.id, target.catalogEpisodeId)

  const query = transaction.select({ id: catalogEpisodes.id }).from(catalogEpisodes)
    .where(
      and(eq(catalogEpisodes.catalogItemId, owner.catalogItemId), scope)
    )
    .orderBy(catalogEpisodes.id)
    .limit(1)

  const rows = lock ? await query.for('key share') : await query

  if (rows[0] === undefined) { throw new CatalogHttpError('NOT_FOUND', 404) }
}

// oxlint-disable-next-line eslint/max-params -- Keep the database, owner, rating target and validated context separate.
async function readRatingResponse(transaction: Pick<Database, 'select' | 'execute'>, owner: ViewingOwner, target: RatingTarget, selectedViewingId?: string | null): Promise<CatalogRatingMutationResponse> {
  const summary = await readViewingSummary(transaction, owner)
  const viewingId = selectedViewingId === undefined ? summary.currentViewingId : selectedViewingId
  const viewing = viewingId === null ? null : await findViewing(transaction, owner, viewingId)
  const seasonFilter = target.seasonNumber === null ? isNull(catalogItemRatings.seasonNumber) : eq(catalogItemRatings.seasonNumber, target.seasonNumber)
  const episodeFilter = target.catalogEpisodeId === null ? isNull(catalogItemRatings.catalogEpisodeId) : eq(catalogItemRatings.catalogEpisodeId, target.catalogEpisodeId)

  const ratings = viewingId === null ? [] : await transaction.select({ score: catalogItemRatings.score }).from(catalogItemRatings)
    .where(
      and(eq(catalogItemRatings.userId, owner.userId), eq(catalogItemRatings.catalogItemId, owner.catalogItemId), eq(catalogItemRatings.viewingId, viewingId), seasonFilter, episodeFilter)
    )
    .limit(1)

  const response: CatalogRatingMutationResponse = {
    score: ratings[0]?.score ?? null,
    viewing,
    summary
  }

  if (target.catalogEpisodeId !== null && viewingId !== null) {
    const watches = await transaction.select({
      id: catalogViewingEpisodeWatches.id,
      catalogEpisodeId: catalogViewingEpisodeWatches.catalogEpisodeId,
      viewingId: catalogViewingEpisodeWatches.viewingId,
      markedAt: catalogViewingEpisodeWatches.markedAt
    }).from(catalogViewingEpisodeWatches)
      .where(
        and(eq(catalogViewingEpisodeWatches.userId, owner.userId), eq(catalogViewingEpisodeWatches.catalogItemId, owner.catalogItemId), eq(catalogViewingEpisodeWatches.viewingId, viewingId))
      )
      .orderBy(catalogViewingEpisodeWatches.id)

    response.watches = watches.map(watch => {
      const markedAt = watch.markedAt.toISOString()

      return {
        id: watch.id,
        catalogEpisodeId: watch.catalogEpisodeId,
        viewingId: watch.viewingId,
        markedAt
      }
    })
  }

  return response
}

interface EpisodeRatingWatch {
  changed: boolean;
  watchIds: string[];
}

interface EpisodeRatingWatchInput {
  viewingId: string;
  episodeId: string | null;
  score: number | null;
  timeZone: string;
}

async function ensureRatingEpisodeWatch(transaction: RatingTransaction, owner: ViewingOwner, input: EpisodeRatingWatchInput): Promise<EpisodeRatingWatch> {
  if (input.episodeId === null || input.score === null) {
    return {
    changed: false,
    watchIds: []
  }
  }

  const existing = await transaction.select({ id: catalogViewingEpisodeWatches.id }).from(catalogViewingEpisodeWatches)
    .where(
      and(eq(catalogViewingEpisodeWatches.viewingId, input.viewingId), eq(catalogViewingEpisodeWatches.catalogEpisodeId, input.episodeId))
    )
    .limit(1)

  const watch = await ensureEpisodeWatch(transaction, owner, {
    viewingId: input.viewingId,
    episodeId: input.episodeId,
    timeZone: input.timeZone
  })

  return {
    changed: existing.length === 0,
    watchIds: [watch.id]
  }
}

// A private GET returns the selected score, viewing and current context from one database snapshot.
// oxlint-disable-next-line eslint/max-params -- Keep the database, owner, rating target and validated context separate.
async function readRatingSnapshot(database: Database, owner: ViewingOwner, target: RatingTarget, viewingId?: string): Promise<CatalogRatingMutationResponse> {
  return database.transaction(async transaction => {
    await transaction.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`)

    const items = await transaction.select({ type: catalogItems.type }).from(catalogItems)
      .innerJoin(catalogItemTitles, and(eq(catalogItemTitles.catalogItemId, catalogItems.id), eq(catalogItemTitles.isOriginal, true)))
      .where(
        eq(catalogItems.id, owner.catalogItemId)
      )
      .limit(1)

    const [item] = items

    if (item === undefined) { throw new CatalogHttpError('NOT_FOUND', 404) }

    await requireRatingTarget(transaction, owner, target, item.type, false)

    return readRatingResponse(transaction, owner, target, viewingId)
  })
}

// oxlint-disable-next-line eslint/max-params -- Keep the database, owner, rating target and validated context separate.
async function setCurrentCatalogRating(database: Database, owner: ViewingOwner, target: RatingTarget, input: CurrentRatingChange): Promise<CatalogRatingMutationResponse> {
  return database.transaction(async transaction => {
    const context = await lockViewingContext(transaction, owner)
    const action = ratingAction(target, false)

    const request = {
      action,
      input,
      allowEmptyViewing: true as const
    }

    const replay = await replayViewingRequest(transaction, owner, request)

    if (replay !== null) { return readRatingResponse(transaction, owner, target, replay.viewingId) }

    assertCurrentContext(context, input)
    await requireRatingTarget(transaction, owner, target, context.type)

    let viewingId = context.currentViewingId
    const createsViewing = viewingId === null && input.score !== null

    if (createsViewing) {
      if (input.viewingDate === undefined) {
        throw new CatalogHttpError('INVALID_REQUEST', 400, { fields: { viewingDate: 'Choose the date for this viewing.' } })
      }

      const actionAt = await captureActionTime(transaction)
      const isMovie = context.type === 'movie'

      viewingId = await createViewingInTransaction(transaction, owner, {
        status: isMovie ? 'completed' : 'watching',
        startedOn: isMovie ? null : input.viewingDate,
        completedOn: isMovie ? input.viewingDate : null,
        kind: isMovie ? 'movie_viewing' : 'series_started',
        actionAt,
        makeCurrent: true,
        context
      })
    }

    let watchIds: string[] = []
    let viewingChanged = false

    if (viewingId !== null) {
      const { changed: watchChanged, watchIds: createdWatchIds } = await ensureRatingEpisodeWatch(transaction, owner, {
        viewingId,
        episodeId: target.catalogEpisodeId,
        score: input.score,
        timeZone: input.timeZone
      })

      const scoreChanged = await writeViewingScore(transaction, owner, {
        viewingId,
        seasonNumber: target.seasonNumber,
        catalogEpisodeId: target.catalogEpisodeId,
        score: input.score
      })

      watchIds = createdWatchIds
      viewingChanged = scoreChanged || watchChanged

      if (!createsViewing && viewingChanged) { await bumpViewingRevision(transaction, owner, viewingId) }
    }

    let voteChanged = false

    if (input.score === null) {
      voteChanged = await writeRatingVote(transaction, owner, {
        seasonNumber: target.seasonNumber,
        catalogEpisodeId: target.catalogEpisodeId,
        score: null
      })
    } else if (viewingId !== null) {
      voteChanged = await writeRatingVote(transaction, owner, {
        sourceViewingId: viewingId,
        seasonNumber: target.seasonNumber,
        catalogEpisodeId: target.catalogEpisodeId,
        score: input.score
      })
    }

    if (!createsViewing && (viewingChanged || voteChanged)) { await bumpContextVersion(transaction, owner) }

    await recordViewingRequest(transaction, owner, {
      action,
      input,
      viewingId,
      watchIds
    })

    return readRatingResponse(transaction, owner, target, viewingId)
  })
}

// oxlint-disable-next-line eslint/max-params -- Keep the database, owner, rating target and validated context separate.
async function setHistoricalCatalogRating(database: Database, owner: ViewingTarget, target: RatingTarget, input: HistoricalRatingChange): Promise<CatalogRatingMutationResponse> {
  return database.transaction(async transaction => {
    const context = await lockViewingContext(transaction, owner)
    const actionScope = ratingAction(target, true)
    const action = `${actionScope}:${owner.viewingId}`

    const request = {
      action,
      input
    }

    const replay = await replayViewingRequest(transaction, owner, request)

    if (replay !== null) { return readRatingResponse(transaction, owner, target, replay.viewingId) }

    if (context.currentViewingId === owner.viewingId) { throw new CatalogHttpError('CONFLICT', 409) }

    const rows = await transaction.select({ revision: catalogViewings.revision }).from(catalogViewings)
      .where(
        and(eq(catalogViewings.id, owner.viewingId), eq(catalogViewings.userId, owner.userId), eq(catalogViewings.catalogItemId, owner.catalogItemId))
      )
      .for('update')

    const [viewing] = rows

    if (viewing === undefined) { throw new CatalogHttpError('NOT_FOUND', 404) }

    if (viewing.revision !== input.revision) { throw new CatalogHttpError('CONFLICT', 409) }

    await requireRatingTarget(transaction, owner, target, context.type)

    const watch = await ensureRatingEpisodeWatch(transaction, owner, {
      viewingId: owner.viewingId,
      episodeId: target.catalogEpisodeId,
      score: input.score,
      timeZone: input.timeZone
    })

    const changed = await writeViewingScore(transaction, owner, {
      viewingId: owner.viewingId,
      seasonNumber: target.seasonNumber,
      catalogEpisodeId: target.catalogEpisodeId,
      score: input.score
    })

    if (changed || watch.changed) { await bumpViewingRevision(transaction, owner, owner.viewingId) }

    await recordViewingRequest(transaction, owner, {
      action,
      input,
      viewingId: owner.viewingId,
      watchIds: watch.watchIds
    })

    return readRatingResponse(transaction, owner, target, owner.viewingId)
  })
}

export { readRatingResponse, readRatingSnapshot, setCurrentCatalogRating, setHistoricalCatalogRating }
export type { CurrentRatingChange, HistoricalRatingChange }
