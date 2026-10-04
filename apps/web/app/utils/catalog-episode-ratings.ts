interface EpisodeRatingSeason {
  catalogItemId: string;
  seasonNumber: number;
}

function episodeRatingsSeasonPath({ catalogItemId, seasonNumber }: EpisodeRatingSeason): string {
  const id = encodeURIComponent(catalogItemId)

  return `/api/catalog/items/${id}/seasons/${seasonNumber}/episodes`
}

// A missing or repeated entry is not an unrated episode.
function hasCompleteEpisodeRatings(items: { episodeId: string }[], episodeIds: string[]): boolean {
  const itemIds = items.map(item => item.episodeId)
  const ids = new Set(itemIds)

  if (ids.size !== items.length || ids.size !== episodeIds.length) {
    return false
  }

  return episodeIds.every(id => ids.has(id))
}

export { episodeRatingsSeasonPath, hasCompleteEpisodeRatings }
export type { EpisodeRatingSeason }
