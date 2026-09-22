type CatalogItemType = 'movie' | 'series'

interface CatalogSearchItem {
  id: string;
  originalTitle: string;
  originalTitleLocale: string;
  releaseYear: number | null;
  title: string;
  titleLocale: string;
  type: CatalogItemType;
}

interface CatalogSearchResponse {
  items: CatalogSearchItem[];
}

interface CatalogDetailsItem extends CatalogSearchItem {
  description: string | null;
  descriptionLocale: string | null;
  posterUrl: string | null;
}

interface CatalogDetailsResponse {
  item: CatalogDetailsItem;
}

interface CatalogFollowResponse {
  followed: boolean;
}

interface CatalogWatchedResponse {
  watched: boolean;
}

interface CatalogEpisode {
  airDate: string | null;
  episodeNumber: number;
  id: string;
  seasonNumber: number;
  sourceTitle: string | null;
}

interface CatalogEpisodesResponse {
  items: CatalogEpisode[];
}

interface CatalogEpisodeWatchesResponse {
  watchedEpisodeIds: string[];
}

interface CatalogWatchlistItem extends CatalogSearchItem {
  posterUrl: string | null;
}

interface CatalogWatchlistResponse {
  items: CatalogWatchlistItem[];
}

interface CatalogViewingHistoryItem extends CatalogWatchlistItem {
  kind: 'movie' | 'episode';
  entryId: string;
  markedAt: string;
  episodeNumber: number | null;
  seasonNumber: number | null;
  sourceTitle: string | null;
}

interface CatalogViewingHistoryResponse {
  items: CatalogViewingHistoryItem[];
  nextCursor: string | null;
}

interface CatalogViewingSeries extends CatalogWatchlistItem {
  watchedEpisodeCount: number;
}

interface CatalogViewingSummaryResponse {
  watchedMovieCount: number;
  watchedEpisodeCount: number;
  series: CatalogViewingSeries[];
}

interface CatalogReleaseItem extends CatalogWatchlistItem {
  episodeNumber: number | null;
  releaseDate: string;
  releaseId: string;
  seasonNumber: number | null;
}

interface CatalogReleasesResponse {
  items: CatalogReleaseItem[];
}

interface CatalogUpcomingReleasesResponse {
  items: CatalogReleaseItem[];
  nextCursor: string | null;
}

type CatalogErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'INTERNAL_ERROR'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'SERVICE_UNAVAILABLE'

interface CatalogErrorBody {
  code: CatalogErrorCode;
  fields?: Record<string, string>;
  message: string;
}

interface CatalogErrorEnvelope {
  error: CatalogErrorBody;
}

export type {
  CatalogDetailsItem,
  CatalogDetailsResponse,
  CatalogEpisode,
  CatalogEpisodesResponse,
  CatalogEpisodeWatchesResponse,
  CatalogErrorCode,
  CatalogErrorEnvelope,
  CatalogFollowResponse,
  CatalogReleaseItem,
  CatalogReleasesResponse,
  CatalogSearchItem,
  CatalogSearchResponse,
  CatalogItemType,
  CatalogUpcomingReleasesResponse,
  CatalogViewingHistoryItem,
  CatalogViewingHistoryResponse,
  CatalogViewingSeries,
  CatalogViewingSummaryResponse,
  CatalogWatchedResponse,
  CatalogWatchlistItem,
  CatalogWatchlistResponse
}
