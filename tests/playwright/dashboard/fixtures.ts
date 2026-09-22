import type { CatalogViewingHistoryItem } from '../../../packages/shared/src/catalog.ts'
import { chernobyl } from '../catalog/details.fixtures.ts'

const longTitle = 'A very long series title with enough words to fill the available space and an UnbrokenSeriesTitleThatMustNeverPushAnyPartOfThePageOutsideItsContainer'

const paginatedHistory: readonly Readonly<CatalogViewingHistoryItem>[] = Array.from({ length: 25 }, (_value, index) => {
  const suffix = String(25 - index).padStart(12, '0')

  return {
    id: chernobyl.id,
    entryId: `52000000-0000-7000-8000-${suffix}`,
    kind: 'episode',
    type: 'series',
    title: longTitle,
    originalTitle: chernobyl.originalTitle,
    originalTitleLocale: chernobyl.originalTitleLocale,
    titleLocale: 'en',
    releaseYear: chernobyl.releaseYear,
    posterUrl: null,
    markedAt: '2026-09-22T00:15:00.123456Z',
    episodeNumber: 25 - index,
    seasonNumber: 1,
    sourceTitle: `Episode ${25 - index}`
  } as const satisfies CatalogViewingHistoryItem
})

export { paginatedHistory }
