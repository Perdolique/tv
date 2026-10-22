import type { CatalogViewingHistoryItem, CatalogViewingSummaryResponse } from '@tv/shared/catalog'

const movie = {
  id: '10000000-0000-7000-8000-000000000001',
  viewingId: '10000000-0000-7000-8000-000000000001',
  type: 'movie',
  title: 'A watched movie',
  originalTitle: 'A watched movie',
  originalTitleLocale: 'en',
  titleLocale: 'en',
  releaseYear: 2026,
  posterUrl: null,
  status: 'completed',
  startedOn: null,
  completedOn: '2026-09-22',
  score: 8
} as const satisfies CatalogViewingHistoryItem

const olderMovie = {
  ...movie,
  id: '10000000-0000-7000-8000-000000000002',
  viewingId: '10000000-0000-7000-8000-000000000002',
  title: 'An older movie'
} as const satisfies CatalogViewingHistoryItem

const summary = {
  watchedMovieCount: 2,
  watchedEpisodeCount: 0,
  completedSeriesCount: 0,
  watchingSeriesCount: 0,
  activeSeries: []
} as const satisfies CatalogViewingSummaryResponse

export { movie, olderMovie, summary }
