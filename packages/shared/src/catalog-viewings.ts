import * as v from 'valibot'

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || value.startsWith('0000')) {
    return false
  }

  const date = new Date(`${value}T00:00:00.000Z`)
  const timestamp = date.getTime()

  if (!Number.isFinite(timestamp)) { return false }

  const isoDate = date.toISOString()
  const normalized = isoDate.slice(0, 10)

  return normalized === value
}

const calendarDateSchema = v.nullable(v.pipe(v.string(), v.check(isCalendarDate, 'Use a valid calendar date.')))
const versionSchema = v.pipe(v.number(), v.integer(), v.minValue(0))
const revisionSchema = v.pipe(v.number(), v.integer(), v.minValue(1))
const viewingIdSchema = v.pipe(v.string(), v.uuid())

const dateEntries = {
  startedOn: calendarDateSchema,
  completedOn: calendarDateSchema
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

const catalogViewingSchema = v.strictObject({
  id: viewingIdSchema,
  catalogItemId: viewingIdSchema,
  status: v.literal('completed'),
  ...dateEntries,
  recordedAt: v.pipe(v.string(), v.isoTimestamp()),
  revision: revisionSchema
})

const catalogMovieViewingSummarySchema = v.strictObject({
  completedCount: versionSchema,
  currentViewingId: v.nullable(viewingIdSchema),
  contextVersion: versionSchema
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

export {
  catalogMovieViewingsResponseSchema,
  catalogViewingCreateSchema,
  catalogViewingDeleteSchema,
  catalogViewingDeletionResponseSchema,
  catalogViewingMutationResponseSchema,
  catalogViewingResponseSchema,
  catalogViewingUpdateSchema
}

export type {
  CatalogMovieViewingSummary,
  CatalogMovieViewingsResponse,
  CatalogViewing,
  CatalogViewingDates,
  CatalogViewingCreateInput,
  CatalogViewingMutationResponse,
  CatalogViewingUpdateInput
}
