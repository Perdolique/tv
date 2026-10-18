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

  if (!hasFiniteTimestamp) {
    return false
  }

  const isoDate = date.toISOString()
  const normalized = isoDate.slice(0, 10)

  return normalized === value
}

function isTimeZone(value: string): boolean {
  const hasValidCharacters = /^[A-Za-z][A-Za-z_\d+/-]*$/u.test(value)

  if (!hasValidCharacters) {
    return false
  }

  try {
    const formatter = new Intl.DateTimeFormat('en', { timeZone: value })
    const options = formatter.resolvedOptions()

    return options.timeZone !== ''
  } catch {
    return false
  }
}

const catalogTimeZoneSchema = v.pipe(
  v.string(),
  v.maxLength(100),
  v.check(isTimeZone, 'Use a valid IANA time zone.'),
  v.transform(value => {
    const formatter = new Intl.DateTimeFormat('en', { timeZone: value })
    const options = formatter.resolvedOptions()

    return options.timeZone
  })
)

const idSchema = v.pipe(v.string(), v.uuid())
const dateSchema = v.pipe(v.string(), v.check(isCalendarDate, 'Use a valid calendar date.'))
const timestampSchema = v.pipe(v.string(), v.isoTimestamp())
const positiveIntegerSchema = v.pipe(v.number(), v.integer(), v.minValue(1))
const scoreSchema = v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10)))
const cursorSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(4096))

const catalogTimelineQuerySchema = v.strictObject({
  timeZone: catalogTimeZoneSchema,
  cursor: v.optional(cursorSchema)
})

const eventEntries = {
  id: idSchema,
  occurredAt: timestampSchema
}

const episodeRangeSchema = v.strictObject({
  firstEpisodeNumber: positiveIntegerSchema,
  lastEpisodeNumber: positiveIntegerSchema
})

const episodeSeasonSchema = v.strictObject({
  seasonNumber: positiveIntegerSchema,
  ranges: v.array(episodeRangeSchema)
})

const catalogTimelineItemSchema = v.variant('kind', [
  v.strictObject({
    ...eventEntries,
    kind: v.literal('movie_viewing'),
    viewingId: idSchema,
    startedOn: v.nullable(dateSchema),
    completedOn: dateSchema,
    score: scoreSchema
  }),
  v.strictObject({
    ...eventEntries,
    id: v.pipe(v.string(), v.regex(/^episode_group:[0-9a-f-]{36}:\d{4}-\d{2}-\d{2}$/u)),
    kind: v.literal('episode_group'),
    viewingId: idSchema,
    localDate: dateSchema,
    totalCount: positiveIntegerSchema,
    seasons: v.array(episodeSeasonSchema)
  }),
  v.strictObject({
    ...eventEntries,
    kind: v.picklist(['series_started', 'rewatch_started']),
    viewingId: idSchema,
    startedOn: dateSchema,
    score: scoreSchema
  }),
  v.strictObject({
    ...eventEntries,
    kind: v.literal('series_completed'),
    viewingId: idSchema,
    completedOn: dateSchema
  }),
  v.strictObject({
    ...eventEntries,
    kind: v.picklist(['season_completed', 'available_completed']),
    viewingId: idSchema,
    seasonNumber: v.nullable(positiveIntegerSchema),
    totalCount: positiveIntegerSchema
  })
])

const catalogTimelineResponseSchema = v.strictObject({
  items: v.array(catalogTimelineItemSchema),
  nextCursor: v.nullable(cursorSchema)
})

type CatalogTimelineQuery = v.InferOutput<typeof catalogTimelineQuerySchema>
type CatalogTimelineItem = v.InferOutput<typeof catalogTimelineItemSchema>
type CatalogTimelineResponse = v.InferOutput<typeof catalogTimelineResponseSchema>
type CatalogTimelineEpisodeSeason = v.InferOutput<typeof episodeSeasonSchema>

export {
  catalogTimeZoneSchema,
  catalogTimelineQuerySchema,
  catalogTimelineResponseSchema
}

export type {
  CatalogTimelineEpisodeSeason,
  CatalogTimelineItem,
  CatalogTimelineQuery,
  CatalogTimelineResponse
}
