/* oxlint-disable eslint/max-lines -- Keeping auth route middleware and lifecycle orchestration together makes the security contract auditable. */
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getCookie, setCookie } from 'hono/cookie'
import { requestId, type RequestIdVariables } from 'hono/request-id'
import { findRootCause, serializeError } from '@tv/shared/errors'
import { TURNSTILE_ACTIONS, type TurnstileAction } from '@tv/shared/turnstile'
// oxlint-disable-next-line import/no-relative-parent-imports -- Auth uses the shared API database adapter.
import { connectDatabaseAdapter } from '../database.ts'

import {
  AUTH_BODY_SIZE_LIMIT,
  DUMMY_PASSWORD_HASH,
  RATE_LIMIT_RETRY_SECONDS,
  SESSION_DURATION_MILLISECONDS,
  VERIFICATION_TOKEN_DURATION_MILLISECONDS
} from './constants.ts'

import { createExistingAccountEmail, createVerificationEmail } from './email.ts'
import { AuthHttpError, createErrorEnvelope } from './errors.ts'
import { hashPassword, verifyPassword } from './password.ts'
import { isPasswordCompromised, PwnedPasswordsUnavailableError } from './pwned-passwords.ts'
import { readRequiredJsonBody, requireEmptyBody } from './request-body.ts'
import { enforceRateLimit } from './rate-limit.ts'

import {
  completeRegistration,
  createSession,
  deleteSession,
  deleteVerificationToken,
  findPasswordCredential,
  findUserBySession,
  findValidVerificationToken,
  issueVerificationToken
} from './repository.ts'

import {
  createSessionToken,
  getExpiredSessionCookieOptions,
  getSessionCookieName,
  getSessionCookieOptions,
  hashSessionToken,
  isSessionTransportAllowed,
  isSessionToken
} from './session.ts'

import {
  validateRegistrationCompletionEnvelope,
  validateRegistrationPassword,
  validateRegistrationRequest,
  validateSignInCredentials
} from './validation.ts'

import { createVerificationToken, hashVerificationToken } from './verification.ts'
import { readTurnstileToken, verifyTurnstileToken } from './turnstile.ts'

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
  rateLimiter: RateLimit,
  normalizedEmail: string
): Promise<void> {
  const emailHash = await enforceRateLimit(
    rateLimiter,
    normalizedEmail
  )

  context.set('emailHash', emailHash)
}

async function requireTurnstile(
  context: AuthContext,
  body: unknown,
  expectedAction: TurnstileAction
): Promise<void> {
  const token = readTurnstileToken(body)
  const expectedHostname = new URL(context.req.url).hostname
  const remoteIp = context.req.header('CF-Connecting-IP')

  await verifyTurnstileToken({
    expectedAction,
    expectedHostname,
    remoteIp,
    secret: context.env.TURNSTILE_SECRET,
    token
  })
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

function logServerError(context: AuthContext, error: AuthHttpError): void {
  const technicalError = findRootCause(error.cause ?? error)
  const serializedTechnicalError = serializeError(technicalError)
  const emailHash = context.get('emailHash')
  const authRequestId = context.get('requestId')

  const logEntry = JSON.stringify({
    code: error.code,
    emailHash,
    error: serializedTechnicalError,
    message: 'auth request failed',
    requestId: authRequestId
  })

  // oxlint-disable-next-line eslint/no-console -- Worker logs retain safe technical failures and request IDs.
  console.error(logEntry)
}

function logCleanupError(context: AuthContext, error: unknown): void {
  const technicalError = findRootCause(error)
  const serializedTechnicalError = serializeError(technicalError)

  const logEntry = JSON.stringify({
    code: 'VERIFICATION_TOKEN_CLEANUP_FAILED',
    emailHash: context.get('emailHash'),
    error: serializedTechnicalError,
    message: 'verification token cleanup failed',
    requestId: context.get('requestId')
  })

  // oxlint-disable-next-line eslint/no-console -- Worker logs retain safe technical failures and request IDs.
  console.error(logEntry)
}

function createAuthApp(): Hono<AuthEnvironment> {
  const app = new Hono<AuthEnvironment>()
  const jsonBodyLimit = createJsonBodyLimit()

  app.use('/api/auth/*', requestId())

  app.use('/api/auth/*', async (context, next) => {
    if (!isSessionTransportAllowed(context.req.url)) {
      throw new AuthHttpError('INVALID_REQUEST', 400)
    }

    // oxlint-disable-next-line node/callback-return -- Hono middleware continues after awaiting next().
    await next()

    context.header('Cache-Control', 'no-store')
  })

  app.post('/api/auth/register', jsonBodyLimit, async (context) => {
    const body = await readRequiredJsonBody(context.req.raw)
    const registration = validateRegistrationRequest(body)

    await requireTurnstile(context, body, TURNSTILE_ACTIONS.register)

    await applyRateLimit(
      context,
      context.env.REGISTRATION_EMAIL_RATE_LIMITER,
      registration.email
    )

    const { database } = await connectDatabase(context)
    const token = createVerificationToken()
    const tokenHash = await hashVerificationToken(token)
    const now = new Date()
    const expiresAt = new Date(now.getTime() + VERIFICATION_TOKEN_DURATION_MILLISECONDS)
    // oxlint-disable-next-line eslint/init-declarations -- Database failures are translated below.
    let verificationTokenIssued: boolean

    try {
      verificationTokenIssued = await issueVerificationToken(database, {
        email: registration.email,
        expiresAt,
        redirectTo: registration.redirectTo,
        tokenHash
      }, now)
    } catch (error) {
      throw new AuthHttpError('SERVICE_UNAVAILABLE', 503, { cause: error })
    }

    const message = verificationTokenIssued
      ? createVerificationEmail({
          email: registration.email,
          token,
          webOrigin: context.env.WEB_ORIGIN
        })
      : createExistingAccountEmail({
          email: registration.email,
          redirectTo: registration.redirectTo,
          webOrigin: context.env.WEB_ORIGIN
        })

    try {
      await context.env.EMAIL.send(message)
    } catch (error) {
      if (verificationTokenIssued) {
        try {
          await deleteVerificationToken(database, tokenHash)
        } catch (cleanupError) {
          logCleanupError(context, cleanupError)
        }
      }

      throw new AuthHttpError('SERVICE_UNAVAILABLE', 503, { cause: error })
    }

    return context.json({ status: 'accepted' }, 202)
  })

  app.post('/api/auth/register/complete', jsonBodyLimit, async (context) => {
    const body = await readRequiredJsonBody(context.req.raw)
    const completion = validateRegistrationCompletionEnvelope(body)
    const tokenHash = await hashVerificationToken(completion.token)
    const { database } = await connectDatabase(context)
    const now = new Date()
    // oxlint-disable-next-line eslint/init-declarations -- Database failures are translated below.
    let verification: Awaited<ReturnType<typeof findValidVerificationToken>>

    try {
      verification = await findValidVerificationToken(database, tokenHash, now)
    } catch (error) {
      throw new AuthHttpError('SERVICE_UNAVAILABLE', 503, { cause: error })
    }

    if (verification === null) {
      throw new AuthHttpError('INVALID_VERIFICATION', 400)
    }

    await applyRateLimit(
      context,
      context.env.REGISTRATION_ACTIVATION_RATE_LIMITER,
      verification.email
    )

    const password = validateRegistrationPassword(completion.password)

    try {
      const compromised = await isPasswordCompromised(password)

      if (compromised) {
        throw new AuthHttpError('PASSWORD_COMPROMISED', 400, {
          fields: {
            password: 'Choose a password that has not appeared in a known data breach.'
          }
        })
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
      passwordHash = await hashPassword(password)
    } catch (error) {
      throw new AuthHttpError('INTERNAL_ERROR', 500, { cause: error })
    }

    // oxlint-disable-next-line eslint/init-declarations -- Database failures are translated below.
    let account: Awaited<ReturnType<typeof completeRegistration>>

    try {
      account = await completeRegistration(database, {
        email: verification.email,
        passwordHash,
        tokenHash
      }, new Date())
    } catch (error) {
      throw new AuthHttpError('SERVICE_UNAVAILABLE', 503, { cause: error })
    }

    if (account === null) {
      throw new AuthHttpError('INVALID_VERIFICATION', 400)
    }

    return context.json({
      email: account.email,
      redirectTo: account.redirectTo,
      status: 'created'
    }, 201)
  })

  app.post('/api/auth/sign-in', jsonBodyLimit, async (context) => {
    const body = await readRequiredJsonBody(context.req.raw)
    const credentials = validateSignInCredentials(body)

    await requireTurnstile(context, body, TURNSTILE_ACTIONS.signIn)

    await applyRateLimit(
      context,
      context.env.SIGN_IN_RATE_LIMITER,
      credentials.email
    )

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

  app.get('/api/auth/session', async (context) => {
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

  app.post('/api/auth/sign-out', jsonBodyLimit, async (context) => {
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
