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
  CatalogErrorCode,
  CatalogErrorEnvelope,
  CatalogSearchItem,
  CatalogSearchResponse,
  CatalogItemType
}
