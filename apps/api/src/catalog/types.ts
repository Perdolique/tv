import type { CatalogItemType } from '@tv/shared/catalog'

interface CatalogTitleRow {
  catalogItemId: string;
  isOriginal: boolean;
  locale: string;
  releaseYear: number | null;
  title: string;
  type: CatalogItemType;
}

export type { CatalogTitleRow }
