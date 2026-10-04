import type { Hono } from 'hono'
import { CatalogHttpError } from './errors.ts'
import { validateCatalogEpisodeId } from './episodes.ts'

import {
  findCatalogEpisodeRatings,
  findCatalogEpisodeRatingSummaries,
  setCatalogEpisodeRating
} from './episode-ratings-repository.ts'

import { readCatalogRatingScore } from './rating-routes.ts'
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
      const result = await findCatalogEpisodeRatings(session.database, session.user.id, scope)

      if (result === null) {
        throw new CatalogHttpError('NOT_FOUND', 404)
      }

      return result
    })

    return context.json({ items })
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
      const rows = await findCatalogEpisodeRatings(session.database, session.user.id, { episodeId })
      const result = rows?.[0]

      if (result === undefined) {
        throw new CatalogHttpError('NOT_FOUND', 404)
      }

      return { score: result.score }
    })

    return context.json(rating)
  })

  app.put('/api/catalog/episodes/:id/rating', async context => {
    const score = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const episodeId = validateCatalogEpisodeId(context.req.param('id'))
      const nextScore = await readCatalogRatingScore(context)

      const exists = await setCatalogEpisodeRating(session.database, session.user.id, {
        episodeId,
        score: nextScore
      })

      if (!exists) {
        throw new CatalogHttpError('NOT_FOUND', 404)
      }

      return nextScore
    })

    return context.json({ score })
  })

  app.delete('/api/catalog/episodes/:id/rating', async context => {
    await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const episodeId = validateCatalogEpisodeId(context.req.param('id'))

      const exists = await setCatalogEpisodeRating(session.database, session.user.id, {
        episodeId,
        score: null
      })

      if (!exists) {
        throw new CatalogHttpError('NOT_FOUND', 404)
      }
    })

    return context.json({ score: null })
  })
}

export { registerCatalogEpisodeRatingRoutes }
