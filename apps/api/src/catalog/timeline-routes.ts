import type { Context, Hono } from 'hono'
import { catalogTimelineEpisodesQuerySchema, catalogTimelineQuerySchema } from '@tv/shared/catalog-timeline'
import * as v from 'valibot'
import { validateCatalogItemId } from './details.ts'
import { CatalogHttpError } from './errors.ts'
import { withCatalogSession, type CatalogDependencies, type CatalogEnvironment } from './session.ts'
import { findCatalogTimeline, findCatalogTimelineEpisodes } from './timeline-repository.ts'

function readTimelineQuery<Schema extends v.GenericSchema>(context: Context<CatalogEnvironment>, schema: Schema): v.InferOutput<Schema> {
  const queries = context.req.queries()
  const entries: [string, string][] = []
  const queryEntries = Object.entries(queries)

  for (const [key, values] of queryEntries) {
    const [value] = values

    if (values.length !== 1 || value === undefined) {
      throw new CatalogHttpError('INVALID_REQUEST', 400, { fields: { [key]: 'Use one value for this query field.' } })
    }

    entries.push([key, value])
  }

  const input = Object.fromEntries(entries)
  const parsed = v.safeParse(schema, input)

  if (!parsed.success) {
    const flattened = v.flatten(parsed.issues)
    const fields: Record<string, string> = {}
    const fieldErrors = Object.entries(flattened.nested ?? {})

    for (const [key, messages] of fieldErrors) {
      const message = messages?.[0]

      if (message !== undefined) {
        fields[key] = message
      }
    }

    throw new CatalogHttpError('INVALID_REQUEST', 400, { fields })
  }

  return parsed.output
}

function registerCatalogTimelineRoutes(app: Hono<CatalogEnvironment>, dependencies: CatalogDependencies): void {
  app.get('/api/catalog/items/:id/timeline', async context => {
    const response = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const rawId = context.req.param('id')
      const catalogItemId = validateCatalogItemId(rawId)
      const query = readTimelineQuery(context, catalogTimelineQuerySchema)

      return findCatalogTimeline(session.database, {
        userId: session.user.id,
        catalogItemId
      }, query)
    })

    return context.json(response)
  })

  app.get('/api/catalog/items/:id/timeline/episodes', async context => {
    const response = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const rawId = context.req.param('id')
      const catalogItemId = validateCatalogItemId(rawId)
      const query = readTimelineQuery(context, catalogTimelineEpisodesQuerySchema)

      return findCatalogTimelineEpisodes(session.database, {
        userId: session.user.id,
        catalogItemId
      }, query)
    })

    return context.json(response)
  })
}

export { registerCatalogTimelineRoutes }
