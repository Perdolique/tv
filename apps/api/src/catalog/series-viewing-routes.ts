import type { Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import * as v from 'valibot'

import {
  catalogSeriesBulkWatchSchema,
  catalogSeriesRewatchSchema,
  catalogSeriesUnwatchSchema,
  catalogSeriesWatchSchema
} from '@tv/shared/catalog-series'

import { validateCatalogItemId } from './details.ts'
import { validateCatalogEpisodeId } from './episodes.ts'
import { CatalogHttpError } from './errors.ts'

import {
  findSeriesWatches,
  markSeriesEpisodeWatched,
  markSeriesEpisodesWatched,
  startSeriesRewatch,
  unmarkSeriesEpisodeWatched
} from './series-viewings-repository.ts'

import { withCatalogSession, type CatalogDependencies, type CatalogEnvironment } from './session.ts'

const seriesBodyLimit = bodyLimit({
  maxSize: 2 ** 14,
  onError: () => { throw new CatalogHttpError('INVALID_REQUEST', 413) }
})

async function readSeriesInput<Schema extends v.GenericSchema>(context: Context<CatalogEnvironment>, schema: Schema): Promise<v.InferOutput<Schema>> {
  const header = context.req.header('Content-Type')
  const mediaType = header?.split(';', 1)[0]
  const trimmedMediaType = mediaType?.trim()
  const contentType = trimmedMediaType?.toLowerCase()

  if (contentType !== 'application/json') {
    // Previous clients have no stable viewing context and cannot safely write.
    throw new CatalogHttpError('CONFLICT', 409)
  }

  // oxlint-disable-next-line typescript/no-unsafe-argument -- Hono middleware uses a broader Context generic than this route.
  await seriesBodyLimit(context, async () => {
    // Session authentication precedes the body size check.
  })

  const input: unknown = await context.req.json().catch(() => null)

  if (input === null || typeof input !== 'object' || !('currentViewingId' in input) || !('contextVersion' in input)) {
    throw new CatalogHttpError('CONFLICT', 409)
  }

  const parsed = v.safeParse(schema, input)

  if (!parsed.success) {
    const flattened = v.flatten(parsed.issues)
    const fields: Record<string, string> = {}
    const fieldErrors = Object.entries(flattened.nested ?? {})

    for (const [name, messages] of fieldErrors) {
      const message = messages?.[0]

      if (message !== undefined) {
        fields[name] = message
      }
    }

    throw new CatalogHttpError('INVALID_REQUEST', 400, { fields })
  }

  return parsed.output
}

function registerCatalogSeriesViewingRoutes(app: Hono<CatalogEnvironment>, dependencies: CatalogDependencies): void {
  app.get('/api/catalog/items/:id/episodes/watched', async context => {
    const response = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const rawId = context.req.param('id')
      const catalogItemId = validateCatalogItemId(rawId)

      return findSeriesWatches(session.database, {
        userId: session.user.id,
        catalogItemId
      })
    })

    return context.json(response)
  })

  app.put('/api/catalog/episodes/:id/watched', async context => {
    const response = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const rawId = context.req.param('id')
      const episodeId = validateCatalogEpisodeId(rawId)
      const input = await readSeriesInput(context, catalogSeriesWatchSchema)

      return markSeriesEpisodeWatched(session.database, session.user.id, episodeId, input)
    })

    return context.json(response)
  })

  app.delete('/api/catalog/episodes/:id/watched', async context => {
    const response = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const rawId = context.req.param('id')
      const episodeId = validateCatalogEpisodeId(rawId)
      const input = await readSeriesInput(context, catalogSeriesUnwatchSchema)

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

      if (!/^\d+$/u.test(rawSeason) || !Number.isSafeInteger(seasonNumber) || seasonNumber < 1) {
        throw new CatalogHttpError('INVALID_REQUEST', 400, { fields: { seasonNumber: 'Use a positive season number.' } })
      }

      const input = await readSeriesInput(context, catalogSeriesBulkWatchSchema)

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
      const input = await readSeriesInput(context, catalogSeriesBulkWatchSchema)

      return markSeriesEpisodesWatched(session.database, {
        userId: session.user.id,
        catalogItemId
      }, input, null)
    })

    return context.json(response)
  })

  app.post('/api/catalog/items/:id/rewatch', async context => {
    const response = await withCatalogSession(context, dependencies.connectDatabase, async session => {
      const rawId = context.req.param('id')
      const catalogItemId = validateCatalogItemId(rawId)
      const input = await readSeriesInput(context, catalogSeriesRewatchSchema)

      return startSeriesRewatch(session.database, {
        userId: session.user.id,
        catalogItemId
      }, input)
    })

    return context.json(response)
  })
}

export { registerCatalogSeriesViewingRoutes }
