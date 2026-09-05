import type { CatalogSearchResponse } from '@tv/shared/catalog'
import * as v from 'valibot'

const catalogSearchResponseSchema = v.object({
  items: v.array(v.object({
    id: v.string(),
    originalTitle: v.string(),
    originalTitleLocale: v.string(),
    releaseYear: v.nullable(v.pipe(v.number(), v.integer())),
    title: v.string(),
    titleLocale: v.string(),
    type: v.picklist(['movie', 'series'])
  }))
}) satisfies v.GenericSchema<CatalogSearchResponse>

function normalizeSearchQuery(value: unknown): string {
  return typeof value === 'string' ? value.trim().normalize('NFC') : ''
}

export { catalogSearchResponseSchema, normalizeSearchQuery }
