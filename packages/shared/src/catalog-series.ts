import * as v from 'valibot'

const idSchema = v.pipe(v.string(), v.uuid())
const versionSchema = v.pipe(v.number(), v.integer(), v.minValue(0))

const timeZoneSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(100), v.check(value => {
  if (!/^[A-Za-z][A-Za-z0-9_+./-]*$/u.test(value)) { return false }

  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: value })

    formatter.format()

    return true
  } catch {
    return false
  }
}, 'Use a valid time zone.'))

const contextEntries = {
  currentViewingId: v.nullable(idSchema),
  contextVersion: versionSchema
}

const requestEntries = {
  ...contextEntries,
  requestId: idSchema,
  timeZone: timeZoneSchema
}

const catalogSeriesWatchSchema = v.strictObject(requestEntries)
const catalogSeriesBulkWatchSchema = v.strictObject(requestEntries)

const catalogSeriesUnwatchSchema = v.strictObject({
  currentViewingId: idSchema,
  contextVersion: versionSchema,
  watchId: idSchema
})

const catalogSeriesRewatchSchema = v.strictObject(requestEntries)

const catalogSeriesCancelRewatchSchema = v.strictObject({
  currentViewingId: idSchema,
  contextVersion: versionSchema
})

const catalogSeriesViewingSchema = v.strictObject({
  id: idSchema,
  catalogItemId: idSchema,
  status: v.picklist(['watching', 'paused', 'completed']),
  isRewatch: v.boolean(),
  recordedAt: v.pipe(v.string(), v.isoTimestamp()),
  revision: v.pipe(v.number(), v.integer(), v.minValue(1))
})

const catalogSeriesEpisodeWatchSchema = v.strictObject({
  id: idSchema,
  catalogEpisodeId: idSchema,
  viewingId: idSchema,
  markedAt: v.pipe(v.string(), v.isoTimestamp())
})

const catalogSeriesWatchesResponseSchema = v.strictObject({
  watchedEpisodeIds: v.array(idSchema),
  watches: v.array(catalogSeriesEpisodeWatchSchema),
  currentViewing: v.nullable(catalogSeriesViewingSchema),
  contextVersion: versionSchema
})

type CatalogSeriesWatchInput = v.InferOutput<typeof catalogSeriesWatchSchema>
type CatalogSeriesBulkWatchInput = v.InferOutput<typeof catalogSeriesBulkWatchSchema>
type CatalogSeriesUnwatchInput = v.InferOutput<typeof catalogSeriesUnwatchSchema>
type CatalogSeriesCancelRewatchInput = v.InferOutput<typeof catalogSeriesCancelRewatchSchema>
type CatalogSeriesRewatchInput = v.InferOutput<typeof catalogSeriesRewatchSchema>
type CatalogSeriesViewing = v.InferOutput<typeof catalogSeriesViewingSchema>
type CatalogSeriesEpisodeWatch = v.InferOutput<typeof catalogSeriesEpisodeWatchSchema>
type CatalogSeriesWatchesResponse = v.InferOutput<typeof catalogSeriesWatchesResponseSchema>

export {
  catalogSeriesBulkWatchSchema,
  catalogSeriesCancelRewatchSchema,
  catalogSeriesRewatchSchema,
  catalogSeriesUnwatchSchema,
  catalogSeriesWatchSchema,
  catalogSeriesWatchesResponseSchema,
  timeZoneSchema
}

export type {
  CatalogSeriesBulkWatchInput,
  CatalogSeriesCancelRewatchInput,
  CatalogSeriesEpisodeWatch,
  CatalogSeriesRewatchInput,
  CatalogSeriesUnwatchInput,
  CatalogSeriesViewing,
  CatalogSeriesWatchInput,
  CatalogSeriesWatchesResponse
}
