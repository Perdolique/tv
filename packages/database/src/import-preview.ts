interface SourceIdentity {
  provider: 'tmdb' | 'tvmaze';
  entityType: 'movie' | 'tv' | 'show' | 'episode';
  externalId: string;
}

interface SelectedShow {
  status: 'selected';
  id: number;
}

interface AbsentShow {
  status: 'verified_absent';
  reason: string;
}

interface MovieSelection {
  type: 'movie';
  tmdbId: number;
}

interface SeriesSelection {
  type: 'series';
  tmdbId: number;
  tvmaze: SelectedShow | AbsentShow;
}

type ImportSelection = MovieSelection | SeriesSelection

interface FieldOrigin {
  identity: SourceIdentity;
  field: string;
  locale: string | null;
}

interface SourceValue<Value> {
  value: Value;
  source: FieldOrigin;
}

interface ImportTranslation {
  locale: string;
  language: string;
  title: SourceValue<string | null>;
  description: SourceValue<string | null>;
}

interface ImportCard {
  identity: SourceIdentity;
  type: 'movie' | 'series';
  originalTitle: SourceValue<string>;
  originalLanguage: SourceValue<string>;
  releaseYear: SourceValue<number | null>;
  translations: ImportTranslation[];
  posterPath: SourceValue<string | null>;
}

interface ImportEpisode {
  identity: SourceIdentity;
  seasonNumber: SourceValue<number>;
  episodeNumber: SourceValue<number>;
  title: SourceValue<string | null>;
  airDate: SourceValue<string | null>;
}

interface ExternalIds {
  imdb: string | null;
  thetvdb: number | null;
}

interface ShowEvidence {
  identity: SourceIdentity;
  name: string | null;
  premiered: string | null;
  language: string | null;
  externalIds: ExternalIds;
  seasonRestriction: number | null;
}

interface IdentityEvidence {
  tmdb: ExternalIds | null;
  tvmaze: ShowEvidence | null;
  matchingIds: ('imdb' | 'thetvdb')[];
}

interface PreviewIssue {
  code: string;
  message: string;
}

interface PreviewAdditions {
  catalogItemId: string | null;
  createItem: boolean;
  episodeExternalIds: string[];
  sourceLinks: SourceIdentity[];
}

interface PreviewPoster {
  sourceUrl: string;
  sourceHash: string;
  sha256: string;
  contentType: 'image/webp';
  width: number;
  height: number;
  byteLength: number;
}

type ImportFieldName = 'title' | 'description' | 'releaseYear' | 'posterPath' | 'seasonNumber' | 'episodeNumber' | 'sourceTitle' | 'airDate'
type PreviewChangeAction = 'add' | 'update' | 'unchanged' | 'preserve_manual' | 'retain_missing'

interface PreviewChange {
  target: 'item' | 'title' | 'description' | 'episode';
  field: ImportFieldName;
  locale: string | null;
  episodeExternalId: string | null;
  action: PreviewChangeAction;
  before: string | number | null;
  after: string | number | null;
  sourceValue: string | number | null;
  sourceHash: string | null;
  source: FieldOrigin;
}

// Only normalized, reviewed data belongs here. Provider response dumps are not stored.
interface ImportPreviewData {
  version: 2;
  card: ImportCard | null;
  episodes: ImportEpisode[];
  evidence: IdentityEvidence;
  warnings: PreviewIssue[];
  errors: PreviewIssue[];
  additions: PreviewAdditions;
  changes: PreviewChange[];
  poster: PreviewPoster | null;
}

export type {
  ExternalIds,
  FieldOrigin,
  IdentityEvidence,
  ImportCard,
  ImportEpisode,
  ImportFieldName,
  ImportPreviewData,
  ImportSelection,
  ImportTranslation,
  PreviewAdditions,
  PreviewChange,
  PreviewChangeAction,
  PreviewIssue,
  PreviewPoster,
  ShowEvidence,
  SourceIdentity,
  SourceValue
}
