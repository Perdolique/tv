import type {
  CatalogDetailsResponse,
  CatalogEpisodeRatingSummariesResponse,
  CatalogEpisodesResponse,
  CatalogFollowResponse,
  CatalogRatingSummaryResponse,
  CatalogReleasesResponse,
  CatalogSearchResponse,
  CatalogUpcomingReleasesResponse,
  CatalogViewingHistoryResponse,
  CatalogViewingSummaryResponse,
  CatalogWatchlistResponse
} from '@tv/shared/catalog'

import { catalogViewingStatusSchema, viewingDateSchema } from '@tv/shared/catalog-viewings'
import * as v from 'valibot'
import { parseCalendarDate } from '~/utils/calendar-date.ts'

const catalogPosterUrlSchema = v.nullable(
  v.pipe(v.string(), v.regex(/^\/(?:posters\/[a-z0-9-]+|api\/posters\/tv-[a-z0-9-]+-(?:movie|series)-[1-9]\d*-[a-f0-9]{64})\.webp$/u))
)

const catalogItemIdSchema = v.pipe(v.string(), v.uuid())

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
    posterUrl: catalogPosterUrlSchema,

    sources: v.optional(v.array(v.object({
      provider: v.picklist(['tmdb', 'tvmaze']),
      url: v.pipe(v.string(), v.url())
    })))
  })
}) satisfies v.GenericSchema<CatalogDetailsResponse>

const catalogFollowResponseSchema = v.strictObject({
  followed: v.boolean()
}) satisfies v.GenericSchema<CatalogFollowResponse>

const catalogRatingSummaryResponseSchema = v.pipe(
  v.strictObject({
    averageScore: v.nullable(v.pipe(v.number(), v.finite(), v.minValue(1), v.maxValue(10))),
    ratingCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0))
  }),
  v.check(summary => (summary.ratingCount === 0) === (summary.averageScore === null))
) satisfies v.GenericSchema<CatalogRatingSummaryResponse>

const catalogEpisodeRatingSummariesResponseSchema = v.strictObject({
  items: v.array(v.pipe(v.strictObject({
    episodeId: catalogItemIdSchema,
    averageScore: v.nullable(v.pipe(v.number(), v.finite(), v.minValue(1), v.maxValue(10))),
    ratingCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0))
  }), v.check(summary => (summary.ratingCount === 0) === (summary.averageScore === null))))
}) satisfies v.GenericSchema<CatalogEpisodeRatingSummariesResponse>

const catalogWatchlistResponseSchema = v.object({
  items: v.array(v.object({
    ...catalogSearchItemSchema.entries,
    id: catalogItemIdSchema,
    posterUrl: catalogPosterUrlSchema
  }))
}) satisfies v.GenericSchema<CatalogWatchlistResponse>

const viewingTitleEntries = {
  ...catalogSearchItemSchema.entries,
  id: catalogItemIdSchema,
  posterUrl: catalogPosterUrlSchema
}

const catalogViewingHistoryResponseSchema = v.object({
  items: v.pipe(v.array(v.pipe(v.object({
    ...viewingTitleEntries,
    viewingId: catalogItemIdSchema,
    status: catalogViewingStatusSchema,
    startedOn: v.nullable(viewingDateSchema),
    completedOn: v.nullable(viewingDateSchema),
    score: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10)))
  }), v.check(item => {
    if (item.type === 'movie') {
      return item.status === 'completed' && item.startedOn === null && item.completedOn !== null
    }

    if (item.startedOn === null) { return false }

    return item.status === 'completed'
      ? item.completedOn !== null && item.completedOn >= item.startedOn
      : item.completedOn === null
  }))), v.maxLength(20)),

  nextCursor: v.nullable(v.pipe(v.string(), v.minLength(1)))
}) satisfies v.GenericSchema<CatalogViewingHistoryResponse>

const catalogViewingSummaryResponseSchema = v.object({
  watchedMovieCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  watchedEpisodeCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  completedSeriesCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  watchingSeriesCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),

  activeSeries: v.pipe(v.array(v.object({
    ...viewingTitleEntries,
    type: v.literal('series'),
    viewingId: catalogItemIdSchema,
    startedOn: viewingDateSchema,
    watchedEpisodeCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0))
  })), v.maxLength(5))
}) satisfies v.GenericSchema<CatalogViewingSummaryResponse>

const calendarDateSchema = v.pipe(
  v.string(),
  v.check(value => parseCalendarDate(value) !== null)
)

const catalogEpisodesResponseSchema = v.strictObject({
  items: v.array(v.strictObject({
    airDate: v.nullable(calendarDateSchema),
    episodeNumber: v.pipe(v.number(), v.integer(), v.minValue(1)),
    id: catalogItemIdSchema,
    seasonNumber: v.pipe(v.number(), v.integer(), v.minValue(1)),
    sourceTitle: v.nullable(v.string())
  }))
}) satisfies v.GenericSchema<CatalogEpisodesResponse>

const catalogReleasesResponseSchema = v.object({
  items: v.array(v.object({
    ...catalogSearchItemSchema.entries,
    episodeNumber: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),
    id: catalogItemIdSchema,
    posterUrl: catalogPosterUrlSchema,
    releaseDate: calendarDateSchema,
    releaseId: v.pipe(v.string(), v.uuid()),
    seasonNumber: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))
  }))
}) satisfies v.GenericSchema<CatalogReleasesResponse>

const catalogUpcomingReleasesResponseSchema = v.object({
  ...catalogReleasesResponseSchema.entries,
  nextCursor: v.nullable(v.string())
}) satisfies v.GenericSchema<CatalogUpcomingReleasesResponse>

function normalizeSearchQuery(value: unknown): string {
  return typeof value === 'string' ? value.trim().normalize('NFC') : ''
}

export {
  catalogDetailsResponseSchema,
  catalogEpisodesResponseSchema,
  catalogEpisodeRatingSummariesResponseSchema,
  catalogFollowResponseSchema,
  catalogRatingSummaryResponseSchema,
  catalogReleasesResponseSchema,
  catalogUpcomingReleasesResponseSchema,
  catalogViewingHistoryResponseSchema,
  catalogViewingSummaryResponseSchema,
  catalogSearchResponseSchema,
  catalogWatchlistResponseSchema,
  normalizeSearchQuery
}
