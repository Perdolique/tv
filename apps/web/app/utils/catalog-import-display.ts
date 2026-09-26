import type { ImportSearchItem, ImportShowItem } from '@tv/shared/catalog-import'

function titleKey(item: ImportSearchItem): string {
  const formatted = `${item.type}-${item.id}`

  return formatted
}

function titleMetadata(item: ImportSearchItem): string {
  const year = item.year ?? 'Year unknown'
  const typeLabel = item.type === 'movie' ? 'Movie' : 'Series'
  const formatted = `${year} · ${typeLabel}`

  return formatted
}

function showYear(show: ImportShowItem): string | number {
  return show.year ?? 'Year unknown'
}

function showUrl(show: ImportShowItem): string {
  const formatted = `https://www.tvmaze.com/shows/${show.id}`

  return formatted
}

function hasOriginalTitle(item: ImportSearchItem): boolean {
  return item.originalTitle !== item.title
}

export { titleKey, titleMetadata, showYear, showUrl, hasOriginalTitle }
