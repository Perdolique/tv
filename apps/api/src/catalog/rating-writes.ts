import type { CatalogTransaction as RatingTransaction, ViewingOwner as RatingOwner } from './viewings-repository.ts'
import { catalogItemRatings, catalogRatingVotes } from '@tv/database/schema'
import { and, eq, isNull } from 'drizzle-orm'

interface RatingTarget {
  seasonNumber: number | null;
  catalogEpisodeId: string | null;
}

interface ViewingScoreChange extends RatingTarget {
  viewingId: string;
  score: number | null;
}

interface RatingVoteSave extends RatingTarget {
  sourceViewingId: string;
  score: number;
}

interface RatingVoteRemoval extends RatingTarget {
  score: null;
}

type RatingVoteChange = RatingVoteSave | RatingVoteRemoval

// The caller holds the title context lock and owns the atomic score, vote and viewing mutation.
async function writeViewingScore(transaction: RatingTransaction, owner: RatingOwner, input: ViewingScoreChange): Promise<boolean> {
  const seasonFilter = input.seasonNumber === null ? isNull(catalogItemRatings.seasonNumber) : eq(catalogItemRatings.seasonNumber, input.seasonNumber)
  const episodeFilter = input.catalogEpisodeId === null ? isNull(catalogItemRatings.catalogEpisodeId) : eq(catalogItemRatings.catalogEpisodeId, input.catalogEpisodeId)
  const target = and(eq(catalogItemRatings.userId, owner.userId), eq(catalogItemRatings.catalogItemId, owner.catalogItemId), eq(catalogItemRatings.viewingId, input.viewingId), seasonFilter, episodeFilter)
  const rows = await transaction.select({ score: catalogItemRatings.score }).from(catalogItemRatings).where(target).for('update')
  const previousScore = rows[0]?.score ?? null

  if (previousScore === input.score) { return false }

  if (input.score === null) {
    await transaction.delete(catalogItemRatings).where(target)
  } else {
    await transaction.insert(catalogItemRatings).values({
      userId: owner.userId,
      catalogItemId: owner.catalogItemId,
      viewingId: input.viewingId,
      seasonNumber: input.seasonNumber,
      catalogEpisodeId: input.catalogEpisodeId,
      score: input.score
    }).onConflictDoUpdate({
      target: [catalogItemRatings.userId, catalogItemRatings.catalogItemId, catalogItemRatings.seasonNumber, catalogItemRatings.catalogEpisodeId, catalogItemRatings.viewingId],
      set: { score: input.score }
    })
  }

  return true
}

// Public votes keep their source viewing until a current score replaces or removes that vote.
async function writeRatingVote(transaction: RatingTransaction, owner: RatingOwner, input: RatingVoteChange): Promise<boolean> {
  const seasonFilter = input.seasonNumber === null ? isNull(catalogRatingVotes.seasonNumber) : eq(catalogRatingVotes.seasonNumber, input.seasonNumber)
  const episodeFilter = input.catalogEpisodeId === null ? isNull(catalogRatingVotes.catalogEpisodeId) : eq(catalogRatingVotes.catalogEpisodeId, input.catalogEpisodeId)
  const target = and(eq(catalogRatingVotes.userId, owner.userId), eq(catalogRatingVotes.catalogItemId, owner.catalogItemId), seasonFilter, episodeFilter)

  const rows = await transaction.select({
    score: catalogRatingVotes.score,
    sourceViewingId: catalogRatingVotes.sourceViewingId
  }).from(catalogRatingVotes).where(target).for('update')

  const [previous] = rows

  if (input.score === null) {
    if (previous === undefined) { return false }

    await transaction.delete(catalogRatingVotes).where(target)

    return true
  }

  if (previous?.score === input.score && previous.sourceViewingId === input.sourceViewingId) { return false }

  await transaction.insert(catalogRatingVotes).values({
    userId: owner.userId,
    catalogItemId: owner.catalogItemId,
    seasonNumber: input.seasonNumber,
    catalogEpisodeId: input.catalogEpisodeId,
    sourceViewingId: input.sourceViewingId,
    score: input.score
  }).onConflictDoUpdate({
    target: [catalogRatingVotes.userId, catalogRatingVotes.catalogItemId, catalogRatingVotes.seasonNumber, catalogRatingVotes.catalogEpisodeId],

    set: {
      score: input.score,
      sourceViewingId: input.sourceViewingId
    }
  })

  return true
}

export { writeRatingVote, writeViewingScore }
export type { RatingTarget }
