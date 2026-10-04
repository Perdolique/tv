import type { Context, Hono } from 'hono'
import * as v from 'valibot'
import { validateCatalogItemId } from './details.ts'
import { CatalogHttpError } from './errors.ts'
import { readCatalogRatingScore } from './rating-routes.ts'
import { findCatalogItemRating, findCatalogItemRatingSummary, setCatalogItemRating } from './ratings-repository.ts'

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

      const result = await findCatalogItemRating(session.database, session.user.id, {
        catalogItemId,
        seasonNumber
      })

      if (result === null) {
        throw new CatalogHttpError('NOT_FOUND', 404)
      }

      return result
    })

    return context.json(rating)
  })

  app.put('/api/catalog/items/:id/seasons/:seasonNumber/rating', async context => {
    const score = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const { catalogItemId, seasonNumber } = readSeasonTarget(context)
      const nextScore = await readCatalogRatingScore(context)

      const exists = await setCatalogItemRating(session.database, session.user.id, {
        catalogItemId,
        seasonNumber,
        score: nextScore
      })

      if (!exists) {
        throw new CatalogHttpError('NOT_FOUND', 404)
      }

      return nextScore
    })

    return context.json({ score })
  })

  app.delete('/api/catalog/items/:id/seasons/:seasonNumber/rating', async context => {
    await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const { catalogItemId, seasonNumber } = readSeasonTarget(context)

      const exists = await setCatalogItemRating(session.database, session.user.id, {
        catalogItemId,
        seasonNumber,
        score: null
      })

      if (!exists) {
        throw new CatalogHttpError('NOT_FOUND', 404)
      }
    })

    return context.json({ score: null })
  })
}

export { readSeasonTarget, registerCatalogSeasonRatingRoutes }
