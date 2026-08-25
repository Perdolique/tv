/* oxlint-disable eslint/max-lines -- The fake Worker keeps the complete browser auth contract in one auditable test service. */
import { longEmail } from './constants.ts'

import {
  TURNSTILE_ACTIONS,
  TURNSTILE_RESPONSE_FIELD,
  type TurnstileAction
} from '../../../packages/shared/src/turnstile.ts'

import { isRecord } from '../../../packages/shared/src/type-guards.ts'

interface Credentials {
  email: string;
  password: string;
  turnstileToken: unknown;
}

interface RegistrationRequest {
  email: string;
  redirectTo: string;
  turnstileToken: unknown;
}

interface RegistrationCompletionRequest {
  password: string;
  token: string;
}

interface SafeErrorOptions {
  code:
    | 'BOT_VERIFICATION_FAILED'
    | 'INVALID_CREDENTIALS'
    | 'INVALID_REQUEST'
    | 'INVALID_VERIFICATION'
    | 'PASSWORD_COMPROMISED'
    | 'SERVICE_UNAVAILABLE';
  fields?: Record<string, string>;
  headers?: HeadersInit;
  message: string;
  status: number;
}

const AUTHENTICATED_USER = {
  email: 'viewer@example.com',
  id: 'user-e2e'
} as const

const VALID_VERIFICATION_TOKEN = 'v'.repeat(43)
const COMPROMISED_VERIFICATION_TOKEN = 'c'.repeat(43)
const UNAVAILABLE_VERIFICATION_TOKEN = 'u'.repeat(43)
const SESSION_COOKIE = 'tv_session=e2e-session'
const LONG_EMAIL_SESSION_COOKIE = 'tv_session=e2e-long-email-session'

const LONG_EMAIL_USER = {
  email: longEmail,
  id: 'user-e2e-long-email'
} as const

const usedTurnstileTokens = new Set<string>()

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers)

  responseHeaders.set('Cache-Control', 'no-store')
  responseHeaders.set('Content-Type', 'application/json')

  return Response.json(body, {
    headers: responseHeaders,
    status
  })
}

function safeError(options: SafeErrorOptions): Response {
  return json({
    error: {
      code: options.code,
      message: options.message,
      ...(options.fields === undefined ? {} : { fields: options.fields })
    }
  }, options.status, options.headers)
}

function hasCookie(request: Request, cookie: string): boolean {
  const cookieHeader = request.headers.get('Cookie') ?? ''

  return cookieHeader.split(';').some(value => value.trim() === cookie)
}

async function readCredentials(request: Request): Promise<Credentials | null> {
  // oxlint-disable-next-line eslint/init-declarations -- Invalid JSON is handled as a malformed request.
  let value: unknown

  try {
    value = await request.json()
  } catch {
    return null
  }

  if (
    !isRecord(value)
    || !('email' in value)
    || !('password' in value)
    || typeof value.email !== 'string'
    || typeof value.password !== 'string'
  ) {
    return null
  }

  return {
    email: value.email,
    password: value.password,
    turnstileToken: value[TURNSTILE_RESPONSE_FIELD]
  }
}

async function readRegistrationRequest(request: Request): Promise<RegistrationRequest | null> {
  const value: unknown = await request.json().catch(() => null)

  if (
    !isRecord(value)
    || !('email' in value)
    || !('redirectTo' in value)
    || typeof value.email !== 'string'
    || typeof value.redirectTo !== 'string'
  ) {
    return null
  }

  return {
    email: value.email,
    redirectTo: value.redirectTo,
    turnstileToken: value[TURNSTILE_RESPONSE_FIELD]
  }
}

async function readRegistrationCompletionRequest(
  request: Request
): Promise<RegistrationCompletionRequest | null> {
  const value: unknown = await request.json().catch(() => null)

  if (
    typeof value !== 'object'
    || value === null
    || !('password' in value)
    || !('token' in value)
    || typeof value.password !== 'string'
    || typeof value.token !== 'string'
  ) {
    return null
  }

  return {
    password: value.password,
    token: value.token
  }
}

function consumeTurnstileToken(
  value: unknown,
  expectedAction: TurnstileAction
): boolean {
  const expectedPrefix = `test-turnstile-${expectedAction}-`

  if (
    typeof value !== 'string'
    || !value.startsWith(expectedPrefix)
    || usedTurnstileTokens.has(value)
  ) {
    return false
  }

  usedTurnstileTokens.add(value)

  return true
}

function botVerificationError(): Response {
  return safeError({
    code: 'BOT_VERIFICATION_FAILED',
    message: 'Complete the security check and try again.',
    status: 403
  })
}

async function handleRegister(request: Request): Promise<Response> {
  const registration = await readRegistrationRequest(request)

  if (registration === null) {
    return safeError({
      code: 'INVALID_REQUEST',
      message: 'The request is invalid.',
      status: 400
    })
  }

  if (!consumeTurnstileToken(
    registration.turnstileToken,
    TURNSTILE_ACTIONS.register
  )) {
    return botVerificationError()
  }

  if (registration.email === 'registration-unavailable@example.com') {
    return safeError({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Authentication is temporarily unavailable.',
      status: 503
    })
  }

  return json({ status: 'accepted' }, 202)
}

async function handleRegistrationCompletion(request: Request): Promise<Response> {
  const completion = await readRegistrationCompletionRequest(request)

  if (completion === null) {
    return safeError({
      code: 'INVALID_REQUEST',
      message: 'The request is invalid.',
      status: 400
    })
  }

  if (completion.token === COMPROMISED_VERIFICATION_TOKEN) {
    return safeError({
      code: 'PASSWORD_COMPROMISED',

      fields: {
        password: 'Choose a password that has not appeared in a known data breach.'
      },

      message: 'Choose a password that has not appeared in a known data breach.',
      status: 400
    })
  }

  if (completion.token === UNAVAILABLE_VERIFICATION_TOKEN) {
    return safeError({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Authentication is temporarily unavailable.',
      status: 503
    })
  }

  if (completion.token !== VALID_VERIFICATION_TOKEN) {
    return safeError({
      code: 'INVALID_VERIFICATION',
      message: 'This verification link is invalid or has expired.',
      status: 400
    })
  }

  return json({
    email: AUTHENTICATED_USER.email,
    redirectTo: '/?view=recent',
    status: 'created'
  }, 201)
}

async function handleSignIn(request: Request): Promise<Response> {
  const credentials = await readCredentials(request)

  if (
    credentials !== null
    && !consumeTurnstileToken(
      credentials.turnstileToken,
      TURNSTILE_ACTIONS.signIn
    )
  ) {
    return botVerificationError()
  }

  if (credentials?.email === 'unavailable@example.com') {
    return safeError({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Authentication is temporarily unavailable.',
      status: 503
    })
  }

  const isKnownEmail = credentials?.email === AUTHENTICATED_USER.email
    || credentials?.email === LONG_EMAIL_USER.email

  if (!isKnownEmail || credentials.password !== 'correct horse battery staple') {
    return safeError({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password.',
      status: 401
    })
  }

  const user = credentials.email === LONG_EMAIL_USER.email
    ? LONG_EMAIL_USER
    : AUTHENTICATED_USER

  const sessionCookie = credentials.email === LONG_EMAIL_USER.email
    ? LONG_EMAIL_SESSION_COOKIE
    : SESSION_COOKIE

  return json({ user }, 200, {
    'Set-Cookie': `${sessionCookie}; Path=/; HttpOnly; SameSite=Lax`
  })
}

function handleSession(request: Request): Response {
  if (hasCookie(request, 'fail_session=2')) {
    return safeError({
      code: 'SERVICE_UNAVAILABLE',

      headers: {
        'Set-Cookie': 'fail_session=1; Path=/; SameSite=Lax'
      },

      message: 'Authentication is temporarily unavailable.',
      status: 503
    })
  }

  if (hasCookie(request, 'fail_session=1')) {
    return safeError({
      code: 'SERVICE_UNAVAILABLE',

      headers: {
        'Set-Cookie': 'fail_session=; Max-Age=0; Path=/; SameSite=Lax'
      },

      message: 'Authentication is temporarily unavailable.',
      status: 503
    })
  }

  if (hasCookie(request, LONG_EMAIL_SESSION_COOKIE)) {
    return json({ user: LONG_EMAIL_USER })
  }

  const user = hasCookie(request, SESSION_COOKIE) ? AUTHENTICATED_USER : null

  return json({ user })
}

function handleSignOut(request: Request): Response {
  if (hasCookie(request, 'fail_sign_out=1')) {
    return safeError({
      code: 'SERVICE_UNAVAILABLE',

      headers: {
        'Set-Cookie': 'fail_sign_out=; Max-Age=0; Path=/; SameSite=Lax'
      },

      message: 'Authentication is temporarily unavailable.',
      status: 503
    })
  }

  return new Response(null, {
    headers: {
      'Cache-Control': 'no-store',
      'Set-Cookie': 'tv_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax'
    },

    status: 204
  })
}

// oxlint-disable-next-line import/no-default-export -- Cloudflare Workers require a default entrypoint.
export default {
  async fetch(request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/api/auth/register') {
      return handleRegister(request)
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/register/complete') {
      return handleRegistrationCompletion(request)
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/sign-in') {
      return handleSignIn(request)
    }

    if (request.method === 'GET' && url.pathname === '/api/auth/session') {
      return handleSession(request)
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/sign-out') {
      return handleSignOut(request)
    }

    return json({ error: 'Not found' }, 404)
  }
} satisfies ExportedHandler
