type ImportTitleType = 'movie' | 'series'

interface ImportMovieSelection {
  type: 'movie';
  tmdbId: number;
}

interface ImportSelectedShow {
  status: 'selected';
  id: number;
}

interface ImportAbsentShow {
  status: 'verified_absent';
  reason: string;
}

interface ImportSeriesSelection {
  type: 'series';
  tmdbId: number;
  tvmaze: ImportSelectedShow | ImportAbsentShow;
}

type ImportSelection = ImportMovieSelection | ImportSeriesSelection

interface ImportSearchItem {
  id: number;
  type: ImportTitleType;
  title: string;
  originalTitle: string;
  posterUrl: string | null;
  year: number | null;
}

interface ImportSearchResponse {
  items: ImportSearchItem[];
  nextPage: number | null;
}

interface ImportShowItem {
  id: number;
  title: string;
  year: number | null;
  imdbId: string | null;
  thetvdbId: number | null;
}

interface ImportShowSearchResponse {
  items: ImportShowItem[];
}

interface ImportSourceIdentity {
  provider: 'tmdb' | 'tvmaze';
  entityType: 'movie' | 'tv' | 'show' | 'episode';
  externalId: string;
}

interface ImportFieldOrigin {
  identity: ImportSourceIdentity;
  field: string;
  locale: string | null;
}

interface ImportValue<Value> {
  value: Value;
  source: ImportFieldOrigin;
}

interface ImportTranslation {
  locale: string;
  language: string;
  title: ImportValue<string | null>;
  description: ImportValue<string | null>;
}

interface ImportCard {
  identity: ImportSourceIdentity;
  type: ImportTitleType;
  originalTitle: ImportValue<string>;
  originalLanguage: ImportValue<string>;
  releaseYear: ImportValue<number | null>;
  translations: ImportTranslation[];
  posterPath: ImportValue<string | null>;
}

interface ImportEpisode {
  identity: ImportSourceIdentity;
  seasonNumber: ImportValue<number>;
  episodeNumber: ImportValue<number>;
  title: ImportValue<string | null>;
  airDate: ImportValue<string | null>;
}

interface ImportExternalIds {
  imdb: string | null;
  thetvdb: number | null;
}

interface ImportShowEvidence {
  identity: ImportSourceIdentity;
  name: string | null;
  premiered: string | null;
  language: string | null;
  externalIds: ImportExternalIds;
  seasonRestriction: number | null;
}

interface ImportEvidence {
  tmdb: ImportExternalIds | null;
  tvmaze: ImportShowEvidence | null;
  matchingIds: ('imdb' | 'thetvdb')[];
}

interface ImportIssue {
  code: string;
  message: string;
}

interface ImportAdditions {
  catalogItemId: string | null;
  createItem: boolean;
  episodeExternalIds: string[];
  sourceLinks: ImportSourceIdentity[];
}

type ImportFieldName = 'title' | 'description' | 'releaseYear' | 'posterPath' | 'seasonNumber' | 'episodeNumber' | 'sourceTitle' | 'airDate'
type ImportChangeAction = 'add' | 'update' | 'unchanged' | 'preserve_manual' | 'retain_missing'

interface ImportChange {
  target: 'item' | 'title' | 'description' | 'episode';
  field: ImportFieldName;
  locale: string | null;
  episodeExternalId: string | null;
  action: ImportChangeAction;
  before: string | number | null;
  after: string | number | null;
  sourceValue: string | number | null;
  sourceHash: string | null;
  source: ImportFieldOrigin;
}

interface ImportPoster {
  sourceUrl: string;
  sourceHash: string;
  sha256: string;
  contentType: 'image/webp';
  width: number;
  height: number;
  byteLength: number;
}

// Storage and HTTP share normalized, reviewed data. Provider response dumps do not belong here.
interface ImportPreviewData {
  version: 2;
  card: ImportCard | null;
  episodes: ImportEpisode[];
  evidence: ImportEvidence;
  warnings: ImportIssue[];
  errors: ImportIssue[];
  additions: ImportAdditions;
  changes: ImportChange[];
  poster: ImportPoster | null;
}

interface ImportCatalogMatch {
  id: string;
  title: string;
  year: number | null;
  type: ImportTitleType;
  kind: 'exact_source' | 'possible_title';
}

interface ImportPreviewView {
  id: string;
  status: 'ready' | 'blocked';
  selection: ImportSelection;
  data: ImportPreviewData;
  createdAt: string;
  expiresAt: string;
  posterUrl: string | null;
  matches: ImportCatalogMatch[];
}

interface ImportPreviewResponse {
  preview: ImportPreviewView;
}

interface ImportSourceFailureResponse {
  status: 'source_failure';
  issue: ImportIssue;
  retryAfterSeconds: number | null;
}

interface ImportApplySummary {
  catalogItemId: string;
  createdItem: boolean;
  createdEpisodes: number;
  linkedSources: number;
  changedFields: number;
  updatedFields: number;
  preservedFields: number;
  posterPath: string | null;
}

interface ImportOperationView {
  id: string;
  previewId: string;
  operatorId: string;
  actor: string;
  selection: ImportSelection;
  title: string;
  status: 'pending' | 'succeeded' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  result: ImportApplySummary | null;
  issue: ImportIssue | null;
  canRetry: boolean;
}

interface ImportApplyResponse {
  status: 'succeeded' | 'pending' | 'failed' | 'blocked';
  operation: ImportOperationView | null;
  issue: ImportIssue | null;
}

interface ImportHistoryResponse {
  items: ImportOperationView[];
  nextCursor: string | null;
}

export type {
  ImportAdditions,
  ImportApplyResponse,
  ImportApplySummary,
  ImportCard,
  ImportCatalogMatch,
  ImportChange,
  ImportChangeAction,
  ImportEpisode,
  ImportEvidence,
  ImportExternalIds,
  ImportFieldName,
  ImportFieldOrigin,
  ImportHistoryResponse,
  ImportIssue,
  ImportOperationView,
  ImportPoster,
  ImportPreviewData,
  ImportPreviewResponse,
  ImportPreviewView,
  ImportSearchItem,
  ImportSearchResponse,
  ImportSelection,
  ImportShowEvidence,
  ImportShowItem,
  ImportShowSearchResponse,
  ImportSourceFailureResponse,
  ImportSourceIdentity,
  ImportTranslation,
  ImportValue
}
