import type { Hono } from 'hono'
import { validateCatalogItemId } from './details.ts'
import { CatalogHttpError } from './errors.ts'
import { validateCatalogEpisodeId } from './episodes.ts'

import {
  findCatalogEpisodeListing,
  findCatalogEpisodeWatchListing,
  markCatalogEpisodeWatched,
  unmarkCatalogEpisodeWatched
} from './episodes-repository.ts'

import { withCatalogSession, type CatalogDependencies, type CatalogEnvironment } from './session.ts'

function registerCatalogEpisodeRoutes(
  app: Hono<CatalogEnvironment>,
  dependencies: CatalogDependencies
): void {
  app.get('/api/catalog/items/:id/episodes', async (context) => {
    const id = validateCatalogItemId(context.req.param('id'))

    // oxlint-disable-next-line eslint/init-declarations -- Catalog connection failures are translated below.
    let adapter: Awaited<ReturnType<CatalogDependencies['connectDatabase']>> | undefined

    // oxlint-disable-next-line eslint/init-declarations -- Catalog database failures are translated below.
    let listing: Awaited<ReturnType<typeof findCatalogEpisodeListing>>

    try {
      adapter = await dependencies.connectDatabase(context.env.DATABASE.connectionString)
      listing = await findCatalogEpisodeListing(adapter.database, id)
    } catch (error) {
      throw new CatalogHttpError('SERVICE_UNAVAILABLE', 503, { cause: error })
    } finally {
      if (adapter !== undefined) {
        await adapter.client.end()
      }
    }

    if (listing === null) {
      throw new CatalogHttpError('NOT_FOUND', 404)
    }

    return context.json({ items: listing.items })
  })

  app.get('/api/catalog/items/:id/episodes/watched', async (context) => {
    const listing = await withCatalogSession(context, dependencies.connectDatabase, async (session) => {
      const id = validateCatalogItemId(context.req.param('id'))

      return findCatalogEpisodeWatchListing(
        session.database,
        session.user.id,
        id
      )
    })

    if (listing === null) {
      throw new CatalogHttpError('NOT_FOUND', 404)
    }

    if (listing.type !== 'series') {
      throw new CatalogHttpError('INVALID_REQUEST', 400, {
        fields: { id: 'Only catalog series have watched episodes.' }
      })
    }

    return context.json({ watchedEpisodeIds: listing.watchedEpisodeIds })
  })

  app.put('/api/catalog/episodes/:id/watched', async (context) => {
    const result = await withCatalogSession(context, dependencies.connectDatabase, async (session) => {
      const id = validateCatalogEpisodeId(context.req.param('id'))

      return markCatalogEpisodeWatched(session.database, session.user.id, id)
    })

    if (result === 'not-found') {
      throw new CatalogHttpError('NOT_FOUND', 404)
    }

    return context.json({ watched: true })
  })

  app.delete('/api/catalog/episodes/:id/watched', async (context) => {
    const exists = await withCatalogSession(context, dependencies.connectDatabase, async (session) => {
      const id = validateCatalogEpisodeId(context.req.param('id'))

      return unmarkCatalogEpisodeWatched(session.database, session.user.id, id)
    })

    if (!exists) {
      throw new CatalogHttpError('NOT_FOUND', 404)
    }

    return context.json({ watched: false })
  })
}

export { registerCatalogEpisodeRoutes }
