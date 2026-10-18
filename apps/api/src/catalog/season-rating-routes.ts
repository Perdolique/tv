import type { Context, Hono } from 'hono'
import * as v from 'valibot'
import { validateCatalogItemId } from './details.ts'
import { CatalogHttpError } from './errors.ts'
import { readRatingViewingId } from './rating-routes.ts'
import { readViewingInput } from './viewings-routes.ts'

import {
  catalogRatingSaveSchema,
  catalogRatingRemoveSchema,
  catalogHistoricalRatingSaveSchema,
  catalogHistoricalRatingRemoveSchema
} from '@tv/shared/catalog-viewings'

import { readRatingSnapshot, setCurrentCatalogRating, setHistoricalCatalogRating } from './rating-mutations.ts'
import { findCatalogItemRatingSummary } from './ratings-repository.ts'

import {
  withCatalogDatabase,
  withCatalogSession,
  type CatalogDependencies,
  type CatalogEnvironment
} from './session.ts'

const seasonNumberSchema = v.pipe(v.string(), v.regex(/^[1-9]\d*$/u), v.transform(Number), v.integer(), v.maxValue(2_147_483_647))

function readSeasonTarget(context: Context<CatalogEnvironment>) {
  const rawId = context.req.param('id') ?? ''
  const catalogItemId = validateCatalogItemId(rawId)
  const rawSeasonNumber = context.req.param('seasonNumber')
  const parsed = v.safeParse(seasonNumberSchema, rawSeasonNumber)

  if (!parsed.success) {
    throw new CatalogHttpError('INVALID_REQUEST', 400, {
      fields: { seasonNumber: 'Use a positive whole-number season.' }
    })
  }

  return {
    catalogItemId,
    seasonNumber: parsed.output
  }
}

function registerCatalogSeasonRatingRoutes(app: Hono<CatalogEnvironment>, dependencies: CatalogDependencies): void {
  app.get('/api/catalog/items/:id/seasons/:seasonNumber/rating-summary', async context => {
    const { catalogItemId, seasonNumber } = readSeasonTarget(context)

    const summary = await withCatalogDatabase(context, dependencies.connectDatabase, async database => {
      const result = await findCatalogItemRatingSummary(database, catalogItemId, seasonNumber)

      if (result === null) {
        throw new CatalogHttpError('NOT_FOUND', 404)
      }

      return result
    })

    return context.json(summary)
  })

  app.get('/api/catalog/items/:id/seasons/:seasonNumber/rating', async context => {
    const rating = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const { catalogItemId, seasonNumber } = readSeasonTarget(context)
      const viewingId = readRatingViewingId(context)

      return readRatingSnapshot(session.database, {
        userId: session.user.id,
        catalogItemId
      }, {
        seasonNumber,
        catalogEpisodeId: null
      }, viewingId)
    })

    return context.json(rating)
  })

  app.put('/api/catalog/items/:id/seasons/:seasonNumber/rating', async context => {
    const response = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const { catalogItemId, seasonNumber } = readSeasonTarget(context)
      const input = await readViewingInput(context, catalogRatingSaveSchema)

      return setCurrentCatalogRating(session.database, {
        userId: session.user.id,
        catalogItemId
      }, {
        seasonNumber,
        catalogEpisodeId: null
      }, input)
    })

    return context.json(response)
  })

  app.delete('/api/catalog/items/:id/seasons/:seasonNumber/rating', async context => {
    const response = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const { catalogItemId, seasonNumber } = readSeasonTarget(context)
      const input = await readViewingInput(context, catalogRatingRemoveSchema)

      return setCurrentCatalogRating(session.database, {
        userId: session.user.id,
        catalogItemId
      }, {
        seasonNumber,
        catalogEpisodeId: null
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

  app.put('/api/catalog/items/:id/viewings/:viewingId/seasons/:seasonNumber/rating', async context => {
    const response = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const { catalogItemId, seasonNumber } = readSeasonTarget(context)
      const rawViewingId = context.req.param('viewingId')
      const viewingId = validateCatalogItemId(rawViewingId)
      const input = await readViewingInput(context, catalogHistoricalRatingSaveSchema)

      return setHistoricalCatalogRating(session.database, {
        userId: session.user.id,
        catalogItemId,
        viewingId
      }, {
        seasonNumber,
        catalogEpisodeId: null
      }, input)
    })

    return context.json(response)
  })

  app.delete('/api/catalog/items/:id/viewings/:viewingId/seasons/:seasonNumber/rating', async context => {
    const response = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const { catalogItemId, seasonNumber } = readSeasonTarget(context)
      const rawViewingId = context.req.param('viewingId')
      const viewingId = validateCatalogItemId(rawViewingId)
      const input = await readViewingInput(context, catalogHistoricalRatingRemoveSchema)

      return setHistoricalCatalogRating(session.database, {
        userId: session.user.id,
        catalogItemId,
        viewingId
      }, {
        seasonNumber,
        catalogEpisodeId: null
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

export { readSeasonTarget, registerCatalogSeasonRatingRoutes }
