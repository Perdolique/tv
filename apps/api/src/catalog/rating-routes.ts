import type { Context, Hono } from 'hono'
import { catalogRatingSaveSchema, catalogRatingRemoveSchema } from '@tv/shared/catalog-viewings'
import { readViewingInput } from './viewings-routes.ts'
import { validateCatalogItemId } from './details.ts'
import { CatalogHttpError } from './errors.ts'
import { findCatalogItemRatingSummary } from './ratings-repository.ts'
import { readRatingSnapshot, setCurrentCatalogRating } from './rating-mutations.ts'

import {
  withCatalogDatabase,
  withCatalogSession,
  type CatalogDependencies,
  type CatalogEnvironment
} from './session.ts'

function readRatingViewingId(context: Context<CatalogEnvironment>): string | undefined {
  const rawViewingId = context.req.query('viewingId')

  if (rawViewingId === undefined) { return }

  return validateCatalogItemId(rawViewingId)
}

function registerCatalogRatingRoutes(app: Hono<CatalogEnvironment>, dependencies: CatalogDependencies): void {
  app.get('/api/catalog/items/:id/rating-summary', async context => {
    const rawId = context.req.param('id')
    const id = validateCatalogItemId(rawId)

    const summary = await withCatalogDatabase(context, dependencies.connectDatabase, async database => {
      const result = await findCatalogItemRatingSummary(database, id)

      if (result === null) { throw new CatalogHttpError('NOT_FOUND', 404) }

      return result
    })

    return context.json(summary)
  })

  app.get('/api/catalog/items/:id/rating', async context => {
    const rating = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const rawId = context.req.param('id')
      const catalogItemId = validateCatalogItemId(rawId)
      const viewingId = readRatingViewingId(context)

      return readRatingSnapshot(session.database, {
        userId: session.user.id,
        catalogItemId
      }, {
        seasonNumber: null,
        catalogEpisodeId: null
      }, viewingId)
    })

    return context.json(rating)
  })

  app.put('/api/catalog/items/:id/rating', async context => {
    const result = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const rawId = context.req.param('id')
      const catalogItemId = validateCatalogItemId(rawId)
      const input = await readViewingInput(context, catalogRatingSaveSchema)

      return setCurrentCatalogRating(session.database, {
        userId: session.user.id,
        catalogItemId
      }, {
        seasonNumber: null,
        catalogEpisodeId: null
      }, input)
    })

    return context.json(result)
  })

  app.delete('/api/catalog/items/:id/rating', async context => {
    const result = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const rawId = context.req.param('id')
      const catalogItemId = validateCatalogItemId(rawId)
      const input = await readViewingInput(context, catalogRatingRemoveSchema)

      return setCurrentCatalogRating(session.database, {
        userId: session.user.id,
        catalogItemId
      }, {
        seasonNumber: null,
        catalogEpisodeId: null
      }, {
        requestId: input.requestId,
        currentViewingId: input.currentViewingId,
        contextVersion: input.contextVersion,
        timeZone: input.timeZone,
        score: null
      })
    })

    return context.json(result)
  })
}

export { readRatingViewingId, registerCatalogRatingRoutes }
