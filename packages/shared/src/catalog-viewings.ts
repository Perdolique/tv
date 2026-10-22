import * as v from 'valibot'

function isCalendarDate(value: string): boolean {
  const hasDateFormat = /^\d{4}-\d{2}-\d{2}$/u.test(value)

  if (!hasDateFormat) { return false }

  const hasZeroYear = value.startsWith('0000')

  if (hasZeroYear) { return false }

  const timestampValue = `${value}T00:00:00.000Z`
  const date = new Date(timestampValue)
  const timestamp = date.getTime()

  if (!Number.isFinite(timestamp)) { return false }

  const isoDate = date.toISOString()
  const normalized = isoDate.slice(0, 10)

  return normalized === value
}

const viewingDateSchema = v.pipe(v.string('Choose a viewing date.'), v.check(isCalendarDate, 'Use a valid calendar date.'))
const nullableDateSchema = v.nullable(viewingDateSchema)
const versionSchema = v.pipe(v.number(), v.integer(), v.minValue(0))
const revisionSchema = v.pipe(v.number(), v.integer(), v.minValue(1))
const viewingIdSchema = v.pipe(v.string(), v.uuid())
const scoreSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10))
const catalogViewingStatusSchema = v.picklist(['watching', 'paused', 'dropped', 'completed'])

type CatalogViewingStatus = v.InferOutput<typeof catalogViewingStatusSchema>

const timeZoneSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(100), v.check(value => {
  const hasValidCharacters = /^[A-Za-z][A-Za-z0-9_+./-]*$/u.test(value)

  if (!hasValidCharacters) { return false }

  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: value })

    formatter.format()

    return true
  } catch {
    return false
  }
}, 'Use a valid time zone.'))

interface CatalogViewingDates {
  startedOn: string | null;
  completedOn: string | null;
}

interface CatalogViewingDraft extends CatalogViewingDates {
  status: CatalogViewingStatus;
}

function hasValidDates(input: CatalogViewingDraft): boolean {
  if (input.status !== 'completed') {
    return input.startedOn !== null && input.completedOn === null
  }

  return input.completedOn !== null && (input.startedOn === null || input.startedOn <= input.completedOn)
}

const contextEntries = {
  currentViewingId: v.nullable(viewingIdSchema),
  contextVersion: versionSchema
}

const dateEntries = {
  status: catalogViewingStatusSchema,
  startedOn: nullableDateSchema,
  completedOn: nullableDateSchema
}

const catalogViewingCreateSchema = v.pipe(
  v.strictObject({
    requestId: viewingIdSchema,
    mode: v.picklist(['current', 'history']),
    ...contextEntries,
    ...dateEntries,
    status: v.picklist(['watching', 'completed']),
    completeCurrentOn: v.optional(viewingDateSchema)
  }),
  v.forward(v.check(input => hasValidDates(input), 'Choose the required dates, with completion on or after the start.'), ['completedOn'])
)

const catalogViewingUpdateSchema = v.pipe(
  v.strictObject({
    requestId: viewingIdSchema,
    revision: revisionSchema,
    ...contextEntries,
    ...dateEntries
  }),
  v.forward(v.check(input => hasValidDates(input), 'Choose the required dates, with completion on or after the start.'), ['completedOn'])
)

const catalogViewingDeleteSchema = v.strictObject({
  requestId: viewingIdSchema,
  revision: revisionSchema
})

const ratingEntries = {
  requestId: viewingIdSchema,
  ...contextEntries,
  timeZone: timeZoneSchema,
  viewingDate: v.optional(viewingDateSchema)
}

const catalogRatingSaveSchema = v.strictObject({
  ...ratingEntries,
  score: scoreSchema
})

const catalogRatingRemoveSchema = v.strictObject(ratingEntries)

const historicalEntries = {
  requestId: viewingIdSchema,
  revision: revisionSchema,
  timeZone: timeZoneSchema
}

const catalogHistoricalRatingSaveSchema = v.strictObject({
  ...historicalEntries,
  score: scoreSchema
})

const catalogHistoricalRatingRemoveSchema = v.strictObject(historicalEntries)

const catalogViewingSchema = v.strictObject({
  id: viewingIdSchema,
  catalogItemId: viewingIdSchema,
  ...dateEntries,
  recordedAt: v.pipe(v.string(), v.isoTimestamp()),
  revision: revisionSchema,
  score: v.nullable(scoreSchema),
  isRewatch: v.boolean(),
  canCancelRewatch: v.boolean()
})

const catalogViewingSummarySchema = v.strictObject({
  completedCount: versionSchema,
  ...contextEntries,
  currentViewingScore: v.nullable(scoreSchema),
  currentVoteScore: v.nullable(scoreSchema)
})

const catalogEpisodeWatchSchema = v.strictObject({
  id: viewingIdSchema,
  catalogEpisodeId: viewingIdSchema,
  viewingId: viewingIdSchema,
  markedAt: v.pipe(v.string(), v.isoTimestamp())
})

const catalogRatingMutationResponseSchema = v.strictObject({
  score: v.nullable(scoreSchema),
  summary: catalogViewingSummarySchema,
  viewing: v.nullable(catalogViewingSchema),
  watches: v.optional(v.array(catalogEpisodeWatchSchema))
})

const catalogEpisodeRatingsResponseSchema = v.strictObject({
  items: v.array(v.strictObject({
    episodeId: viewingIdSchema,
    score: v.nullable(scoreSchema)
  })),

  viewing: v.nullable(catalogViewingSchema),
  summary: catalogViewingSummarySchema
})

const catalogViewingsResponseSchema = v.strictObject({
  items: v.array(catalogViewingSchema),
  summary: catalogViewingSummarySchema,
  nextCursor: v.nullable(v.pipe(v.string(), v.minLength(1)))
})

const catalogViewingResponseSchema = v.strictObject({ viewing: catalogViewingSchema })

const catalogViewingMutationResponseSchema = v.strictObject({
  viewing: catalogViewingSchema,
  summary: catalogViewingSummarySchema
})

const catalogViewingDeletionResponseSchema = v.strictObject({ summary: catalogViewingSummarySchema })

type CatalogViewing = v.InferOutput<typeof catalogViewingSchema>
type CatalogViewingSummary = v.InferOutput<typeof catalogViewingSummarySchema>
type CatalogViewingsResponse = v.InferOutput<typeof catalogViewingsResponseSchema>
type CatalogViewingCreateInput = v.InferOutput<typeof catalogViewingCreateSchema>
type CatalogViewingUpdateInput = v.InferOutput<typeof catalogViewingUpdateSchema>
type CatalogViewingDeleteInput = v.InferOutput<typeof catalogViewingDeleteSchema>
type CatalogViewingMutationResponse = v.InferOutput<typeof catalogViewingMutationResponseSchema>
type CatalogRatingSaveInput = v.InferOutput<typeof catalogRatingSaveSchema>
type CatalogRatingRemoveInput = v.InferOutput<typeof catalogRatingRemoveSchema>
type CatalogHistoricalRatingSaveInput = v.InferOutput<typeof catalogHistoricalRatingSaveSchema>
type CatalogHistoricalRatingRemoveInput = v.InferOutput<typeof catalogHistoricalRatingRemoveSchema>
type CatalogRatingMutationResponse = v.InferOutput<typeof catalogRatingMutationResponseSchema>

export {
  catalogEpisodeRatingsResponseSchema,
  catalogEpisodeWatchSchema,
  catalogHistoricalRatingRemoveSchema,
  catalogHistoricalRatingSaveSchema,
  catalogRatingMutationResponseSchema,
  catalogRatingRemoveSchema,
  catalogRatingSaveSchema,
  catalogViewingCreateSchema,
  catalogViewingDeleteSchema,
  catalogViewingDeletionResponseSchema,
  catalogViewingMutationResponseSchema,
  catalogViewingResponseSchema,
  catalogViewingSchema,
  catalogViewingSummarySchema,
  catalogViewingStatusSchema,
  catalogViewingUpdateSchema,
  catalogViewingsResponseSchema,
  timeZoneSchema,
  viewingDateSchema
}

export type {
  CatalogHistoricalRatingRemoveInput,
  CatalogHistoricalRatingSaveInput,
  CatalogRatingMutationResponse,
  CatalogRatingRemoveInput,
  CatalogRatingSaveInput,
  CatalogViewing,
  CatalogViewingDates,
  CatalogViewingDraft,
  CatalogViewingSummary,
  CatalogViewingStatus,
  CatalogViewingsResponse,
  CatalogViewingCreateInput,
  CatalogViewingDeleteInput,
  CatalogViewingMutationResponse,
  CatalogViewingUpdateInput
}
