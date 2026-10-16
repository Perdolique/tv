import type { Database } from '@tv/database'
import { catalogItemRatings, catalogTimelineEvents } from '@tv/database/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'

type CatalogTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]

interface RatingOwner {
  userId: string;
  catalogItemId: string;
}

interface MovieScore {
  viewingId: string | null;
  score: number | null;
}

interface MovieRatingEvent extends MovieScore {
  previousScore: number | null;
}

// Callers hold the personal title lock and own the transaction spanning both rows.
async function writeMovieScore(transaction: CatalogTransaction, owner: RatingOwner, input: MovieScore) {
  const viewingFilter = input.viewingId === null ? isNull(catalogItemRatings.viewingId) : eq(catalogItemRatings.viewingId, input.viewingId)

  const target = and(
    eq(catalogItemRatings.userId, owner.userId),
    eq(catalogItemRatings.catalogItemId, owner.catalogItemId),
    isNull(catalogItemRatings.seasonNumber),
    isNull(catalogItemRatings.catalogEpisodeId),
    viewingFilter
  )

  const rows = await transaction.select({ score: catalogItemRatings.score }).from(catalogItemRatings).where(target).for('update')
  const previousScore = rows[0]?.score ?? null
  const changed = previousScore !== input.score

  if (!changed) {
    return {
      previousScore,
      changed
    }
  }

  if (input.score === null) {
    await transaction.delete(catalogItemRatings).where(target)
  } else {
    await transaction.insert(catalogItemRatings).values({
      userId: owner.userId,
      catalogItemId: owner.catalogItemId,
      viewingId: input.viewingId,
      score: input.score
    }).onConflictDoUpdate({
      target: [catalogItemRatings.userId, catalogItemRatings.catalogItemId, catalogItemRatings.seasonNumber, catalogItemRatings.catalogEpisodeId, catalogItemRatings.viewingId],
      set: { score: input.score }
    })
  }

  return {
    previousScore,
    changed
  }
}

async function recordMovieRatingEvent(transaction: CatalogTransaction, owner: RatingOwner, input: MovieRatingEvent): Promise<void> {
  if (input.previousScore === input.score) { return }

  await transaction.insert(catalogTimelineEvents).values({
    userId: owner.userId,
    catalogItemId: owner.catalogItemId,
    viewingId: input.viewingId,
    previousScore: input.previousScore,
    score: input.score,
    kind: 'rating_changed',
    occurredAt: sql`clock_timestamp()`
  })
}

export { recordMovieRatingEvent, writeMovieScore }
