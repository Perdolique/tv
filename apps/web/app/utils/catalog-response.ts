import type {
  CatalogDetailsResponse,
  CatalogEpisodeWatchesResponse,
  CatalogEpisodesResponse,
  CatalogFollowResponse,
  CatalogReleasesResponse,
  CatalogSearchResponse,
  CatalogUpcomingReleasesResponse,
  CatalogWatchedResponse,
  CatalogWatchlistResponse
} from '@tv/shared/catalog'

import * as v from 'valibot'
import { parseCalendarDate } from '~/utils/calendar-date.ts'

const catalogPosterUrlSchema = v.nullable(
  v.pipe(v.string(), v.regex(/^\/posters\/[a-z0-9-]+\.webp$/u))
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
    posterUrl: catalogPosterUrlSchema
  })
}) satisfies v.GenericSchema<CatalogDetailsResponse>

const catalogFollowResponseSchema = v.strictObject({
  followed: v.boolean()
}) satisfies v.GenericSchema<CatalogFollowResponse>

const catalogWatchedResponseSchema = v.strictObject({
  watched: v.boolean()
}) satisfies v.GenericSchema<CatalogWatchedResponse>

const catalogWatchlistResponseSchema = v.object({
  items: v.array(v.object({
    ...catalogSearchItemSchema.entries,
    id: catalogItemIdSchema,
    posterUrl: catalogPosterUrlSchema
  }))
}) satisfies v.GenericSchema<CatalogWatchlistResponse>

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

const catalogEpisodeWatchesResponseSchema = v.strictObject({
  watchedEpisodeIds: v.array(catalogItemIdSchema)
}) satisfies v.GenericSchema<CatalogEpisodeWatchesResponse>

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
  catalogEpisodeWatchesResponseSchema,
  catalogFollowResponseSchema,
  catalogReleasesResponseSchema,
  catalogUpcomingReleasesResponseSchema,
  catalogWatchedResponseSchema,
  catalogSearchResponseSchema,
  catalogWatchlistResponseSchema,
  normalizeSearchQuery
}
