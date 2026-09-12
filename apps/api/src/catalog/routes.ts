import { findRootCause, serializeError } from '@tv/shared/errors'
import { type Context, Hono } from 'hono'
import { requestId, type RequestIdVariables } from 'hono/request-id'

// oxlint-disable-next-line import/no-relative-parent-imports -- Catalog reuses the shared API session resolver.
import { resolveCurrentSession } from '../auth/current-session.ts'

// oxlint-disable-next-line import/no-relative-parent-imports -- Protected routes share the auth transport contract.
import { isSessionTransportAllowed } from '../auth/session.ts'

// oxlint-disable-next-line import/no-relative-parent-imports -- Catalog uses the shared API database adapter.
import { connectDatabaseAdapter } from '../database.ts'
import { CatalogHttpError, createCatalogErrorEnvelope } from './errors.ts'
import { createCatalogDetailsItem, validateCatalogItemId } from './details.ts'

import {
  findCatalogDetailsRows,
  findCatalogItemFollowed,
  findCatalogReleaseRows,
  findCatalogWatchlistRows,
  findTitleRowsForMatchingCatalogItems,
  followCatalogItem,
  unfollowCatalogItem
} from './repository.ts'

import { canonicalizeTitleLocale, createCatalogSearchItems, normalizeCatalogQuery } from './search.ts'
import { createCatalogReleaseItems, validateCatalogReleaseRange } from './releases.ts'
import { createCatalogWatchlistItems } from './watchlist.ts'

interface CatalogEnvironment {
  Bindings: CloudflareBindings;
  Variables: RequestIdVariables;
}

type CatalogContext = Context<CatalogEnvironment>
type CatalogSession = NonNullable<Awaited<ReturnType<typeof resolveCurrentSession>>>
type ConnectCatalogDatabase = typeof connectDatabaseAdapter

interface CatalogDependencies {
  connectDatabase: ConnectCatalogDatabase;
}

interface CatalogOperationFailure {
  error: CatalogHttpError;
  status: 'failure';
}

interface CatalogOperationSuccess<Result> {
  result: Result;
  status: 'success';
}

type CatalogOperationOutcome<Result> = CatalogOperationFailure | CatalogOperationSuccess<Result>

const defaultCatalogDependencies: CatalogDependencies = {
  connectDatabase: connectDatabaseAdapter
}

function toCatalogHttpError(error: unknown): CatalogHttpError {
  return error instanceof CatalogHttpError
    ? error
    : new CatalogHttpError('SERVICE_UNAVAILABLE', 503, { cause: error })
}

async function closeCatalogAdapter(
  adapter: Awaited<ReturnType<ConnectCatalogDatabase>> | undefined
): Promise<CatalogHttpError | null> {
  if (adapter === undefined) {
    return null
  }

  try {
    await adapter.client.end()

    return null
  } catch (error) {
    return new CatalogHttpError('SERVICE_UNAVAILABLE', 503, { cause: error })
  }
}

async function captureCatalogOperation<Result>(operation: () => Promise<Result>): Promise<CatalogOperationOutcome<Result>> {
  try {
    const result = await operation()

    return {
      result,
      status: 'success'
    }
  } catch (error) {
    return {
      error: toCatalogHttpError(error),
      status: 'failure'
    }
  }
}

function logCatalogServerError(
  context: CatalogContext,
  error: CatalogHttpError
): void {
  const technicalError = findRootCause(error.cause ?? error)
  const serializedTechnicalError = serializeError(technicalError)

  const logEntry = JSON.stringify({
    code: error.code,
    error: serializedTechnicalError,
    message: 'catalog request failed',
    requestId: context.get('requestId')
  })

  // oxlint-disable-next-line eslint/no-console -- Worker logs retain safe technical failures and request IDs.
  console.error(logEntry)
}

async function withCatalogSession<Result>(
  context: CatalogContext,
  connectDatabase: ConnectCatalogDatabase,
  operation: (session: CatalogSession) => Promise<Result>
): Promise<Result> {
  let adapter: Awaited<ReturnType<typeof connectDatabaseAdapter>> | undefined = undefined

  const operationOutcome = await captureCatalogOperation(async () => {
    const session = await resolveCurrentSession(context, async () => {
      adapter = await connectDatabase(
        context.env.DATABASE.connectionString
      )

      return adapter.database
    })

    if (session === null) {
      throw new CatalogHttpError('AUTHENTICATION_REQUIRED', 401)
    }

    return operation(session)
  })

  const closeError = await closeCatalogAdapter(adapter)

  if (operationOutcome.status === 'failure') {
    if (closeError !== null) {
      logCatalogServerError(context, closeError)
    }

    throw operationOutcome.error
  }

  if (closeError !== null) {
    throw closeError
  }

  return operationOutcome.result
}

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

  app.get('/api/catalog/items/:id', async (context) => {
    const id = validateCatalogItemId(context.req.param('id'))
    const url = new URL(context.req.url)
    const titleLocale = canonicalizeTitleLocale(url.searchParams.get('titleLocale'))

    // oxlint-disable-next-line eslint/init-declarations -- Catalog connection failures are translated below.
    let adapter: Awaited<ReturnType<typeof connectDatabaseAdapter>> | undefined

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
