import type { Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import * as v from 'valibot'

import {
  catalogViewingCreateSchema,
  catalogViewingDeleteSchema,
  catalogViewingUpdateSchema
} from '@tv/shared/catalog-viewings'

import { validateCatalogItemId } from './details.ts'
import { CatalogHttpError } from './errors.ts'

import {
  createMovieViewing,
  deleteMovieViewing,
  findMovieViewing,
  findMovieViewings,
  updateMovieViewing
} from './movie-viewings-repository.ts'

import { withCatalogSession, type CatalogDependencies, type CatalogEnvironment } from './session.ts'

const viewingBodyLimit = bodyLimit({
  maxSize: 2 ** 14,
  onError: () => { throw new CatalogHttpError('INVALID_REQUEST', 413) }
})

async function readViewingInput<Schema extends v.GenericSchema>(context: Context<CatalogEnvironment>, schema: Schema): Promise<v.InferOutput<Schema>> {
  const header = context.req.header('Content-Type')
  const mediaType = header?.split(';', 1)[0]?.trim().toLowerCase()

  if (mediaType !== 'application/json') {
    throw new CatalogHttpError('INVALID_REQUEST', 400)
  }

  // oxlint-disable-next-line typescript/no-unsafe-argument -- Hono middleware uses a broader Context generic than the typed route.
  await viewingBodyLimit(context, async () => {
    // Authentication precedes body parsing and its size limit.
  })

  const input: unknown = await context.req.json().catch(() => null)
  const parsed = v.safeParse(schema, input)

  if (!parsed.success) {
    const flattened = v.flatten(parsed.issues)
    const fields: Record<string, string> = {}
    const errors = Object.entries(flattened.nested ?? {})

    for (const [name, messages] of errors) {
      const message = messages?.[0]

      if (message !== undefined) {
        fields[name] = message
      }
    }

    throw new CatalogHttpError('INVALID_REQUEST', 400, { fields })
  }

  return parsed.output
}

function registerCatalogMovieViewingRoutes(app: Hono<CatalogEnvironment>, dependencies: CatalogDependencies): void {
  app.get('/api/catalog/items/:id/viewings', async context => {
    const response = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const rawCatalogItemId = context.req.param('id')
      const catalogItemId = validateCatalogItemId(rawCatalogItemId)
      const cursor = context.req.query('cursor') ?? null

      return findMovieViewings(session.database, {
        userId: session.user.id,
        catalogItemId
      }, cursor)
    })

    return context.json(response)
  })

  app.post('/api/catalog/items/:id/viewings', async context => {
    const response = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const rawCatalogItemId = context.req.param('id')
      const catalogItemId = validateCatalogItemId(rawCatalogItemId)
      const input = await readViewingInput(context, catalogViewingCreateSchema)

      return createMovieViewing(session.database, {
        userId: session.user.id,
        catalogItemId
      }, input)
    })

    return context.json(response)
  })

  app.get('/api/catalog/items/:id/viewings/:viewingId', async context => {
    const viewing = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const rawCatalogItemId = context.req.param('id')
      const catalogItemId = validateCatalogItemId(rawCatalogItemId)
      const rawViewingId = context.req.param('viewingId')
      const viewingId = validateCatalogItemId(rawViewingId)

      return findMovieViewing(session.database, {
        userId: session.user.id,
        catalogItemId
      }, viewingId)
    })

    return context.json({ viewing })
  })

  app.patch('/api/catalog/items/:id/viewings/:viewingId', async context => {
    const response = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const rawCatalogItemId = context.req.param('id')
      const catalogItemId = validateCatalogItemId(rawCatalogItemId)
      const rawViewingId = context.req.param('viewingId')
      const viewingId = validateCatalogItemId(rawViewingId)
      const input = await readViewingInput(context, catalogViewingUpdateSchema)

      return updateMovieViewing(session.database, {
        userId: session.user.id,
        catalogItemId,
        viewingId
      }, input)
    })

    return context.json(response)
  })

  app.delete('/api/catalog/items/:id/viewings/:viewingId', async context => {
    const summary = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const rawCatalogItemId = context.req.param('id')
      const catalogItemId = validateCatalogItemId(rawCatalogItemId)
      const rawViewingId = context.req.param('viewingId')
      const viewingId = validateCatalogItemId(rawViewingId)
      const input = await readViewingInput(context, catalogViewingDeleteSchema)

      return deleteMovieViewing(session.database, {
        userId: session.user.id,
        catalogItemId,
        viewingId
      }, input.revision)
    })

    return context.json({ summary })
  })
}

export { registerCatalogMovieViewingRoutes }
