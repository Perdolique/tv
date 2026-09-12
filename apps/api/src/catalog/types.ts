import type { CatalogItemType } from '@tv/shared/catalog'

interface CatalogTitleRow {
  catalogItemId: string;
  isOriginal: boolean;
  locale: string;
  releaseYear: number | null;
  title: string;
  type: CatalogItemType;
}

interface CatalogDetailsRow extends CatalogTitleRow {
  description: string | null;
  posterPath: string | null;
}

interface CatalogWatchlistRow extends CatalogTitleRow {
  posterPath: string | null;
}

interface CatalogReleaseRow extends CatalogWatchlistRow {
  episodeNumber: number | null;
  releaseDate: string;
  releaseId: string;
  seasonNumber: number | null;
}

interface CatalogReleaseRange {
  from: string;
  to: string;
}

export type {
  CatalogDetailsRow,
  CatalogReleaseRange,
  CatalogReleaseRow,
  CatalogTitleRow,
  CatalogWatchlistRow
}
