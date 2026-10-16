import * as v from 'valibot'

function isCalendarDate(value: string): boolean {
  const hasDateFormat = /^\d{4}-\d{2}-\d{2}$/u.test(value)

  if (!hasDateFormat) { return false }

  const hasZeroYear = value.startsWith('0000')

  if (hasZeroYear) {
    return false
  }

  const timestampValue = `${value}T00:00:00.000Z`
  const date = new Date(timestampValue)
  const timestamp = date.getTime()
  const hasFiniteTimestamp = Number.isFinite(timestamp)

  if (!hasFiniteTimestamp) { return false }

  const isoDate = date.toISOString()
  const normalized = isoDate.slice(0, 10)

  return normalized === value
}

const calendarDateSchema = v.nullable(v.pipe(v.string(), v.check(isCalendarDate, 'Use a valid calendar date.')))
const versionSchema = v.pipe(v.number(), v.integer(), v.minValue(0))
const revisionSchema = v.pipe(v.number(), v.integer(), v.minValue(1))
const viewingIdSchema = v.pipe(v.string(), v.uuid())
const scoreSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10))

const dateEntries = {
  startedOn: calendarDateSchema,
  completedOn: calendarDateSchema
}

interface CatalogViewingDraft extends CatalogViewingDates {
  score?: number;
}

interface CatalogViewingDates {
  startedOn: string | null;
  completedOn: string | null;
}

function hasOrderedDates(input: CatalogViewingDates): boolean {
  return input.startedOn === null || input.completedOn === null || input.startedOn <= input.completedOn
}

const creationEntries = {
  requestId: viewingIdSchema,
  score: v.optional(scoreSchema),
  startedOn: v.optional(calendarDateSchema, null),
  completedOn: v.optional(calendarDateSchema, null)
}

const catalogViewingCreateSchema = v.pipe(
  v.variant('mode', [
    v.strictObject({
      ...creationEntries,
      mode: v.literal('current'),
      contextVersion: versionSchema
    }),
    v.strictObject({
      ...creationEntries,
      mode: v.literal('history')
    })
  ]),
  v.forward(v.check(input => hasOrderedDates(input), 'Completion must be on or after the start date.'), ['completedOn'])
)

const catalogViewingUpdateSchema = v.pipe(
  v.strictObject({
    ...dateEntries,
    revision: revisionSchema
  }),
  v.forward(v.check(input => hasOrderedDates(input), 'Completion must be on or after the start date.'), ['completedOn'])
)

const catalogViewingDeleteSchema = v.strictObject({ revision: revisionSchema })

const catalogMovieRatingContextEntries = {
  currentViewingId: v.nullable(viewingIdSchema),
  contextVersion: versionSchema
}

const catalogMovieRatingSaveSchema = v.strictObject({
  ...catalogMovieRatingContextEntries,
  score: scoreSchema
})

const catalogMovieRatingRemoveSchema = v.strictObject(catalogMovieRatingContextEntries)

const catalogViewingRatingSaveSchema = v.strictObject({
  revision: revisionSchema,
  score: scoreSchema
})

const catalogViewingRatingRemoveSchema = catalogViewingDeleteSchema

const catalogViewingSchema = v.strictObject({
  id: viewingIdSchema,
  catalogItemId: viewingIdSchema,
  status: v.literal('completed'),
  ...dateEntries,
  recordedAt: v.pipe(v.string(), v.isoTimestamp()),
  revision: revisionSchema,
  score: v.nullable(scoreSchema)
})

const catalogMovieViewingSummarySchema = v.strictObject({
  completedCount: versionSchema,
  currentViewingId: v.nullable(viewingIdSchema),
  contextVersion: versionSchema,
  currentViewingScore: v.nullable(scoreSchema),
  currentVoteScore: v.nullable(scoreSchema)
})

const catalogMovieRatingResponseSchema = v.strictObject({
  score: v.nullable(scoreSchema),
  summary: catalogMovieViewingSummarySchema,
  viewing: v.nullable(catalogViewingSchema)
})

const catalogMovieViewingsResponseSchema = v.strictObject({
  items: v.array(catalogViewingSchema),
  summary: catalogMovieViewingSummarySchema,
  nextCursor: v.nullable(v.pipe(v.string(), v.minLength(1)))
})

const catalogViewingResponseSchema = v.strictObject({ viewing: catalogViewingSchema })

const catalogViewingMutationResponseSchema = v.strictObject({
  viewing: catalogViewingSchema,
  summary: catalogMovieViewingSummarySchema
})

const catalogViewingDeletionResponseSchema = v.strictObject({ summary: catalogMovieViewingSummarySchema })

type CatalogViewing = v.InferOutput<typeof catalogViewingSchema>
type CatalogMovieViewingSummary = v.InferOutput<typeof catalogMovieViewingSummarySchema>
type CatalogMovieViewingsResponse = v.InferOutput<typeof catalogMovieViewingsResponseSchema>
type CatalogViewingCreateInput = v.InferOutput<typeof catalogViewingCreateSchema>
type CatalogViewingUpdateInput = v.InferOutput<typeof catalogViewingUpdateSchema>
type CatalogViewingMutationResponse = v.InferOutput<typeof catalogViewingMutationResponseSchema>
type CatalogMovieRatingContext = v.InferOutput<typeof catalogMovieRatingRemoveSchema>
type CatalogMovieRatingResponse = v.InferOutput<typeof catalogMovieRatingResponseSchema>

export {
  catalogMovieRatingSaveSchema,
  catalogMovieRatingRemoveSchema,
  catalogMovieRatingResponseSchema,
  catalogViewingRatingSaveSchema,
  catalogViewingRatingRemoveSchema,
  catalogMovieViewingsResponseSchema,
  catalogViewingCreateSchema,
  catalogViewingDeleteSchema,
  catalogViewingDeletionResponseSchema,
  catalogViewingMutationResponseSchema,
  catalogViewingResponseSchema,
  catalogViewingUpdateSchema
}

export type {
  CatalogMovieRatingContext,
  CatalogMovieRatingResponse,
  CatalogMovieViewingSummary,
  CatalogMovieViewingsResponse,
  CatalogViewing,
  CatalogViewingDates,
  CatalogViewingDraft,
  CatalogViewingCreateInput,
  CatalogViewingMutationResponse,
  CatalogViewingUpdateInput
}
