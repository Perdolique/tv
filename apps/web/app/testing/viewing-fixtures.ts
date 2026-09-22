import type { CatalogViewingHistoryItem, CatalogViewingSummaryResponse } from '@tv/shared/catalog'

const movie = {
  id: '10000000-0000-7000-8000-000000000001',
  entryId: '10000000-0000-7000-8000-000000000001',
  kind: 'movie',
  type: 'movie',
  title: 'A watched movie',
  originalTitle: 'A watched movie',
  originalTitleLocale: 'en',
  titleLocale: 'en',
  releaseYear: 2026,
  posterUrl: null,
  markedAt: '2026-09-22T13:00:00.123456Z',
  episodeNumber: null,
  seasonNumber: null,
  sourceTitle: null
} as const satisfies CatalogViewingHistoryItem

const olderMovie = {
  ...movie,
  id: '10000000-0000-7000-8000-000000000002',
  entryId: '10000000-0000-7000-8000-000000000002',
  title: 'An older movie'
} as const satisfies CatalogViewingHistoryItem

const summary = {
  watchedMovieCount: 2,
  watchedEpisodeCount: 0,
  series: []
} as const satisfies CatalogViewingSummaryResponse

export { movie, olderMovie, summary }
