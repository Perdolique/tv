import type { CatalogViewingHistoryItem } from '../../../packages/shared/src/catalog.ts'
import { chernobyl } from '../catalog/details.fixtures.ts'

const longTitle = 'A very long series title with enough words to fill the available space and an UnbrokenSeriesTitleThatMustNeverPushAnyPartOfThePageOutsideItsContainer'

const paginatedHistory: readonly Readonly<CatalogViewingHistoryItem>[] = Array.from({ length: 25 }, (_value, index) => {
  const suffix = String(25 - index).padStart(12, '0')
  const isWatching = index < 7

  return {
    id: isWatching ? `53000000-0000-7000-8000-${suffix}` : chernobyl.id,
    viewingId: `52000000-0000-7000-8000-${suffix}`,
    type: 'series',
    title: longTitle,
    originalTitle: chernobyl.originalTitle,
    originalTitleLocale: chernobyl.originalTitleLocale,
    titleLocale: 'en',
    releaseYear: chernobyl.releaseYear,
    posterUrl: null,
    status: isWatching ? 'watching' : 'completed',
    startedOn: isWatching ? '2026-09-22' : '2026-09-20',
    completedOn: isWatching ? null : '2026-09-22',
    score: index % 2 === 0 ? null : 8
  } as const satisfies CatalogViewingHistoryItem
})

export { paginatedHistory }
