import type { Database } from '@tv/database'
import { catalogViewings, catalogViewingContexts } from '@tv/database/schema'

import type {
  CatalogMovieRatingContext,
  CatalogMovieRatingResponse,
  CatalogViewingMutationResponse
} from '@tv/shared/catalog-viewings'

import { and, eq, sql } from 'drizzle-orm'
import { CatalogHttpError } from './errors.ts'
import { recordMovieRatingEvent, writeMovieScore } from './movie-rating-writes.ts'

import {
  findMovieViewing,
  lockViewingContext,
  readMovieViewingSummary,
  type ViewingOwner,
  type ViewingTarget
} from './movie-viewings-repository.ts'

interface CurrentMovieRatingChange extends CatalogMovieRatingContext {
  score: number | null;
}

interface HistoricalMovieRatingChange {
  revision: number;
  score: number | null;
}

async function setCurrentMovieRating(database: Database, owner: ViewingOwner, input: CurrentMovieRatingChange): Promise<CatalogMovieRatingResponse> {
  return database.transaction(async transaction => {
    const context = await lockViewingContext(transaction, owner)

    if (context.currentViewingId !== input.currentViewingId || context.contextVersion !== input.contextVersion) {
      throw new CatalogHttpError('CONFLICT', 409)
    }

    const linked = input.currentViewingId === null ? null : await writeMovieScore(transaction, owner, {
      viewingId: input.currentViewingId,
      score: input.score
    })

    const vote = await writeMovieScore(transaction, owner, {
      viewingId: null,
      score: input.score
    })

    if (linked?.changed === true && input.currentViewingId !== null) {
      await transaction.update(catalogViewings).set({ revision: sql`${catalogViewings.revision} + 1` }).where(
        and(eq(catalogViewings.userId, owner.userId), eq(catalogViewings.catalogItemId, owner.catalogItemId), eq(catalogViewings.id, input.currentViewingId))
      )
    }

    if (linked?.changed === true || vote.changed) {
      await transaction.update(catalogViewingContexts).set({ contextVersion: context.contextVersion + 1 }).where(
        and(eq(catalogViewingContexts.userId, owner.userId), eq(catalogViewingContexts.catalogItemId, owner.catalogItemId))
      )

      const event = linked?.changed === true
        ? {
          viewingId: input.currentViewingId,
          previousScore: linked.previousScore,
          score: input.score
        }
        : {
          viewingId: null,
          previousScore: vote.previousScore,
          score: input.score
        }

      await recordMovieRatingEvent(transaction, owner, event)
    }

    const viewing = input.currentViewingId === null ? null : await findMovieViewing(transaction, owner, input.currentViewingId)
    const summary = await readMovieViewingSummary(transaction, owner)

    return {
      score: input.score,
      viewing,
      summary
    }
  })
}

async function setHistoricalMovieRating(database: Database, owner: ViewingTarget, input: HistoricalMovieRatingChange): Promise<CatalogViewingMutationResponse> {
  return database.transaction(async transaction => {
    const context = await lockViewingContext(transaction, owner)
    const viewing = await findMovieViewing(transaction, owner, owner.viewingId)

    if (context.currentViewingId === owner.viewingId || (viewing.revision !== input.revision && viewing.score !== input.score)) {
      throw new CatalogHttpError('CONFLICT', 409)
    }

    const result = await writeMovieScore(transaction, owner, {
      viewingId: owner.viewingId,
      score: input.score
    })

    if (result.changed) {
      await transaction.update(catalogViewings).set({ revision: viewing.revision + 1 }).where(
        and(eq(catalogViewings.userId, owner.userId), eq(catalogViewings.catalogItemId, owner.catalogItemId), eq(catalogViewings.id, owner.viewingId))
      )

      await recordMovieRatingEvent(transaction, owner, {
        viewingId: owner.viewingId,
        previousScore: result.previousScore,
        score: input.score
      })
    }

    const updated = await findMovieViewing(transaction, owner, owner.viewingId)
    const summary = await readMovieViewingSummary(transaction, owner)

    return {
      viewing: updated,
      summary
    }
  })
}

export { setCurrentMovieRating, setHistoricalMovieRating }
