import { Hono } from 'hono'
import { requestId } from 'hono/request-id'

// oxlint-disable-next-line import/no-relative-parent-imports -- Catalog reuses the shared API session resolver.
import { resolveCurrentSession } from '../auth/current-session.ts'

// oxlint-disable-next-line import/no-relative-parent-imports -- Protected routes share the auth transport contract.
import { isSessionTransportAllowed } from '../auth/session.ts'
import { CatalogHttpError, createCatalogErrorEnvelope } from './errors.ts'
import { createCatalogDetailsItem, validateCatalogItemId } from './details.ts'
import { registerCatalogEpisodeRoutes } from './episode-routes.ts'
import { registerCatalogImportRoutes } from './import/routes.ts'
import { registerCatalogViewingRoutes } from './viewing-routes.ts'

import {
  findCatalogDetailsRows,
  findCatalogItemFollowed,
  findCatalogReleaseRows,
  findCatalogWatchlistRows,
  findTitleRowsForMatchingCatalogItems,
  followCatalogItem,
  unfollowCatalogItem
} from './repository.ts'

import { findCatalogItemWatchState, markCatalogMovieWatched, unmarkCatalogMovieWatched } from './watched-repository.ts'
import { findCatalogUpcomingReleaseRows } from './upcoming-releases-repository.ts'
import { canonicalizeTitleLocale, createCatalogSearchItems, normalizeCatalogQuery } from './search.ts'

import {
  createCatalogReleaseItems,
  createCatalogUpcomingReleasesResponse,
  validateCatalogReleaseRange,
  validateCatalogUpcomingReleaseQuery
} from './releases.ts'

import { createCatalogWatchlistItems } from './watchlist.ts'

import {
  defaultCatalogDependencies,
  logCatalogServerError,
  withCatalogSession,
  type CatalogDependencies,
  type CatalogEnvironment
} from './session.ts'

function createCatalogApp(
  dependencies: CatalogDependencies = defaultCatalogDependencies
): Hono<CatalogEnvironment> {
  const app = new Hono<CatalogEnvironment>()

  app.use('/api/catalog/*', requestId())

  app.use('/api/catalog/*', async (context, next) => {
    if (!isSessionTransportAllowed(context.req.url)) {
      throw new CatalogHttpError('INVALID_REQUEST', 400)
    }

    // oxlint-disable-next-line node/callback-return -- Hono middleware continues after awaiting next().
    await next()
    context.header('Cache-Control', 'no-store')
  })

  registerCatalogImportRoutes(app, dependencies)

  app.get('/api/catalog/items/:id', async (context) => {
    const id = validateCatalogItemId(context.req.param('id'))
    const url = new URL(context.req.url)
    const titleLocale = canonicalizeTitleLocale(url.searchParams.get('titleLocale'))

    // oxlint-disable-next-line eslint/init-declarations -- Catalog connection failures are translated below.
    let adapter: Awaited<ReturnType<CatalogDependencies['connectDatabase']>> | undefined

    // oxlint-disable-next-line eslint/init-declarations -- Catalog database failures are translated below.
    let rows: Awaited<ReturnType<typeof findCatalogDetailsRows>>

    try {
      adapter = await dependencies.connectDatabase(context.env.DATABASE.connectionString)
      rows = await findCatalogDetailsRows(adapter.database, id)
    } catch (error) {
      throw new CatalogHttpError('SERVICE_UNAVAILABLE', 503, { cause: error })
    } finally {
      if (adapter !== undefined) {
        await adapter.client.end()
      }
    }

    const item = createCatalogDetailsItem(rows, titleLocale)

    if (item === null) {
      throw new CatalogHttpError('NOT_FOUND', 404)
    }

    return context.json({ item })
  })

  registerCatalogEpisodeRoutes(app, dependencies)
  registerCatalogViewingRoutes(app, dependencies)

  app.get('/api/catalog/items/:id/follow', async (context) => {
    const id = validateCatalogItemId(context.req.param('id'))

    const followed = await withCatalogSession(context, dependencies.connectDatabase, async (session) => {
      const result = await findCatalogItemFollowed(
        session.database,
        session.user.id,
        id
      )

      if (result === null) {
        throw new CatalogHttpError('NOT_FOUND', 404)
      }

      return result
    })

    return context.json({ followed })
  })

  app.put('/api/catalog/items/:id/follow', async (context) => {
    const id = validateCatalogItemId(context.req.param('id'))

    await withCatalogSession(context, dependencies.connectDatabase, async (session) => {
      const exists = await followCatalogItem(session.database, session.user.id, id)

      if (!exists) {
        throw new CatalogHttpError('NOT_FOUND', 404)
      }
    })

    return context.json({ followed: true })
  })

  app.delete('/api/catalog/items/:id/follow', async (context) => {
    const id = validateCatalogItemId(context.req.param('id'))

    await withCatalogSession(context, dependencies.connectDatabase, async (session) => {
      const followed = await findCatalogItemFollowed(
        session.database,
        session.user.id,
        id
      )

      if (followed === null) {
        throw new CatalogHttpError('NOT_FOUND', 404)
      }

      await unfollowCatalogItem(session.database, session.user.id, id)
    })

    return context.json({ followed: false })
  })

  app.get('/api/catalog/items/:id/watched', async (context) => {
    const state = await withCatalogSession(context, dependencies.connectDatabase, async (session) => {
      const id = validateCatalogItemId(context.req.param('id'))

      return findCatalogItemWatchState(
        session.database,
        session.user.id,
        id
      )
    })

    if (state === null) {
      throw new CatalogHttpError('NOT_FOUND', 404)
    }

    if (state.type !== 'movie') {
      throw new CatalogHttpError('INVALID_REQUEST', 400, {
        fields: { id: 'Only catalog movies can be marked as watched.' }
      })
    }

    return context.json({ watched: state.watched })
  })

  app.put('/api/catalog/items/:id/watched', async (context) => {
    const result = await withCatalogSession(context, dependencies.connectDatabase, async (session) => {
      const id = validateCatalogItemId(context.req.param('id'))

      return markCatalogMovieWatched(session.database, session.user.id, id)
    })

    if (result === 'not-found') {
      throw new CatalogHttpError('NOT_FOUND', 404)
    }

    if (result === 'not-movie') {
      throw new CatalogHttpError('INVALID_REQUEST', 400, {
        fields: { id: 'Only catalog movies can be marked as watched.' }
      })
    }

    return context.json({ watched: true })
  })

  app.delete('/api/catalog/items/:id/watched', async (context) => {
    await withCatalogSession(context, dependencies.connectDatabase, async (session) => {
      const id = validateCatalogItemId(context.req.param('id'))

      const state = await findCatalogItemWatchState(
        session.database,
        session.user.id,
        id
      )

      if (state === null) {
        throw new CatalogHttpError('NOT_FOUND', 404)
      }

      if (state.type !== 'movie') {
        throw new CatalogHttpError('INVALID_REQUEST', 400, {
          fields: { id: 'Only catalog movies can be marked as watched.' }
        })
      }

      await unmarkCatalogMovieWatched(
        session.database,
        session.user.id,
        id
      )
    })

    return context.json({ watched: false })
  })

  app.get('/api/catalog/watchlist', async (context) => {
    const url = new URL(context.req.url)

    const result = await withCatalogSession(context, dependencies.connectDatabase, async (session) => {
      const titleLocale = canonicalizeTitleLocale(
        url.searchParams.get('titleLocale')
      )

      const rows = await findCatalogWatchlistRows(
        session.database,
        session.user.id
      )

      return {
        rows,
        titleLocale
      }
    })

    const items = createCatalogWatchlistItems(result.rows, result.titleLocale)

    return context.json({ items })
  })

  app.get('/api/catalog/releases', async (context) => {
    const url = new URL(context.req.url)

    const result = await withCatalogSession(context, dependencies.connectDatabase, async (session) => {
      const range = validateCatalogReleaseRange(
        url.searchParams.get('from'),
        url.searchParams.get('to')
      )

      const titleLocale = canonicalizeTitleLocale(
        url.searchParams.get('titleLocale')
      )

      const rows = await findCatalogReleaseRows(
        session.database,
        session.user.id,
        range
      )

      return {
        rows,
        titleLocale
      }
    })

    const items = createCatalogReleaseItems(result.rows, result.titleLocale)

    return context.json({ items })
  })

  app.get('/api/catalog/releases/upcoming', async (context) => {
    const url = new URL(context.req.url)

    const result = await withCatalogSession(context, dependencies.connectDatabase, async (session) => {
      const query = validateCatalogUpcomingReleaseQuery(
        url.searchParams.get('from'),
        url.searchParams.get('cursor')
      )

      const titleLocale = canonicalizeTitleLocale(
        url.searchParams.get('titleLocale')
      )

      const rows = await findCatalogUpcomingReleaseRows(
        session.database,
        session.user.id,
        query
      )

      return {
        rows,
        titleLocale
      }
    })

    const response = createCatalogUpcomingReleasesResponse(result.rows, result.titleLocale)

    return context.json(response)
  })

  app.get('/api/catalog/search', async (context) => {
    // oxlint-disable-next-line eslint/init-declarations -- Session database failures are translated below.
    let session: Awaited<ReturnType<typeof resolveCurrentSession>>

    try {
      session = await resolveCurrentSession(context, async () => {
        const { database } = await dependencies.connectDatabase(
          context.env.DATABASE.connectionString
        )

        return database
      })
    } catch (error) {
      throw new CatalogHttpError('SERVICE_UNAVAILABLE', 503, { cause: error })
    }

    if (session === null) {
      throw new CatalogHttpError('AUTHENTICATION_REQUIRED', 401)
    }

    const url = new URL(context.req.url)
    const query = normalizeCatalogQuery(url.searchParams.get('query'))

    const titleLocale = canonicalizeTitleLocale(
      url.searchParams.get('titleLocale')
    )

    // oxlint-disable-next-line eslint/init-declarations -- Catalog database failures are translated below.
    let rows: Awaited<ReturnType<typeof findTitleRowsForMatchingCatalogItems>>

    try {
      rows = await findTitleRowsForMatchingCatalogItems(
        session.database,
        query
      )
    } catch (error) {
      throw new CatalogHttpError('SERVICE_UNAVAILABLE', 503, { cause: error })
    }

    const items = createCatalogSearchItems(rows, titleLocale)

    return context.json({ items })
  })

  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Hono requires an error callback.
  app.onError((error, context) => {
    const catalogError = error instanceof CatalogHttpError
      ? error
      : new CatalogHttpError('INTERNAL_ERROR', 500, { cause: error })

    if (catalogError.status >= 500) {
      logCatalogServerError(context, catalogError)
    }

    context.header('Cache-Control', 'no-store')

    return context.json(
      createCatalogErrorEnvelope(catalogError),
      catalogError.status
    )
  })

  return app
}

export { createCatalogApp }
