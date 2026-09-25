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
  posterPath: string | null;
}

interface CatalogDescriptionRow {
  description: string;
  locale: string;
}

interface CatalogDetailsRows {
  titles: CatalogDetailsRow[];
  descriptions: CatalogDescriptionRow[];
  sourceLinks?: CatalogSourceRow[];
}

interface CatalogSourceRow {
  provider: string;
  entityType: string;
  externalId: string;
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

interface CatalogEpisodeRow {
  airDate: string | null;
  episodeNumber: number;
  id: string;
  seasonNumber: number;
  sourceTitle: string | null;
}

interface CatalogEpisodeListing {
  items: CatalogEpisodeRow[];
  type: CatalogItemType;
}

interface CatalogEpisodeWatchListing {
  type: CatalogItemType;
  watchedEpisodeIds: string[];
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
  CatalogDetailsRows,
  CatalogEpisodeListing,
  CatalogEpisodeRow,
  CatalogEpisodeWatchListing,
  CatalogReleaseRange,
  CatalogReleaseCursor,
  CatalogReleaseRow,
  CatalogTitleRow,
  CatalogUpcomingReleaseQuery,
  CatalogWatchlistRow
}
