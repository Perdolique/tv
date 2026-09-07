import type { CatalogDetailsResponse, CatalogSearchResponse } from '@tv/shared/catalog'
import * as v from 'valibot'

const catalogSearchItemSchema = v.object({
  id: v.string(),
  originalTitle: v.string(),
  originalTitleLocale: v.string(),
  releaseYear: v.nullable(v.pipe(v.number(), v.integer())),
  title: v.string(),
  titleLocale: v.string(),
  type: v.picklist(['movie', 'series'])
})

const catalogSearchResponseSchema = v.object({
  items: v.array(catalogSearchItemSchema)
}) satisfies v.GenericSchema<CatalogSearchResponse>

const catalogDetailsResponseSchema = v.object({
  item: v.object({
    ...catalogSearchItemSchema.entries,
    description: v.nullable(v.string()),
    descriptionLocale: v.nullable(v.string()),
    posterUrl: v.nullable(v.pipe(v.string(), v.regex(/^\/posters\/[a-z0-9-]+\.webp$/u)))
  })
}) satisfies v.GenericSchema<CatalogDetailsResponse>

function normalizeSearchQuery(value: unknown): string {
  return typeof value === 'string' ? value.trim().normalize('NFC') : ''
}

export { catalogDetailsResponseSchema, catalogSearchResponseSchema, normalizeSearchQuery }
