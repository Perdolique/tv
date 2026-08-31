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
import { searchCatalogTitleRows } from './repository.ts'
import { canonicalizeTitleLocale, createCatalogSearchItems, normalizeCatalogQuery } from './search.ts'

interface CatalogEnvironment {
  Bindings: CloudflareBindings;
  Variables: RequestIdVariables;
}

type CatalogContext = Context<CatalogEnvironment>

function logCatalogServerError(
  context: CatalogContext,
  error: CatalogHttpError
): void {
  const technicalError = findRootCause(error.cause ?? error)
  const serializedTechnicalError = serializeError(technicalError)

  const logEntry = JSON.stringify({
    code: error.code,
    error: serializedTechnicalError,
    message: 'catalog search request failed',
    requestId: context.get('requestId')
  })

  // oxlint-disable-next-line eslint/no-console -- Worker logs retain safe technical failures and request IDs.
  console.error(logEntry)
}

function createCatalogApp(): Hono<CatalogEnvironment> {
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

  app.get('/api/catalog/search', async (context) => {
    // oxlint-disable-next-line eslint/init-declarations -- Session database failures are translated below.
    let session: Awaited<ReturnType<typeof resolveCurrentSession>>

    try {
      session = await resolveCurrentSession(context, async () => {
        const { database } = await connectDatabaseAdapter(
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
    let rows: Awaited<ReturnType<typeof searchCatalogTitleRows>>

    try {
      rows = await searchCatalogTitleRows(session.database, query)
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
