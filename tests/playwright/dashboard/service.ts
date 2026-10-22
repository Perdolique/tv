import type { CatalogViewingHistoryItem, CatalogViewingSummaryResponse } from '../../../packages/shared/src/catalog.ts'
import type { CatalogViewing } from '../../../packages/shared/src/catalog-viewings.ts'
import type { CatalogSeriesEpisodeWatch } from '../../../packages/shared/src/catalog-series.ts'
import { detailsItems } from '../catalog/details.fixtures.ts'

function createViewingItems(viewings: CatalogViewing[]): CatalogViewingHistoryItem[] {
  const items: CatalogViewingHistoryItem[] = []

  for (const viewing of viewings) {
    const title = detailsItems.find(item => item.id === viewing.catalogItemId)

    if (title === undefined) { throw new Error('Missing diary title fixture') }

    items.push({
      id: title.id,
      viewingId: viewing.id,
      type: title.type,
      title: title.title,
      titleLocale: title.titleLocale,
      originalTitle: title.originalTitle,
      originalTitleLocale: title.originalTitleLocale,
      posterUrl: title.posterUrl,
      releaseYear: title.releaseYear,
      status: viewing.status,
      startedOn: viewing.startedOn,
      completedOn: viewing.completedOn,
      score: viewing.score
    })
  }

  return items.toSorted((left, right) => {
    const leftDate = left.completedOn ?? left.startedOn ?? ''
    const rightDate = right.completedOn ?? right.startedOn ?? ''

    return rightDate.localeCompare(leftDate) || right.viewingId.localeCompare(left.viewingId)
  })
}

function createViewingSummary(items: readonly CatalogViewingHistoryItem[], watches: CatalogSeriesEpisodeWatch[]): CatalogViewingSummaryResponse {
  const active = items.filter(item => item.type === 'series' && item.status === 'watching')
  const sortedActive = active.toSorted((left, right) => (right.startedOn ?? '').localeCompare(left.startedOn ?? '') || right.viewingId.localeCompare(left.viewingId))
  const visibleActive = sortedActive.slice(0, 5)

  return {
    watchedMovieCount: items.filter(item => item.type === 'movie').length,
    watchedEpisodeCount: watches.length,
    completedSeriesCount: items.filter(item => item.type === 'series' && item.status === 'completed').length,
    watchingSeriesCount: active.length,

    activeSeries: visibleActive.map(item => {return {
      id: item.id,
      originalTitle: item.originalTitle,
      originalTitleLocale: item.originalTitleLocale,
      posterUrl: item.posterUrl,
      releaseYear: item.releaseYear,
      title: item.title,
      titleLocale: item.titleLocale,
      type: 'series',
      viewingId: item.viewingId,
      startedOn: item.startedOn ?? '',
      watchedEpisodeCount: watches.filter(watch => watch.viewingId === item.viewingId).length
    }})
  }
}

export { createViewingItems, createViewingSummary }
