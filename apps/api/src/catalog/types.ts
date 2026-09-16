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

interface CatalogReleaseCursor {
  catalogItemId: string;
  episodeNumber: number | null;
  releaseDate: string;
  releaseId: string;
  seasonNumber: number | null;
}

interface CatalogUpcomingReleaseQuery {
  cursor: CatalogReleaseCursor | null;
  from: string;
}

export type {
  CatalogDetailsRow,
  CatalogReleaseRange,
  CatalogReleaseCursor,
  CatalogReleaseRow,
  CatalogTitleRow,
  CatalogUpcomingReleaseQuery,
  CatalogWatchlistRow
}
