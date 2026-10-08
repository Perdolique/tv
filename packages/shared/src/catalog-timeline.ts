import * as v from 'valibot'

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || value.startsWith('0000')) {
    return false
  }

  const timestampValue = `${value}T00:00:00.000Z`
  const date = new Date(timestampValue)
  const timestamp = date.getTime()

  if (!Number.isFinite(timestamp)) {
    return false
  }

  const isoDate = date.toISOString()
  const normalized = isoDate.slice(0, 10)

  return normalized === value
}

function isTimeZone(value: string): boolean {
  if (!/^[A-Za-z][A-Za-z_\d+/-]*$/u.test(value)) {
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

const catalogTimelineEpisodesQuerySchema = v.strictObject({
  timeZone: catalogTimeZoneSchema,
  viewingId: idSchema,
  localDate: dateSchema,
  groupCursor: cursorSchema,
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
    completedOn: v.nullable(dateSchema)
  }),
  v.strictObject({
    ...eventEntries,
    kind: v.literal('episode_group'),
    viewingId: idSchema,
    localDate: dateSchema,
    totalCount: positiveIntegerSchema,
    seasons: v.array(episodeSeasonSchema),
    episodesCursor: cursorSchema
  }),
  v.strictObject({
    ...eventEntries,
    kind: v.picklist(['series_started', 'rewatch_started', 'series_paused', 'series_completed']),
    viewingId: idSchema
  }),
  v.strictObject({
    ...eventEntries,
    kind: v.picklist(['season_completed', 'available_completed']),
    viewingId: idSchema,
    seasonNumber: v.nullable(positiveIntegerSchema),
    totalCount: positiveIntegerSchema
  }),
  v.strictObject({
    ...eventEntries,
    kind: v.literal('rating_changed'),
    target: v.picklist(['item', 'season', 'episode']),
    seasonNumber: v.nullable(positiveIntegerSchema),
    catalogEpisodeId: v.nullable(idSchema),
    episodeNumber: v.nullable(positiveIntegerSchema),
    previousScore: scoreSchema,
    score: scoreSchema
  })
])

const catalogTimelineResponseSchema = v.strictObject({
  items: v.array(catalogTimelineItemSchema),
  nextCursor: v.nullable(cursorSchema)
})

const catalogTimelineEpisodeSchema = v.strictObject({
  id: idSchema,
  watchId: idSchema,
  catalogEpisodeId: idSchema,
  seasonNumber: positiveIntegerSchema,
  episodeNumber: positiveIntegerSchema,
  sourceTitle: v.nullable(v.string()),
  markedAt: timestampSchema
})

const catalogTimelineEpisodesResponseSchema = v.strictObject({
  items: v.array(catalogTimelineEpisodeSchema),
  nextCursor: v.nullable(cursorSchema)
})

type CatalogTimelineQuery = v.InferOutput<typeof catalogTimelineQuerySchema>
type CatalogTimelineEpisodesQuery = v.InferOutput<typeof catalogTimelineEpisodesQuerySchema>
type CatalogTimelineItem = v.InferOutput<typeof catalogTimelineItemSchema>
type CatalogTimelineResponse = v.InferOutput<typeof catalogTimelineResponseSchema>
type CatalogTimelineEpisode = v.InferOutput<typeof catalogTimelineEpisodeSchema>
type CatalogTimelineEpisodesResponse = v.InferOutput<typeof catalogTimelineEpisodesResponseSchema>
type CatalogTimelineEpisodeSeason = v.InferOutput<typeof episodeSeasonSchema>

export {
  catalogTimeZoneSchema,
  catalogTimelineEpisodesQuerySchema,
  catalogTimelineEpisodesResponseSchema,
  catalogTimelineQuerySchema,
  catalogTimelineResponseSchema
}

export type {
  CatalogTimelineEpisode,
  CatalogTimelineEpisodeSeason,
  CatalogTimelineEpisodesQuery,
  CatalogTimelineEpisodesResponse,
  CatalogTimelineItem,
  CatalogTimelineQuery,
  CatalogTimelineResponse
}
