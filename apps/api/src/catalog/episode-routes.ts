import type { Hono } from 'hono'
import { validateCatalogItemId } from './details.ts'
import { CatalogHttpError } from './errors.ts'
import { findCatalogEpisodeListing } from './episodes-repository.ts'
import type { CatalogDependencies, CatalogEnvironment } from './session.ts'

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
}

export { registerCatalogEpisodeRoutes }
