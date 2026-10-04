import type { CatalogRatingTarget } from '@tv/shared/catalog'

// Both rating requests use the full target identity, independently of account state.
function catalogRatingPath({ catalogItemId, seasonNumber }: CatalogRatingTarget): string {
  const encodedId = encodeURIComponent(catalogItemId)
  const itemPath = `/api/catalog/items/${encodedId}`
  const targetPath = seasonNumber === null ? itemPath : `${itemPath}/seasons/${seasonNumber}`

  return targetPath
}

export { catalogRatingPath }
export type { CatalogRatingTarget } from '@tv/shared/catalog'
