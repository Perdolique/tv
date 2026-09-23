import { findRootCause, serializeError } from '@tv/shared/errors'
import type { Context } from 'hono'
import type { RequestIdVariables } from 'hono/request-id'

// oxlint-disable-next-line import/no-relative-parent-imports -- Catalog reuses the shared API session resolver.
import { resolveCurrentSession } from '../auth/current-session.ts'

// oxlint-disable-next-line import/no-relative-parent-imports -- Catalog uses the shared API database adapter.
import { connectDatabaseAdapter } from '../database.ts'
import { CatalogHttpError } from './errors.ts'
import { hasCatalogImportPermission } from './permissions.ts'

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

// Import handlers use this boundary so each request checks the current database grant.
async function withCatalogImportAccess<Result>(
  context: CatalogContext,
  connectDatabase: ConnectCatalogDatabase,
  operation: (session: CatalogSession) => Promise<Result>
): Promise<Result> {
  return withCatalogSession(context, connectDatabase, async (session) => {
    const allowed = await hasCatalogImportPermission(session.database, session.user.id)

    if (!allowed) {
      throw new CatalogHttpError('FORBIDDEN', 403)
    }

    return operation(session)
  })
}

export {
  defaultCatalogDependencies,
  logCatalogServerError,
  withCatalogImportAccess,
  withCatalogSession
}

export type {
  CatalogDependencies,
  CatalogEnvironment
}
