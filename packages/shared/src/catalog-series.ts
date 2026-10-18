import * as v from 'valibot'

import {
  catalogEpisodeWatchSchema,
  catalogViewingSchema,
  catalogViewingSummarySchema,
  timeZoneSchema,
  viewingDateSchema
} from './catalog-viewings.ts'

const idSchema = v.pipe(v.string(), v.uuid())
const versionSchema = v.pipe(v.number(), v.integer(), v.minValue(0))

const contextEntries = {
  currentViewingId: v.nullable(idSchema),
  contextVersion: versionSchema
}

const requestEntries = {
  ...contextEntries,
  requestId: idSchema,
  timeZone: timeZoneSchema,
  viewingDate: v.optional(viewingDateSchema)
}

const catalogSeriesWatchSchema = v.strictObject(requestEntries)
const catalogSeriesBulkWatchSchema = v.strictObject(requestEntries)

const catalogSeriesUnwatchSchema = v.strictObject({
  requestId: idSchema,
  currentViewingId: idSchema,
  contextVersion: versionSchema,
  watchId: idSchema,
  confirmRatingRemoval: v.optional(v.boolean(), false)
})

const catalogSeriesCancelRewatchSchema = v.strictObject({
  requestId: idSchema,
  currentViewingId: idSchema,
  contextVersion: versionSchema
})

const catalogSeriesWatchesResponseSchema = v.strictObject({
  watches: v.array(catalogEpisodeWatchSchema),
  viewing: v.nullable(catalogViewingSchema),
  summary: catalogViewingSummarySchema
})

type CatalogSeriesWatchInput = v.InferOutput<typeof catalogSeriesWatchSchema>
type CatalogSeriesBulkWatchInput = v.InferOutput<typeof catalogSeriesBulkWatchSchema>
type CatalogSeriesUnwatchInput = v.InferOutput<typeof catalogSeriesUnwatchSchema>
type CatalogSeriesCancelRewatchInput = v.InferOutput<typeof catalogSeriesCancelRewatchSchema>
type CatalogSeriesEpisodeWatch = v.InferOutput<typeof catalogEpisodeWatchSchema>
type CatalogSeriesWatchesResponse = v.InferOutput<typeof catalogSeriesWatchesResponseSchema>

export { catalogSeriesBulkWatchSchema, catalogSeriesCancelRewatchSchema, catalogSeriesUnwatchSchema, catalogSeriesWatchSchema, catalogSeriesWatchesResponseSchema }
export type { CatalogSeriesBulkWatchInput, CatalogSeriesCancelRewatchInput, CatalogSeriesEpisodeWatch, CatalogSeriesUnwatchInput, CatalogSeriesWatchInput, CatalogSeriesWatchesResponse }

export { timeZoneSchema } from './catalog-viewings.ts'
