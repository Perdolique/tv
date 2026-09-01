type CatalogItemType = 'movie' | 'series'

interface CatalogTitleRow {
  catalogItemId: string;
  isOriginal: boolean;
  locale: string;
  releaseYear: number | null;
  title: string;
  type: CatalogItemType;
}

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

type CatalogErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'INTERNAL_ERROR'
  | 'INVALID_REQUEST'
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
  CatalogErrorCode,
  CatalogErrorEnvelope,
  CatalogSearchItem,
  CatalogSearchResponse,
  CatalogTitleRow
}
