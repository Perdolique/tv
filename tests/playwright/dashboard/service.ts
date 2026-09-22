import type { CatalogViewingHistoryItem, CatalogViewingSummaryResponse } from '../../../packages/shared/src/catalog.ts'
import { detailsItems } from '../catalog/details.fixtures.ts'
import { episodeFixtures } from '../catalog/episodes.fixtures.ts'

function createViewingItems(movieIds: Set<string>, episodeIds: Set<string>): CatalogViewingHistoryItem[] {
  const items: CatalogViewingHistoryItem[] = []

  for (const title of detailsItems) {
    if (title.type === 'movie' && movieIds.has(title.id)) {
      items.push({
        id: title.id,
        entryId: title.id,
        kind: 'movie',
        type: 'movie',
        title: title.title,
        titleLocale: title.titleLocale,
        originalTitle: title.originalTitle,
        originalTitleLocale: title.originalTitleLocale,
        posterUrl: title.posterUrl,
        releaseYear: title.releaseYear,
        markedAt: '2026-09-22T13:00:00.123456Z',
        episodeNumber: null,
        seasonNumber: null,
        sourceTitle: null
      })
    }

    for (const episode of episodeFixtures.get(title.id) ?? []) {
      if (episodeIds.has(episode.id)) {
        items.push({
          id: title.id,
          entryId: episode.id,
          kind: 'episode',
          type: 'series',
          title: title.title,
          titleLocale: title.titleLocale,
          originalTitle: title.originalTitle,
          originalTitleLocale: title.originalTitleLocale,
          posterUrl: title.posterUrl,
          releaseYear: title.releaseYear,
          markedAt: '2026-09-22T14:00:00.123456Z',
          episodeNumber: episode.episodeNumber,
          seasonNumber: episode.seasonNumber,
          sourceTitle: episode.sourceTitle
        })
      }
    }
  }

  return items.toSorted((left, right) => right.markedAt.localeCompare(left.markedAt) || right.entryId.localeCompare(left.entryId))
}

function createViewingSummary(items: readonly CatalogViewingHistoryItem[]): CatalogViewingSummaryResponse {
  const series: CatalogViewingSummaryResponse['series'] = []
  let watchedMovieCount = 0
  let watchedEpisodeCount = 0

  for (const item of items) {
    if (item.kind === 'movie') {
      watchedMovieCount += 1
    } else {
      watchedEpisodeCount += 1

      const existing = series.find(candidate => candidate.id === item.id)

      if (existing === undefined) {
        series.push({
          id: item.id,
          originalTitle: item.originalTitle,
          originalTitleLocale: item.originalTitleLocale,
          posterUrl: item.posterUrl,
          releaseYear: item.releaseYear,
          title: item.title,
          titleLocale: item.titleLocale,
          type: 'series',
          watchedEpisodeCount: 1
        })
      } else {
        existing.watchedEpisodeCount += 1
      }
    }
  }

  return {
    watchedMovieCount,
    watchedEpisodeCount,
    series
  }
}

export { createViewingItems, createViewingSummary }
