import * as v from 'valibot'
import type { CatalogWatchlistItem } from './catalog.ts'

const DISCOVERY_PREVIEW_SIZE = 12
const DISCOVERY_PAGE_SIZE = 24

interface CatalogDiscoveryItem extends CatalogWatchlistItem {
  averageScore: number | null;
  ratingCount: number;
}

const collectionIdSchema = v.pipe(v.string(), v.uuid())
const positiveIntegerSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(1))
const discoveryKindSchema = v.picklist(['recent', 'top-rated'])

const discoveryItemSchema = v.object({
  id: collectionIdSchema,
  title: v.string(),
  titleLocale: v.string(),
  originalTitle: v.string(),
  originalTitleLocale: v.string(),
  releaseYear: v.nullable(v.pipe(v.number(), v.integer())),
  type: v.picklist(['movie', 'series']),
  posterUrl: v.nullable(v.pipe(v.string(), v.regex(/^\/(?:posters\/[a-z0-9-]+|api\/posters\/tv-[a-z0-9-]+-(?:movie|series)-[1-9]\d*-[a-f0-9]{64})\.webp$/u))),
  averageScore: v.nullable(v.pipe(v.number(), v.finite(), v.minValue(1), v.maxValue(10))),
  ratingCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0))
}) satisfies v.GenericSchema<CatalogDiscoveryItem>

const collectionSchema = v.object({
  id: collectionIdSchema,
  title: v.string(),
  description: v.nullable(v.string()),
  isFeatured: v.boolean(),
  revision: positiveIntegerSchema
})

const collectionInputSchema = v.strictObject({
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(160)),
  description: v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(2000))),
  isFeatured: v.boolean(),
  itemIds: v.pipe(v.array(collectionIdSchema), v.maxLength(500), v.check(ids => new Set(ids).size === ids.length, 'A title can appear only once in a collection.'))
})

const collectionUpdateSchema = v.strictObject({
  ...collectionInputSchema.entries,
  revision: positiveIntegerSchema
})

const collectionDeleteSchema = v.strictObject({ revision: positiveIntegerSchema })

const discoveryPageSchema = v.object({
  items: v.array(discoveryItemSchema),
  nextPage: v.nullable(positiveIntegerSchema)
})

const collectionPageSchema = v.object({
  collection: collectionSchema,
  ...discoveryPageSchema.entries
})

const collectionPreviewSchema = v.object({
  collection: collectionSchema,
  items: v.array(discoveryItemSchema)
})

const collectionPreviewsSchema = v.object({ collections: v.array(collectionPreviewSchema) })

const collectionEditorSchema = v.object({
  collection: collectionSchema,
  items: v.array(discoveryItemSchema)
})

const collectionListSchema = v.object({
  collections: v.array(collectionSchema),
  nextPage: v.nullable(positiveIntegerSchema)
})

const discoveryResponseSchema = v.object({
  recent: v.array(discoveryItemSchema),
  topRated: v.array(discoveryItemSchema),
  collections: v.array(collectionPreviewSchema)
})

type CatalogCollection = v.InferOutput<typeof collectionSchema>
type CatalogCollectionInput = v.InferOutput<typeof collectionInputSchema>
type CatalogCollectionUpdate = v.InferOutput<typeof collectionUpdateSchema>
type CatalogCollectionPreview = v.InferOutput<typeof collectionPreviewSchema>
type CatalogCollectionPage = v.InferOutput<typeof collectionPageSchema>
type CatalogDiscoveryPage = v.InferOutput<typeof discoveryPageSchema>
type CatalogDiscoveryKind = v.InferOutput<typeof discoveryKindSchema>

export {
  DISCOVERY_PAGE_SIZE, DISCOVERY_PREVIEW_SIZE,
  collectionIdSchema, collectionInputSchema, collectionUpdateSchema, collectionDeleteSchema,
  collectionSchema, collectionPageSchema, collectionPreviewsSchema, collectionListSchema, collectionEditorSchema,
  discoveryItemSchema, discoveryKindSchema, discoveryPageSchema, discoveryResponseSchema
}
export type {
  CatalogCollection, CatalogCollectionInput, CatalogCollectionUpdate, CatalogCollectionPreview,
  CatalogCollectionPage, CatalogDiscoveryItem, CatalogDiscoveryPage, CatalogDiscoveryKind
}
