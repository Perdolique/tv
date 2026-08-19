import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getCookie, setCookie } from 'hono/cookie'
import { requestId, type RequestIdVariables } from 'hono/request-id'
// oxlint-disable-next-line import/no-relative-parent-imports -- Auth uses the shared API database adapter.
import { connectDatabaseAdapter } from '../database.ts'

import {
  AUTH_BODY_SIZE_LIMIT,
  DUMMY_PASSWORD_HASH,
  RATE_LIMIT_RETRY_SECONDS,
  SESSION_DURATION_MILLISECONDS
} from './constants.ts'

import { AuthHttpError, createErrorEnvelope } from './errors.ts'
import { hashPassword, verifyPassword } from './password.ts'
import { isPasswordCompromised, PwnedPasswordsUnavailableError } from './pwned-passwords.ts'
import { readRequiredJsonBody, requireEmptyBody } from './request-body.ts'
import { enforceRateLimit, type AuthOperation } from './rate-limit.ts'
import { createSession, deleteSession, findPasswordCredential, findUserBySession, registerUser } from './repository.ts'

import {
  createSessionToken,
  getExpiredSessionCookieOptions,
  getSessionCookieName,
  getSessionCookieOptions,
  hashSessionToken,
  isSessionTransportAllowed,
  isSessionToken
} from './session.ts'

import type { Credentials } from './types.ts'
import { validateRegistrationCredentials, validateSignInCredentials } from './validation.ts'

interface AuthVariables extends RequestIdVariables {
  emailHash: string | undefined;
}

interface AuthEnvironment {
  Bindings: CloudflareBindings;
  Variables: AuthVariables;
}

type AuthContext = Context<AuthEnvironment>

function createJsonBodyLimit() {
  return bodyLimit({
    maxSize: AUTH_BODY_SIZE_LIMIT,

    onError: (context) => {
      const error = new AuthHttpError('INVALID_REQUEST', 413)

      return context.json(createErrorEnvelope(error), error.status)
    }
  })
}

async function applyRateLimit(
  context: AuthContext,
  operation: AuthOperation,
  credentials: Credentials
): Promise<void> {
  const emailHash = await enforceRateLimit(
    context.env.AUTH_RATE_LIMITER,
    operation,
    credentials.email
  )

  context.set('emailHash', emailHash)
}

async function connectDatabase(context: AuthContext) {
  try {
    return await connectDatabaseAdapter(context.env.DATABASE.connectionString)
  } catch (error) {
    throw new AuthHttpError('SERVICE_UNAVAILABLE', 503, { cause: error })
  }
}

async function getCurrentTokenHash(context: AuthContext): Promise<string | undefined> {
  const cookieName = getSessionCookieName(context.req.url)
  const token = getCookie(context, cookieName)

  if (!isSessionToken(token)) {
    return
  }

  return hashSessionToken(token)
}

function setSessionCookie(context: AuthContext, token: string): void {
  const cookieName = getSessionCookieName(context.req.url)
  const options = getSessionCookieOptions(context.req.url)

  setCookie(context, cookieName, token, options)
}

function clearSessionCookie(context: AuthContext): void {
  const cookieName = getSessionCookieName(context.req.url)
  const options = getExpiredSessionCookieOptions(context.req.url)

  setCookie(context, cookieName, '', options)
}

interface SerializedError {
  message: string;
  name: string;
  stack?: string;
}

function serializeError(error: unknown): SerializedError {
  if (!(error instanceof Error)) {
    return {
      message: String(error),
      name: 'UnknownError'
    }
  }

  const serializedError: SerializedError = {
    message: error.message,
    name: error.name
  }

  if (error.stack !== undefined && error.stack !== '') {
    serializedError.stack = error.stack
  }

  return serializedError
}

function findRootCause(error: unknown): unknown {
  const visitedErrors = new Set<Error>()
  let rootCause = error

  while (
    rootCause instanceof Error
    && rootCause.cause !== undefined
    && !visitedErrors.has(rootCause)
  ) {
    visitedErrors.add(rootCause)
    rootCause = rootCause.cause
  }

  return rootCause
}

function logServerError(context: AuthContext, error: AuthHttpError): void {
  const technicalError = findRootCause(error.cause ?? error)

  // oxlint-disable-next-line eslint/no-console -- Worker logs retain safe technical failures and request IDs.
  console.error(JSON.stringify({
    code: error.code,
    emailHash: context.get('emailHash'),
    error: serializeError(technicalError),
    message: 'auth request failed',
    requestId: context.get('requestId')
  }))
}

function createAuthApp(): Hono<AuthEnvironment> {
  const app = new Hono<AuthEnvironment>()
  const jsonBodyLimit = createJsonBodyLimit()

  app.use('/auth/*', requestId())

  app.use('/auth/*', async (context, next) => {
    if (!isSessionTransportAllowed(context.req.url)) {
      throw new AuthHttpError('INVALID_REQUEST', 400)
    }

    // oxlint-disable-next-line node/callback-return -- Hono middleware continues after awaiting next().
    await next()

    context.header('Cache-Control', 'no-store')
  })

  app.post('/auth/register', jsonBodyLimit, async (context) => {
    const body = await readRequiredJsonBody(context.req.raw)
    const credentials = validateRegistrationCredentials(body)

    await applyRateLimit(context, 'register', credentials)

    try {
      const compromised = await isPasswordCompromised(credentials.password)

      if (compromised) {
        throw new AuthHttpError('PASSWORD_COMPROMISED', 400)
      }
    } catch (error) {
      if (error instanceof AuthHttpError) {
        throw error
      }

      if (error instanceof PwnedPasswordsUnavailableError) {
        throw new AuthHttpError('SERVICE_UNAVAILABLE', 503, { cause: error })
      }

      throw error
    }

    // oxlint-disable-next-line eslint/init-declarations -- The catch block translates hashing failures.
    let passwordHash: string

    try {
      passwordHash = await hashPassword(credentials.password)
    } catch (error) {
      throw new AuthHttpError('INTERNAL_ERROR', 500, { cause: error })
    }

    const { database } = await connectDatabase(context)

    try {
      await registerUser(database, credentials.email, passwordHash)
    } catch (error) {
      throw new AuthHttpError('SERVICE_UNAVAILABLE', 503, { cause: error })
    }

    return context.json({ status: 'accepted' }, 202)
  })

  app.post('/auth/sign-in', jsonBodyLimit, async (context) => {
    const body = await readRequiredJsonBody(context.req.raw)
    const credentials = validateSignInCredentials(body)

    await applyRateLimit(context, 'sign-in', credentials)

    const { database } = await connectDatabase(context)
    // oxlint-disable-next-line eslint/init-declarations -- The catch block translates database failures.
    let credential: Awaited<ReturnType<typeof findPasswordCredential>>

    try {
      credential = await findPasswordCredential(database, credentials.email)
    } catch (error) {
      throw new AuthHttpError('SERVICE_UNAVAILABLE', 503, { cause: error })
    }

    const passwordHash = credential?.passwordHash ?? DUMMY_PASSWORD_HASH
    // oxlint-disable-next-line eslint/init-declarations -- The catch block translates hashing failures.
    let passwordMatches: boolean

    try {
      passwordMatches = await verifyPassword(credentials.password, passwordHash)
    } catch (error) {
      throw new AuthHttpError('INTERNAL_ERROR', 500, { cause: error })
    }

    if (credential === null || passwordMatches === false) {
      throw new AuthHttpError('INVALID_CREDENTIALS', 401)
    }

    const token = createSessionToken()
    const tokenHash = await hashSessionToken(token)
    const currentTokenHash = await getCurrentTokenHash(context)
    const now = new Date()
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_MILLISECONDS)

    try {
      await createSession(database, {
        currentTokenHash,
        expiresAt,
        tokenHash,
        userId: credential.user.id
      }, now)
    } catch (error) {
      throw new AuthHttpError('SERVICE_UNAVAILABLE', 503, { cause: error })
    }

    setSessionCookie(context, token)

    return context.json({ user: credential.user })
  })

  app.get('/auth/session', async (context) => {
    const cookieName = getSessionCookieName(context.req.url)
    const token = getCookie(context, cookieName)

    if (token === undefined || token.length === 0) {
      return context.json({ user: null })
    }

    if (!isSessionToken(token)) {
      clearSessionCookie(context)

      return context.json({ user: null })
    }

    const tokenHash = await hashSessionToken(token)
    const { database } = await connectDatabase(context)
    // oxlint-disable-next-line eslint/init-declarations -- The catch block translates database failures.
    let user: Awaited<ReturnType<typeof findUserBySession>>

    try {
      user = await findUserBySession(database, tokenHash, new Date())
    } catch (error) {
      throw new AuthHttpError('SERVICE_UNAVAILABLE', 503, { cause: error })
    }

    if (user === null) {
      clearSessionCookie(context)
    }

    return context.json({ user })
  })

  app.post('/auth/sign-out', jsonBodyLimit, async (context) => {
    await requireEmptyBody(context.req.raw)

    const tokenHash = await getCurrentTokenHash(context)

    if (tokenHash !== undefined) {
      const { database } = await connectDatabase(context)

      try {
        await deleteSession(database, tokenHash)
      } catch (error) {
        throw new AuthHttpError('SERVICE_UNAVAILABLE', 503, { cause: error })
      }
    }

    clearSessionCookie(context)

    return context.body(null, 204)
  })

  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Hono requires an error callback.
  app.onError((error, context) => {
    const authError = error instanceof AuthHttpError
      ? error
      : new AuthHttpError('INTERNAL_ERROR', 500, { cause: error })

    if (authError.status >= 500) {
      logServerError(context, authError)
    }

    if (authError.code === 'RATE_LIMITED') {
      context.header('Retry-After', String(RATE_LIMIT_RETRY_SECONDS))
    }

    context.header('Cache-Control', 'no-store')

    return context.json(createErrorEnvelope(authError), authError.status)
  })

  return app
}

export { createAuthApp }
