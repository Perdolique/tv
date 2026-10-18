import type { Hono } from 'hono'

import {
  catalogSeriesBulkWatchSchema,
  catalogSeriesCancelRewatchSchema,
  catalogSeriesUnwatchSchema,
  catalogSeriesWatchSchema
} from '@tv/shared/catalog-series'

import { validateCatalogItemId } from './details.ts'
import { validateCatalogEpisodeId } from './episodes.ts'
import { CatalogHttpError } from './errors.ts'

import {
  cancelSeriesRewatch,
  findSeriesWatches,
  markSeriesEpisodeWatched,
  markSeriesEpisodesWatched,
  unmarkSeriesEpisodeWatched
} from './series-viewings-repository.ts'

import { withCatalogSession, type CatalogDependencies, type CatalogEnvironment } from './session.ts'
import { readViewingInput } from './viewings-routes.ts'

function registerCatalogSeriesViewingRoutes(app: Hono<CatalogEnvironment>, dependencies: CatalogDependencies): void {
  app.get('/api/catalog/items/:id/episodes/watched', async context => {
    const response = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const rawId = context.req.param('id')
      const catalogItemId = validateCatalogItemId(rawId)
      const selectedId = context.req.query('viewingId')
      const viewingId = selectedId === undefined ? undefined : validateCatalogItemId(selectedId)

      return findSeriesWatches(session.database, {
        userId: session.user.id,
        catalogItemId
      }, viewingId)
    })

    return context.json(response)
  })

  app.put('/api/catalog/episodes/:id/watched', async context => {
    const response = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const rawId = context.req.param('id')
      const episodeId = validateCatalogEpisodeId(rawId)
      const input = await readViewingInput(context, catalogSeriesWatchSchema)

      return markSeriesEpisodeWatched(session.database, session.user.id, episodeId, input)
    })

    return context.json(response)
  })

  app.delete('/api/catalog/episodes/:id/watched', async context => {
    const response = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const rawId = context.req.param('id')
      const episodeId = validateCatalogEpisodeId(rawId)
      const input = await readViewingInput(context, catalogSeriesUnwatchSchema)

      return unmarkSeriesEpisodeWatched(session.database, session.user.id, episodeId, input)
    })

    return context.json(response)
  })

  app.post('/api/catalog/items/:id/seasons/:seasonNumber/watched', async context => {
    const response = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const rawId = context.req.param('id')
      const catalogItemId = validateCatalogItemId(rawId)
      const rawSeason = context.req.param('seasonNumber')
      const seasonNumber = Number(rawSeason)
      const hasSeasonFormat = /^\d+$/u.test(rawSeason)
      const isSafeSeason = hasSeasonFormat && Number.isSafeInteger(seasonNumber)

      if (!isSafeSeason || seasonNumber < 1) {
        throw new CatalogHttpError('INVALID_REQUEST', 400, { fields: { seasonNumber: 'Use a positive season number.' } })
      }

      const input = await readViewingInput(context, catalogSeriesBulkWatchSchema)

      return markSeriesEpisodesWatched(session.database, {
        userId: session.user.id,
        catalogItemId
      }, input, seasonNumber)
    })

    return context.json(response)
  })

  app.post('/api/catalog/items/:id/episodes/watched', async context => {
    const response = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const rawId = context.req.param('id')
      const catalogItemId = validateCatalogItemId(rawId)
      const input = await readViewingInput(context, catalogSeriesBulkWatchSchema)

      return markSeriesEpisodesWatched(session.database, {
        userId: session.user.id,
        catalogItemId
      }, input, null)
    })

    return context.json(response)
  })

  app.delete('/api/catalog/items/:id/rewatch', async context => {
    const response = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const rawId = context.req.param('id')
      const catalogItemId = validateCatalogItemId(rawId)
      const input = await readViewingInput(context, catalogSeriesCancelRewatchSchema)

      const summary = await cancelSeriesRewatch(session.database, {
        userId: session.user.id,
        catalogItemId
      }, input)

      return { summary }
    })

    return context.json(response)
  })

}

export { registerCatalogSeriesViewingRoutes }
