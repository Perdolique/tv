import type { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import * as v from 'valibot'
import { validateCatalogItemId } from './details.ts'
import { CatalogHttpError } from './errors.ts'
import { findCatalogItemRating, setCatalogItemRating } from './ratings-repository.ts'
import { withCatalogSession, type CatalogDependencies, type CatalogEnvironment } from './session.ts'

const ratingBodySchema = v.strictObject({
  score: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10))
})

const ratingBodyLimit = bodyLimit({
  maxSize: 2 ** 14,
  onError: () => { throw new CatalogHttpError('INVALID_REQUEST', 413) }
})

function registerCatalogRatingRoutes(app: Hono<CatalogEnvironment>, dependencies: CatalogDependencies): void {
  app.get('/api/catalog/items/:id/rating', async (context) => {
    const rating = await withCatalogSession(context, dependencies.connectDatabase, async (session) => {
      const id = validateCatalogItemId(context.req.param('id'))
      const result = await findCatalogItemRating(session.database, session.user.id, id)

      if (result === null) {
        throw new CatalogHttpError('NOT_FOUND', 404)
      }

      return result
    })

    return context.json(rating)
  })

  app.put('/api/catalog/items/:id/rating', async (context) => {
    const score = await withCatalogSession(context, dependencies.connectDatabase, async (session) => {
      const id = validateCatalogItemId(context.req.param('id'))
      const contentType = context.req.header('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase()

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

      const exists = await setCatalogItemRating(session.database, session.user.id, {
        catalogItemId: id,
        score: parsed.output.score
      })

      if (!exists) {
        throw new CatalogHttpError('NOT_FOUND', 404)
      }

      return parsed.output.score
    })

    return context.json({ score })
  })

  app.delete('/api/catalog/items/:id/rating', async (context) => {
    await withCatalogSession(context, dependencies.connectDatabase, async (session) => {
      const id = validateCatalogItemId(context.req.param('id'))

      const exists = await setCatalogItemRating(session.database, session.user.id, {
        catalogItemId: id,
        score: null
      })

      if (!exists) {
        throw new CatalogHttpError('NOT_FOUND', 404)
      }
    })

    return context.json({ score: null })
  })
}

export { registerCatalogRatingRoutes }
