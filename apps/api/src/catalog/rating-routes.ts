import type { Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import * as v from 'valibot'
import type { Database } from '@tv/database'
import { catalogItems, catalogItemTitles } from '@tv/database/schema'
import { catalogMovieRatingSaveSchema, catalogMovieRatingRemoveSchema } from '@tv/shared/catalog-viewings'
import { and, eq } from 'drizzle-orm'
import { readViewingInput } from './movie-viewing-routes.ts'
import { setCurrentMovieRating } from './movie-ratings-repository.ts'
import { validateCatalogItemId } from './details.ts'
import { CatalogHttpError } from './errors.ts'
import { findCatalogItemRating, findCatalogItemRatingSummary, setCatalogItemRating } from './ratings-repository.ts'

import {
  withCatalogDatabase,
  withCatalogSession,
  type CatalogDependencies,
  type CatalogEnvironment
} from './session.ts'

const ratingBodySchema = v.strictObject({
  score: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10))
})

const ratingBodyLimit = bodyLimit({
  maxSize: 2 ** 14,
  onError: () => { throw new CatalogHttpError('INVALID_REQUEST', 413) }
})

async function readCatalogRatingScore(context: Context<CatalogEnvironment, string>): Promise<number> {
  const header = context.req.header('Content-Type')
  const mediaType = header?.split(';', 1)[0]
  const trimmedMediaType = mediaType?.trim()
  const contentType = trimmedMediaType?.toLowerCase()

  if (contentType !== 'application/json') {
    throw new CatalogHttpError('INVALID_REQUEST', 400)
  }

  await ratingBodyLimit(context, async () => {
    // The authenticated handler continues below after the size check.
  })

  const input: unknown = await context.req.json().catch(() => null)
  const parsed = v.safeParse(ratingBodySchema, input)

  if (!parsed.success) {
    throw new CatalogHttpError('INVALID_REQUEST', 400, {
      fields: { score: 'Choose a whole-number score from 1 to 10.' }
    })
  }

  return parsed.output.score
}

async function requireRatingItemType(database: Database, id: string) {
  const rows = await database.select({ type: catalogItems.type }).from(catalogItems)
    .innerJoin(catalogItemTitles, and(eq(catalogItemTitles.catalogItemId, catalogItems.id), eq(catalogItemTitles.isOriginal, true)))
    .where(
      eq(catalogItems.id, id)
    )
    .limit(1)

  const [item] = rows

  if (item === undefined) { throw new CatalogHttpError('NOT_FOUND', 404) }

  return item.type
}

function registerCatalogRatingRoutes(app: Hono<CatalogEnvironment>, dependencies: CatalogDependencies): void {
  app.get('/api/catalog/items/:id/rating-summary', async (context) => {
    const rawId = context.req.param('id')
    const id = validateCatalogItemId(rawId)

    const summary = await withCatalogDatabase(context, dependencies.connectDatabase, async database => {
      const result = await findCatalogItemRatingSummary(database, id)

      if (result === null) {
        throw new CatalogHttpError('NOT_FOUND', 404)
      }

      return result
    })

    return context.json(summary)
  })

  app.get('/api/catalog/items/:id/rating', async (context) => {
    const rating = await withCatalogSession(context, dependencies.connectDatabase, async (session) => {
      const rawId = context.req.param('id')
      const id = validateCatalogItemId(rawId)

      const result = await findCatalogItemRating(session.database, session.user.id, {
        catalogItemId: id,
        seasonNumber: null
      })

      if (result === null) {
        throw new CatalogHttpError('NOT_FOUND', 404)
      }

      return result
    })

    return context.json(rating)
  })

  app.put('/api/catalog/items/:id/rating', async context => {
    const result = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const rawId = context.req.param('id')
      const id = validateCatalogItemId(rawId)
      const type = await requireRatingItemType(session.database, id)

      if (type === 'movie') {
        const input = await readViewingInput(context, catalogMovieRatingSaveSchema)

        return setCurrentMovieRating(session.database, {
          userId: session.user.id,
          catalogItemId: id
        }, input)
      }

      const score = await readCatalogRatingScore(context)

      const exists = await setCatalogItemRating(session.database, session.user.id, {
        catalogItemId: id,
        score
      })

      if (!exists) { throw new CatalogHttpError('NOT_FOUND', 404) }

      return { score }
    })

    return context.json(result)
  })

  app.delete('/api/catalog/items/:id/rating', async context => {
    const result = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const rawId = context.req.param('id')
      const id = validateCatalogItemId(rawId)
      const type = await requireRatingItemType(session.database, id)

      if (type === 'movie') {
        const input = await readViewingInput(context, catalogMovieRatingRemoveSchema)

        return setCurrentMovieRating(session.database, {
          userId: session.user.id,
          catalogItemId: id
        }, {
          currentViewingId: input.currentViewingId,
          contextVersion: input.contextVersion,
          score: null
        })
      }

      const exists = await setCatalogItemRating(session.database, session.user.id, {
        catalogItemId: id,
        score: null
      })

      if (!exists) { throw new CatalogHttpError('NOT_FOUND', 404) }

      return { score: null }
    })

    return context.json(result)
  })
}

export { readCatalogRatingScore, registerCatalogRatingRoutes }
