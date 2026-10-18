import type { Hono } from 'hono'
import { CatalogHttpError } from './errors.ts'
import { validateCatalogEpisodeId } from './episodes.ts'
import { readEpisodeRatingSnapshot, findCatalogEpisodeRatingSummaries } from './episode-ratings-repository.ts'
import { readRatingViewingId } from './rating-routes.ts'
import { readViewingInput } from './viewings-routes.ts'
import { validateCatalogItemId } from './details.ts'

import {
  catalogRatingSaveSchema,
  catalogRatingRemoveSchema,
  catalogHistoricalRatingSaveSchema,
  catalogHistoricalRatingRemoveSchema
} from '@tv/shared/catalog-viewings'

import { readRatingSnapshot, setCurrentCatalogRating, setHistoricalCatalogRating } from './rating-mutations.ts'
import { findEpisodeOwner } from './series-viewings-repository.ts'
import { readSeasonTarget } from './season-rating-routes.ts'

import {
  withCatalogDatabase,
  withCatalogSession,
  type CatalogDependencies,
  type CatalogEnvironment
} from './session.ts'

function registerCatalogEpisodeRatingRoutes(app: Hono<CatalogEnvironment>, dependencies: CatalogDependencies): void {
  app.get('/api/catalog/items/:id/seasons/:seasonNumber/episodes/rating-summaries', async context => {
    const scope = readSeasonTarget(context)

    const items = await withCatalogDatabase(context, dependencies.connectDatabase, async database => {
      const result = await findCatalogEpisodeRatingSummaries(database, scope)

      if (result === null) {
        throw new CatalogHttpError('NOT_FOUND', 404)
      }

      return result
    })

    return context.json({ items })
  })

  app.get('/api/catalog/items/:id/seasons/:seasonNumber/episodes/ratings', async context => {
    const items = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const scope = readSeasonTarget(context)
      const viewingId = readRatingViewingId(context)

      return readEpisodeRatingSnapshot(session.database, session.user.id, scope, viewingId)
    })

    return context.json(items)
  })

  app.get('/api/catalog/episodes/:id/rating-summary', async context => {
    const episodeId = validateCatalogEpisodeId(context.req.param('id'))

    const summary = await withCatalogDatabase(context, dependencies.connectDatabase, async database => {
      const rows = await findCatalogEpisodeRatingSummaries(database, { episodeId })
      const result = rows?.[0]

      if (result === undefined) {
        throw new CatalogHttpError('NOT_FOUND', 404)
      }

      return {
        averageScore: result.averageScore,
        ratingCount: result.ratingCount
      }
    })

    return context.json(summary)
  })

  app.get('/api/catalog/episodes/:id/rating', async context => {
    const rating = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const episodeId = validateCatalogEpisodeId(context.req.param('id'))
      const viewingId = readRatingViewingId(context)
      const owner = await findEpisodeOwner(session.database, session.user.id, episodeId)

      return readRatingSnapshot(session.database, owner, {
        seasonNumber: null,
        catalogEpisodeId: episodeId
      }, viewingId)
    })

    return context.json(rating)
  })

  app.put('/api/catalog/episodes/:id/rating', async context => {
    const response = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const episodeId = validateCatalogEpisodeId(context.req.param('id'))
      const input = await readViewingInput(context, catalogRatingSaveSchema)
      const owner = await findEpisodeOwner(session.database, session.user.id, episodeId)

      return setCurrentCatalogRating(session.database, owner, {
        seasonNumber: null,
        catalogEpisodeId: episodeId
      }, input)
    })

    return context.json(response)
  })

  app.delete('/api/catalog/episodes/:id/rating', async context => {
    const response = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const episodeId = validateCatalogEpisodeId(context.req.param('id'))
      const input = await readViewingInput(context, catalogRatingRemoveSchema)
      const owner = await findEpisodeOwner(session.database, session.user.id, episodeId)

      return setCurrentCatalogRating(session.database, owner, {
        seasonNumber: null,
        catalogEpisodeId: episodeId
      }, {
        requestId: input.requestId,
        currentViewingId: input.currentViewingId,
        contextVersion: input.contextVersion,
        timeZone: input.timeZone,
        score: null
      })
    })

    return context.json(response)
  })

  app.put('/api/catalog/items/:id/viewings/:viewingId/episodes/:episodeId/rating', async context => {
    const response = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const rawCatalogItemId = context.req.param('id')
      const catalogItemId = validateCatalogItemId(rawCatalogItemId)
      const rawViewingId = context.req.param('viewingId')
      const viewingId = validateCatalogItemId(rawViewingId)
      const rawEpisodeId = context.req.param('episodeId')
      const episodeId = validateCatalogEpisodeId(rawEpisodeId)
      const input = await readViewingInput(context, catalogHistoricalRatingSaveSchema)

      return setHistoricalCatalogRating(session.database, {
        userId: session.user.id,
        catalogItemId,
        viewingId
      }, {
        seasonNumber: null,
        catalogEpisodeId: episodeId
      }, input)
    })

    return context.json(response)
  })

  app.delete('/api/catalog/items/:id/viewings/:viewingId/episodes/:episodeId/rating', async context => {
    const response = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const rawCatalogItemId = context.req.param('id')
      const catalogItemId = validateCatalogItemId(rawCatalogItemId)
      const rawViewingId = context.req.param('viewingId')
      const viewingId = validateCatalogItemId(rawViewingId)
      const rawEpisodeId = context.req.param('episodeId')
      const episodeId = validateCatalogEpisodeId(rawEpisodeId)
      const input = await readViewingInput(context, catalogHistoricalRatingRemoveSchema)

      return setHistoricalCatalogRating(session.database, {
        userId: session.user.id,
        catalogItemId,
        viewingId
      }, {
        seasonNumber: null,
        catalogEpisodeId: episodeId
      }, {
        requestId: input.requestId,
        revision: input.revision,
        timeZone: input.timeZone,
        score: null
      })
    })

    return context.json(response)
  })
}

export { registerCatalogEpisodeRatingRoutes }
