/* oxlint-disable eslint/max-lines -- The contract stays readable as one end-to-end auth specification. */
import { env, exports } from 'cloudflare:workers'
import { Client } from 'pg'
import { TURNSTILE_ACTIONS, TURNSTILE_RESPONSE_FIELD, type TurnstileAction } from '@tv/shared/turnstile'
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest'
import { VERIFICATION_TOKEN_DURATION_MILLISECONDS } from '../constants.ts'
import { hashSha1 } from '../hashing.ts'
import { hashVerificationToken } from '../verification.ts'
import { assertDisposableTestDatabase } from '../../testing/test-database.ts'

const PASSWORD = 'correct horse battery staple'
const SAFE_HIBP_SUFFIX = '0'.repeat(35)
const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/'
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA'

const externalFetchState = vi.hoisted(() => {
  return {
    defaultHibpResponse: undefined as (() => Promise<Response>) | undefined,
    queuedHibpResponses: [] as (() => Promise<Response>)[],
    usedTurnstileTokens: new Set<string>()
  }
})

interface AuthErrorResponse {
  error: {
    code: string;
    fields?: Record<string, string>;
    message: string;
  };
}

interface SessionResponse {
  user: {
    email: string;
    id: string;
  } | null;
}

interface ConsoleErrorMock {
  mock: {
    calls: readonly (readonly unknown[])[];
  };
}

function uniqueEmail(prefix: string): string {
  return `${prefix}.${crypto.randomUUID()}@example.com`
}

function createResponseFactory(
  body: BodyInit,
  init?: ResponseInit
): () => Promise<Response> {
  // oxlint-disable-next-line typescript/require-await -- The async call context owns the Workerd response body.
  return async () => new Response(body, init)
}

function mockSafeHibp(): void {
  externalFetchState.defaultHibpResponse = createResponseFactory(`${SAFE_HIBP_SUFFIX}:0`)
}

function queueHibpResponse(body: BodyInit, init?: ResponseInit): void {
  externalFetchState.queuedHibpResponses.push(createResponseFactory(body, init))
}

function readRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input
  }

  if (input instanceof URL) {
    return input.href
  }

  return input.url
}

function countFetchCalls(urlPrefix: string): number {
  return vi.mocked(globalThis.fetch).mock.calls.filter(([input]) => (
    readRequestUrl(input).startsWith(urlPrefix)
  )).length
}

function getSiteverifyParameters(
  options: RequestInit | undefined
): URLSearchParams | null {
  const body = options?.body

  if (!(body instanceof URLSearchParams)) {
    return null
  }

  return body
}

function getTurnstileAction(token: string): TurnstileAction {
  return token.startsWith(`${TURNSTILE_ACTIONS.register}-`)
    ? TURNSTILE_ACTIONS.register
    : TURNSTILE_ACTIONS.signIn
}

async function handleExternalFetch(
  input: RequestInfo | URL,
  options?: RequestInit
): Promise<Response> {
  const requestUrl = readRequestUrl(input)

  if (requestUrl === SITEVERIFY_URL) {
    const parameters = getSiteverifyParameters(options)
    const token = parameters?.get('response') ?? null

    if (parameters?.get('secret') !== TURNSTILE_TEST_SECRET) {
      return Response.json({
        success: false,
        'error-codes': ['invalid-input-secret']
      })
    }

    if (token === null) {
      return Response.json({
        success: false,
        'error-codes': ['missing-input-response']
      })
    }

    if (token === 'invalid-turnstile') {
      return Response.json({
        success: false,
        'error-codes': ['invalid-input-response']
      })
    }

    if (
      token === 'expired-turnstile'
      || externalFetchState.usedTurnstileTokens.has(token)
    ) {
      return Response.json({
        success: false,
        'error-codes': ['timeout-or-duplicate']
      })
    }

    externalFetchState.usedTurnstileTokens.add(token)

    return Response.json({
      action: getTurnstileAction(token),
      hostname: 'tv-api.test',
      success: true
    })
  }

  if (requestUrl.startsWith(HIBP_RANGE_URL)) {
    const queuedResponse = externalFetchState.queuedHibpResponses.shift()
    const responseFactory = queuedResponse ?? externalFetchState.defaultHibpResponse

    if (responseFactory !== undefined) {
      return responseFactory()
    }

    throw new Error('Unexpected HIBP request')
  }

  throw new Error(`Unexpected external request to ${requestUrl}`)
}

function createTurnstileToken(action: TurnstileAction): string {
  return `${action}-${crypto.randomUUID()}`
}

async function authRequest(
  path: string,
  options: {
    body?: unknown;
    cookie?: string;
    method?: 'GET' | 'POST';
  } = {}
): Promise<Response> {
  const headers = new Headers()

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  if (options.cookie !== undefined && options.cookie !== '') {
    headers.set('Cookie', options.cookie)
  }

  const requestOptions: RequestInit = {
    headers,
    method: options.method ?? 'GET'
  }

  if (options.body !== undefined) {
    requestOptions.body = JSON.stringify(options.body)
  }

  return exports.default.fetch(new Request(
    `https://tv-api.test${path}`,
    requestOptions
  ))
}

async function verificationRequest(
  email: string,
  redirectTo = '/',
  turnstileToken = createTurnstileToken(TURNSTILE_ACTIONS.register)
): Promise<Response> {
  return authRequest('/api/auth/register', {
    body: {
      [TURNSTILE_RESPONSE_FIELD]: turnstileToken,
      email,
      redirectTo
    },

    method: 'POST'
  })
}

async function completionRequest(token: string, password = PASSWORD): Promise<Response> {
  return authRequest('/api/auth/register/complete', {
    body: {
      password,
      token
    },

    method: 'POST'
  })
}

function getLatestEmailMessage(): EmailMessageBuilder {
  const latestCall = vi.mocked(env.EMAIL).send.mock.calls.at(-1)
  const [message] = latestCall ?? []

  if (message === undefined || !('subject' in message)) {
    throw new Error('Expected a structured registration email')
  }

  return message
}

function readVerificationToken(message: EmailMessageBuilder): string {
  const token = message.text?.match(/#token=(?<token>[\w-]{43})/u)?.groups?.token

  if (token === undefined) {
    throw new Error('Expected a verification token in the email')
  }

  return token
}

async function createAccount(email: string, password = PASSWORD): Promise<Response> {
  const response = await verificationRequest(email)

  if (response.status !== 202) {
    return response
  }

  const message = getLatestEmailMessage()

  if (message.subject !== 'Verify your email for TV') {
    return response
  }

  const token = readVerificationToken(message)
  const completionResponse = await completionRequest(token, password)

  return completionResponse
}

async function signInRequest(
  email: string,
  password = PASSWORD,
  options: {
    cookie?: string;
    turnstileToken?: string;
  } = {}
): Promise<Response> {
  const turnstileToken = options.turnstileToken
    ?? createTurnstileToken(TURNSTILE_ACTIONS.signIn)

  const requestOptions: Parameters<typeof authRequest>[1] = {
    body: {
      [TURNSTILE_RESPONSE_FIELD]: turnstileToken,
      email,
      password
    },

    method: 'POST'
  }

  if (options.cookie !== undefined && options.cookie !== '') {
    requestOptions.cookie = options.cookie
  }

  return authRequest('/api/auth/sign-in', requestOptions)
}

function readCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie')

  if (setCookie === null) {
    throw new Error('Expected a Set-Cookie response header')
  }

  return setCookie.split(';', 1)[0] ?? ''
}

function expectNoStore(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('no-store')
}

async function readJson<ResponseBody>(response: Response): Promise<ResponseBody> {
  return response.json()
}

async function expectBotVerificationFailed(response: Response): Promise<void> {
  expect(response.status).toBe(403)
  expect(response.headers.get('set-cookie')).toBeNull()
  expectNoStore(response)

  await expect(readJson<AuthErrorResponse>(response)).resolves.toStrictEqual({
    error: {
      code: 'BOT_VERIFICATION_FAILED',
      message: 'Complete the security check and try again.'
    }
  })
}

function readStructuredErrorLogs(consoleError: ConsoleErrorMock): unknown[] {
  return consoleError.mock.calls.map((parameters) => {
    expect(parameters).toHaveLength(1)

    const [serializedError] = parameters

    assert(typeof serializedError === 'string')

    return JSON.parse(serializedError) as unknown
  })
}

async function countUsers(email: string): Promise<number> {
  const client = new Client({ connectionString: env.DATABASE.connectionString })

  try {
    await client.connect()

    const result = await client.query<{ count: string }>(`
      SELECT count(*)
      FROM users
      WHERE email = $1
    `, [email])

    return Number(result.rows[0]?.count ?? 0)
  } finally {
    await client.end()
  }
}

async function countAccountState(email: string): Promise<{
  credentials: number;
  tokens: number;
  users: number;
}> {
  const client = new Client({ connectionString: env.DATABASE.connectionString })

  try {
    await client.connect()

    const result = await client.query<{
      credentials: string;
      tokens: string;
      users: string;
    }>(`
      SELECT
        (SELECT count(*) FROM users WHERE email = $1) AS users,
        (
          SELECT count(*)
          FROM password_credentials credentials
          INNER JOIN users ON users.id = credentials.user_id
          WHERE users.email = $1
        ) AS credentials,
        (SELECT count(*) FROM email_verification_tokens WHERE email = $1) AS tokens
    `, [email])

    const [row] = result.rows

    return {
      credentials: Number(row?.credentials ?? 0),
      tokens: Number(row?.tokens ?? 0),
      users: Number(row?.users ?? 0)
    }
  } finally {
    await client.end()
  }
}

describe('auth Worker contract', () => {
  beforeEach(async () => {
    externalFetchState.defaultHibpResponse = undefined
    externalFetchState.queuedHibpResponses = []

    externalFetchState.usedTurnstileTokens.clear()
    vi.spyOn(globalThis, 'fetch').mockImplementation(handleExternalFetch)

    const client = new Client({ connectionString: env.DATABASE.connectionString })

    try {
      await client.connect()
      await assertDisposableTestDatabase(client)
      await client.query('TRUNCATE TABLE email_verification_tokens, users CASCADE')
    } finally {
      await client.end()
    }

    vi.spyOn(env.EMAIL, 'send').mockResolvedValue({ messageId: crypto.randomUUID() })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps health independent from the database and auth cache policy', async () => {
    const response = await exports.default.fetch(
      new Request('https://tv-api.test/health')
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBeNull()

    await expect(response.json()).resolves.toStrictEqual({
      service: 'tv-api',
      status: 'ok'
    })
  })

  it('does not serve the removed auth path', async () => {
    const response = await exports.default.fetch(
      new Request('https://tv-api.test/auth/session')
    )

    expect(response.status).toBe(404)
  })

  it('returns the same registration response for new, pending, and occupied email', async () => {
    mockSafeHibp()
    vi.spyOn(env.REGISTRATION_EMAIL_RATE_LIMITER, 'limit').mockResolvedValue({ success: true })

    const pendingEmail = uniqueEmail('pending')
    const occupiedEmail = uniqueEmail('occupied')
    const newResponse = await verificationRequest(`  ${pendingEmail.toUpperCase()}  `)
    const pendingResponse = await verificationRequest(pendingEmail)

    await createAccount(occupiedEmail)

    const occupiedResponse = await verificationRequest(occupiedEmail)

    expect(countFetchCalls(HIBP_RANGE_URL)).toBe(1)

    const neutralResponses = [newResponse, pendingResponse, occupiedResponse]

    for (const response of neutralResponses) {
      expect(response.status).toBe(202)
      expect(response.headers.get('set-cookie')).toBeNull()
      expectNoStore(response)
    }

    await Promise.all(neutralResponses.map(async (response) => {
      await expect(readJson(response)).resolves.toStrictEqual({ status: 'accepted' })
    }))

    // oxlint-disable-next-line typescript/unbound-method -- Vitest inspects mock metadata without invoking the binding method.
    expect(vi.mocked(env.EMAIL).send).toHaveBeenCalledTimes(4)

    const existingAccountMessage = getLatestEmailMessage()

    expect(existingAccountMessage.subject).toBe('A registration request was made for TV')
    expect(existingAccountMessage.text).toContain('/sign-in?redirectTo=')
    expect(existingAccountMessage.text).not.toContain('/register#token=')

    await expect(countAccountState(pendingEmail)).resolves.toStrictEqual({
      credentials: 0,
      tokens: 2,
      users: 0
    })

    await expect(countAccountState(occupiedEmail)).resolves.toStrictEqual({
      credentials: 1,
      tokens: 0,
      users: 1
    })

    const pendingSignIn = await signInRequest(pendingEmail)

    expect(pendingSignIn.status).toBe(401)
  })

  it('stores verification tokens with the promised one-hour lifetime', async () => {
    const email = uniqueEmail('token-lifetime')
    const earliestExpiry = Date.now() + VERIFICATION_TOKEN_DURATION_MILLISECONDS

    await verificationRequest(email)

    const latestExpiry = Date.now() + VERIFICATION_TOKEN_DURATION_MILLISECONDS
    const token = readVerificationToken(getLatestEmailMessage())
    const tokenHash = await hashVerificationToken(token)
    const client = new Client({ connectionString: env.DATABASE.connectionString })

    try {
      await client.connect()

      const result = await client.query<{ expires_at: Date }>(`
        SELECT expires_at
        FROM email_verification_tokens
        WHERE token_hash = $1
      `, [tokenHash])

      const expiresAt = result.rows[0]?.expires_at

      assert(expiresAt !== undefined)
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(earliestExpiry)
      expect(expiresAt.getTime()).toBeLessThanOrEqual(latestExpiry)
    } finally {
      await client.end()
    }
  })

  it('creates no account before proof and no session after completion', async () => {
    mockSafeHibp()

    const email = uniqueEmail('proof')
    const registrationResponse = await verificationRequest(email, '/?view=recent')
    const token = readVerificationToken(getLatestEmailMessage())

    expect(registrationResponse.status).toBe(202)

    await expect(countAccountState(email)).resolves.toStrictEqual({
      credentials: 0,
      tokens: 1,
      users: 0
    })

    const completionResponse = await completionRequest(token)

    expect(completionResponse.status).toBe(201)

    await expect(readJson(completionResponse)).resolves.toStrictEqual({
      email,
      redirectTo: '/?view=recent',
      status: 'created'
    })

    expect(completionResponse.headers.get('set-cookie')).toBeNull()
    expectNoStore(completionResponse)

    await expect(countAccountState(email)).resolves.toStrictEqual({
      credentials: 1,
      tokens: 0,
      users: 1
    })

    const replayResponse = await completionRequest(token)

    expect(replayResponse.status).toBe(400)

    await expect(readJson<AuthErrorResponse>(replayResponse)).resolves.toStrictEqual({
      error: {
        code: 'INVALID_VERIFICATION',
        message: 'This verification link is invalid or has expired.'
      }
    })
  })

  it('removes only the failed resend token when email delivery fails', async () => {
    const email = uniqueEmail('email-failure')
    const consoleError = vi.spyOn(console, 'error').mockReturnValue()

    vi.spyOn(env.REGISTRATION_EMAIL_RATE_LIMITER, 'limit').mockResolvedValue({ success: true })
    await verificationRequest(email)

    const deliveredToken = readVerificationToken(getLatestEmailMessage())

    vi.mocked(env.EMAIL).send.mockRejectedValueOnce(new Error('email provider unavailable'))

    const response = await verificationRequest(email)
    const body = await readJson<AuthErrorResponse>(response)
    const logs = JSON.stringify(readStructuredErrorLogs(consoleError))

    expect(response.status).toBe(503)

    expect(body.error).toStrictEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Authentication is temporarily unavailable.'
    })

    await expect(countAccountState(email)).resolves.toStrictEqual({
      credentials: 0,
      tokens: 1,
      users: 0
    })

    expect(logs).toContain('email provider unavailable')
    expect(logs).not.toContain(email)
    expectNoStore(response)
    mockSafeHibp()

    const completionResponse = await completionRequest(deliveredToken)

    expect(completionResponse.status).toBe(201)

    await expect(countAccountState(email)).resolves.toStrictEqual({
      credentials: 1,
      tokens: 0,
      users: 1
    })
  })

  it('rejects password-length boundaries without consuming the token or checking HIBP', async () => {
    const email = uniqueEmail('password-length')

    await verificationRequest(email)

    const token = readVerificationToken(getLatestEmailMessage())

    const invalidPasswords = [
      'x'.repeat(14),
      'x'.repeat(129)
    ]

    /* oxlint-disable eslint/no-await-in-loop -- Both boundaries must reuse the same live token and own separate response bodies. */
    for (const password of invalidPasswords) {
      const response = await completionRequest(token, password)

      expect(response.status).toBe(400)

      await expect(readJson<AuthErrorResponse>(response)).resolves.toStrictEqual({
        error: {
          code: 'INVALID_REQUEST',

          fields: {
            password: 'Use between 15 and 128 characters.'
          },

          message: 'The request is invalid.'
        }
      })
    }

    /* oxlint-enable eslint/no-await-in-loop */

    expect(countFetchCalls(HIBP_RANGE_URL)).toBe(0)

    await expect(countAccountState(email)).resolves.toStrictEqual({
      credentials: 0,
      tokens: 1,
      users: 0
    })
  })

  it('rejects an expired verification link before checking HIBP', async () => {
    const email = uniqueEmail('expired-verification')

    await verificationRequest(email)

    const token = readVerificationToken(getLatestEmailMessage())
    const tokenHash = await hashVerificationToken(token)
    const client = new Client({ connectionString: env.DATABASE.connectionString })

    try {
      await client.connect()

      await client.query(`
        UPDATE email_verification_tokens
        SET expires_at = now() - interval '1 second'
        WHERE token_hash = $1
      `, [tokenHash])
    } finally {
      await client.end()
    }

    const response = await completionRequest(token)

    expect(response.status).toBe(400)
    expect(countFetchCalls(HIBP_RANGE_URL)).toBe(0)

    await expect(readJson<AuthErrorResponse>(response)).resolves.toStrictEqual({
      error: {
        code: 'INVALID_VERIFICATION',
        message: 'This verification link is invalid or has expired.'
      }
    })
  })

  it('rejects compromised passwords and fails closed when HIBP is unavailable', async () => {
    const compromisedEmail = uniqueEmail('compromised')
    const unavailableEmail = uniqueEmail('unavailable')
    const passwordHash = await hashSha1(PASSWORD)
    const passwordSuffix = passwordHash.slice(5)
    const consoleError = vi.spyOn(console, 'error').mockReturnValue()

    queueHibpResponse(`${passwordSuffix}:42`)

    const compromisedResponse = await createAccount(compromisedEmail)

    queueHibpResponse(`${SAFE_HIBP_SUFFIX}:0`, { status: 503 })

    const unavailableResponse = await createAccount(unavailableEmail)
    const unavailableBody = await readJson<AuthErrorResponse>(unavailableResponse)
    const loggedError = JSON.stringify(readStructuredErrorLogs(consoleError))

    expect(compromisedResponse.status).toBe(400)

    await expect(readJson<AuthErrorResponse>(compromisedResponse)).resolves.toStrictEqual({
      error: {
        code: 'PASSWORD_COMPROMISED',

        fields: {
          password: 'Choose a password that has not appeared in a known data breach.'
        },

        message: 'Choose a password that has not appeared in a known data breach.'
      }
    })

    expect(unavailableResponse.status).toBe(503)

    expect(unavailableBody.error).toStrictEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Authentication is temporarily unavailable.'
    })

    await expect(countUsers(compromisedEmail)).resolves.toBe(0)
    await expect(countUsers(unavailableEmail)).resolves.toBe(0)
    expect(loggedError).not.toContain(unavailableEmail)
    expect(loggedError).not.toContain(PASSWORD)
    expectNoStore(compromisedResponse)
    expectNoStore(unavailableResponse)
  })

  it('logs database failures without query parameters or credentials', async () => {
    mockSafeHibp()

    const email = uniqueEmail('database-failure')
    const consoleError = vi.spyOn(console, 'error').mockReturnValue()
    const client = new Client({ connectionString: env.DATABASE.connectionString })

    // oxlint-disable-next-line eslint/init-declarations -- The finally block must restore the schema before assertions run.
    let response: Response

    await client.connect()
    await assertDisposableTestDatabase(client)

    await client.query(`
      ALTER TABLE password_credentials
      ALTER COLUMN password_hash TYPE varchar(1)
    `)

    try {
      response = await createAccount(email)
    } finally {
      await client.query(`
        ALTER TABLE password_credentials
        ALTER COLUMN password_hash TYPE varchar(256)
      `)

      await client.end()
    }

    const loggedError = JSON.stringify(readStructuredErrorLogs(consoleError))

    expect(response.status).toBe(503)
    expect(loggedError).toContain('value too long')
    expect(loggedError).not.toContain(email)
    expect(loggedError).not.toContain(PASSWORD)
    expect(loggedError).not.toContain('$scrypt$')
    await expect(countUsers(email)).resolves.toBe(0)
  })

  it('returns identical invalid-credential errors for unknown email and wrong password', async () => {
    mockSafeHibp()

    const email = uniqueEmail('credential')
    const unknownEmail = uniqueEmail('unknown')

    await createAccount(email)

    const unknownResponse = await signInRequest(unknownEmail)
    const wrongPasswordResponse = await signInRequest(email, 'wrong')
    const unknownBody = await readJson<AuthErrorResponse>(unknownResponse)
    const wrongPasswordBody = await readJson<AuthErrorResponse>(wrongPasswordResponse)

    expect(unknownResponse.status).toBe(401)
    expect(wrongPasswordResponse.status).toBe(401)
    expect(unknownBody).toStrictEqual(wrongPasswordBody)

    expect(unknownBody).toStrictEqual({
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.'
      }
    })

    expectNoStore(unknownResponse)
    expectNoStore(wrongPasswordResponse)
  })

  it('completes register, sign-in, session restoration, and sign-out', async () => {
    mockSafeHibp()

    const email = uniqueEmail('lifecycle')

    await createAccount(email)

    const signInResponse = await signInRequest(email)
    const signInBody = await readJson<SessionResponse>(signInResponse)
    const cookie = readCookie(signInResponse)

    expect(signInResponse.status).toBe(200)
    expect(signInBody.user).toMatchObject({ email })
    expect(cookie).toMatch(/^__Host-tv_session=[A-Za-z0-9_-]{43}$/u)
    expect(signInResponse.headers.get('set-cookie')).toContain('Max-Age=2592000')
    expect(signInResponse.headers.get('set-cookie')).toContain('HttpOnly')
    expect(signInResponse.headers.get('set-cookie')).toContain('Secure')
    expect(signInResponse.headers.get('set-cookie')).toContain('SameSite=Lax')
    expect(signInResponse.headers.get('set-cookie')).toContain('Path=/')
    expect(signInResponse.headers.get('set-cookie')).not.toContain('Domain=')

    const sessionResponse = await authRequest('/api/auth/session', { cookie })

    expect(sessionResponse.status).toBe(200)
    await expect(readJson<SessionResponse>(sessionResponse)).resolves.toStrictEqual(signInBody)

    const signOutResponse = await authRequest('/api/auth/sign-out', {
      cookie,
      method: 'POST'
    })

    expect(signOutResponse.status).toBe(204)
    expect(signOutResponse.headers.get('set-cookie')).toContain('Max-Age=0')
    expectNoStore(signOutResponse)

    const signedOutSession = await authRequest('/api/auth/session', { cookie })

    await expect(readJson<SessionResponse>(signedOutSession)).resolves.toStrictEqual({
      user: null
    })
  })

  it('treats missing, malformed, and expired cookies as no session', async () => {
    mockSafeHibp()

    const missingResponse = await authRequest('/api/auth/session')

    const malformedResponse = await authRequest('/api/auth/session', {
      cookie: '__Host-tv_session=malformed'
    })

    const email = uniqueEmail('expired')

    await createAccount(email)

    const signInResponse = await signInRequest(email)
    const cookie = readCookie(signInResponse)
    const client = new Client({ connectionString: env.DATABASE.connectionString })

    try {
      await client.connect()

      await client.query(`
        UPDATE sessions
        SET expires_at = now() - interval '1 second'
      `)
    } finally {
      await client.end()
    }

    const expiredResponse = await authRequest('/api/auth/session', { cookie })

    await expect(readJson<SessionResponse>(missingResponse)).resolves.toStrictEqual({ user: null })
    await expect(readJson<SessionResponse>(malformedResponse)).resolves.toStrictEqual({ user: null })
    await expect(readJson<SessionResponse>(expiredResponse)).resolves.toStrictEqual({ user: null })
    expect(malformedResponse.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(expiredResponse.headers.get('set-cookie')).toContain('Max-Age=0')
    expectNoStore(missingResponse)
    expectNoStore(malformedResponse)
    expectNoStore(expiredResponse)
  })

  it('keeps device sessions independent when one signs out', async () => {
    mockSafeHibp()

    const email = uniqueEmail('devices')

    await createAccount(email)

    const firstSignIn = await signInRequest(email)
    const secondSignIn = await signInRequest(email)
    const firstCookie = readCookie(firstSignIn)
    const secondCookie = readCookie(secondSignIn)

    await authRequest('/api/auth/sign-out', {
      cookie: firstCookie,
      method: 'POST'
    })

    const firstSession = await authRequest('/api/auth/session', {
      cookie: firstCookie
    })

    const secondSession = await authRequest('/api/auth/session', {
      cookie: secondCookie
    })

    await expect(readJson<SessionResponse>(firstSession)).resolves.toStrictEqual({ user: null })

    const secondSessionBody = await readJson<SessionResponse>(secondSession)

    expect(secondSessionBody.user).toMatchObject({ email })
  })

  it('replaces only the current cookie session on a new sign-in', async () => {
    mockSafeHibp()

    const email = uniqueEmail('replace')

    await createAccount(email)

    const firstSignIn = await signInRequest(email)
    const otherDeviceSignIn = await signInRequest(email)
    const firstCookie = readCookie(firstSignIn)
    const otherDeviceCookie = readCookie(otherDeviceSignIn)

    const replacementSignIn = await signInRequest(email, PASSWORD, {
      cookie: firstCookie
    })

    const replacementCookie = readCookie(replacementSignIn)
    const oldSession = await authRequest('/api/auth/session', { cookie: firstCookie })

    const otherDeviceSession = await authRequest('/api/auth/session', {
      cookie: otherDeviceCookie
    })

    const replacementSession = await authRequest('/api/auth/session', {
      cookie: replacementCookie
    })

    await expect(readJson<SessionResponse>(oldSession)).resolves.toStrictEqual({ user: null })

    const otherDeviceBody = await readJson<SessionResponse>(otherDeviceSession)
    const replacementBody = await readJson<SessionResponse>(replacementSession)

    expect(otherDeviceBody.user).toMatchObject({ email })
    expect(replacementBody.user).toMatchObject({ email })
  })

  it('rejects registration bodies larger than 8 KiB with the safe error envelope', async () => {
    const response = await authRequest('/api/auth/register', {
      body: {
        email: uniqueEmail('oversize'),
        padding: 'x'.repeat(9e3),
        redirectTo: '/'
      },

      method: 'POST'
    })

    expect(response.status).toBe(413)

    await expect(readJson<AuthErrorResponse>(response)).resolves.toStrictEqual({
      error: {
        code: 'INVALID_REQUEST',
        message: 'The request is invalid.'
      }
    })

    expectNoStore(response)
  })

  it('rejects registration completion bodies larger than 8 KiB before downstream work', async () => {
    const rateLimit = vi.spyOn(env.REGISTRATION_ACTIVATION_RATE_LIMITER, 'limit')

    const response = await authRequest('/api/auth/register/complete', {
      body: {
        padding: 'x'.repeat(9e3),
        password: PASSWORD,
        token: 'a'.repeat(43)
      },

      method: 'POST'
    })

    expect(response.status).toBe(413)

    await expect(readJson<AuthErrorResponse>(response)).resolves.toStrictEqual({
      error: {
        code: 'INVALID_REQUEST',
        message: 'The request is invalid.'
      }
    })

    expect(countFetchCalls(HIBP_RANGE_URL)).toBe(0)
    expect(rateLimit).not.toHaveBeenCalled()
    expectNoStore(response)
  })

  it('rejects sign-in bodies larger than 8 KiB with the safe error envelope', async () => {
    const response = await signInRequest(
      uniqueEmail('oversize-sign-in'),
      'x'.repeat(9e3)
    )

    expect(response.status).toBe(413)

    await expect(readJson<AuthErrorResponse>(response)).resolves.toStrictEqual({
      error: {
        code: 'INVALID_REQUEST',
        message: 'The request is invalid.'
      }
    })

    expectNoStore(response)
  })

  it.each([
    ['missing', {}],
    ['invalid', { [TURNSTILE_RESPONSE_FIELD]: 'invalid-turnstile' }],
    ['expired', { [TURNSTILE_RESPONSE_FIELD]: 'expired-turnstile' }]
  ])('rejects a %s registration challenge before downstream work', async (_scenario, challenge) => {
    const email = uniqueEmail('turnstile-register')

    const body: Record<string, unknown> = {
      ...challenge,
      email,
      redirectTo: '/'
    }

    const rateLimit = vi.spyOn(env.REGISTRATION_EMAIL_RATE_LIMITER, 'limit')
    const databaseConnect = vi.spyOn(Client.prototype, 'connect')

    // oxlint-disable-next-line typescript/unbound-method -- Vitest inspects mock metadata without invoking the binding method.
    const emailSend = vi.mocked(env.EMAIL).send

    const response = await authRequest('/api/auth/register', {
      body,
      method: 'POST'
    })

    await expectBotVerificationFailed(response)
    expect(rateLimit).not.toHaveBeenCalled()
    expect(databaseConnect).not.toHaveBeenCalled()
    expect(emailSend).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', {}],
    ['invalid', { [TURNSTILE_RESPONSE_FIELD]: 'invalid-turnstile' }],
    ['expired', { [TURNSTILE_RESPONSE_FIELD]: 'expired-turnstile' }]
  ])('rejects a %s sign-in challenge before downstream work', async (_scenario, challenge) => {
    const body: Record<string, unknown> = {
      ...challenge,
      email: uniqueEmail('turnstile-sign-in'),
      password: PASSWORD
    }

    const rateLimit = vi.spyOn(env.SIGN_IN_RATE_LIMITER, 'limit')
    const databaseConnect = vi.spyOn(Client.prototype, 'connect')

    // oxlint-disable-next-line typescript/unbound-method -- Vitest inspects mock metadata without invoking the binding method.
    const emailSend = vi.mocked(env.EMAIL).send

    const response = await authRequest('/api/auth/sign-in', {
      body,
      method: 'POST'
    })

    await expectBotVerificationFailed(response)
    expect(rateLimit).not.toHaveBeenCalled()
    expect(databaseConnect).not.toHaveBeenCalled()
    expect(emailSend).not.toHaveBeenCalled()
  })

  it('rejects a replayed registration token before the next limiter, database, or email call', async () => {
    const email = uniqueEmail('turnstile-register-replay')
    const turnstileToken = createTurnstileToken(TURNSTILE_ACTIONS.register)
    const rateLimit = vi.spyOn(env.REGISTRATION_EMAIL_RATE_LIMITER, 'limit')
    const databaseConnect = vi.spyOn(Client.prototype, 'connect')

    // oxlint-disable-next-line typescript/unbound-method -- Vitest inspects mock metadata without invoking the binding method.
    const emailSend = vi.mocked(env.EMAIL).send
    const firstResponse = await verificationRequest(email, '/', turnstileToken)

    expect(firstResponse.status).toBe(202)
    rateLimit.mockClear()
    databaseConnect.mockClear()
    emailSend.mockClear()

    const replayResponse = await verificationRequest(email, '/', turnstileToken)

    await expectBotVerificationFailed(replayResponse)
    expect(rateLimit).not.toHaveBeenCalled()
    expect(databaseConnect).not.toHaveBeenCalled()
    expect(emailSend).not.toHaveBeenCalled()
  })

  it('rejects a replayed sign-in token before the next limiter, database, or session call', async () => {
    const email = uniqueEmail('turnstile-sign-in-replay')
    const turnstileToken = createTurnstileToken(TURNSTILE_ACTIONS.signIn)
    const rateLimit = vi.spyOn(env.SIGN_IN_RATE_LIMITER, 'limit')
    const databaseConnect = vi.spyOn(Client.prototype, 'connect')
    const firstResponse = await signInRequest(email, PASSWORD, { turnstileToken })

    expect(firstResponse.status).toBe(401)
    rateLimit.mockClear()
    databaseConnect.mockClear()

    const replayResponse = await signInRequest(email, PASSWORD, { turnstileToken })

    await expectBotVerificationFailed(replayResponse)
    expect(rateLimit).not.toHaveBeenCalled()
    expect(databaseConnect).not.toHaveBeenCalled()
  })

  it('rejects insecure deployed auth requests', async () => {
    const response = await exports.default.fetch(
      new Request('http://tv-api.test/api/auth/session')
    )

    expect(response.status).toBe(400)

    await expect(readJson<AuthErrorResponse>(response)).resolves.toStrictEqual({
      error: {
        code: 'INVALID_REQUEST',
        message: 'The request is invalid.'
      }
    })

    expect(response.headers.get('set-cookie')).toBeNull()
    expectNoStore(response)
  })

  it('requires the exact JSON media type', async () => {
    const response = await exports.default.fetch(new Request(
      'https://tv-api.test/api/auth/sign-in',
      {
        body: JSON.stringify({
          email: uniqueEmail('jsonp'),
          password: PASSWORD
        }),

        headers: {
          'Content-Type': 'application/jsonp'
        },

        method: 'POST'
      }
    ))

    expect(response.status).toBe(400)

    await expect(readJson<AuthErrorResponse>(response)).resolves.toStrictEqual({
      error: {
        code: 'INVALID_REQUEST',
        message: 'The request is invalid.'
      }
    })

    expectNoStore(response)
  })

  it('rejects non-empty and oversized sign-out bodies', async () => {
    const nonEmptyResponse = await exports.default.fetch(new Request(
      'https://tv-api.test/api/auth/sign-out',
      {
        body: '{}',

        headers: {
          'Content-Type': 'application/json'
        },

        method: 'POST'
      }
    ))

    const oversizedResponse = await exports.default.fetch(new Request(
      'https://tv-api.test/api/auth/sign-out',
      {
        body: JSON.stringify({ padding: 'x'.repeat(9e3) }),

        headers: {
          'Content-Type': 'application/json'
        },

        method: 'POST'
      }
    ))

    expect(nonEmptyResponse.status).toBe(400)
    expect(oversizedResponse.status).toBe(413)

    await expect(readJson<AuthErrorResponse>(nonEmptyResponse)).resolves.toStrictEqual({
      error: {
        code: 'INVALID_REQUEST',
        message: 'The request is invalid.'
      }
    })

    await expect(readJson<AuthErrorResponse>(oversizedResponse)).resolves.toStrictEqual({
      error: {
        code: 'INVALID_REQUEST',
        message: 'The request is invalid.'
      }
    })

    expectNoStore(nonEmptyResponse)
    expectNoStore(oversizedResponse)
  })

  it('handles exhausted registration and sign-in rate limits independently', async () => {
    const email = uniqueEmail('limited')
    const registrationRateLimit = vi.spyOn(env.REGISTRATION_EMAIL_RATE_LIMITER, 'limit')
    const signInRateLimit = vi.spyOn(env.SIGN_IN_RATE_LIMITER, 'limit')

    registrationRateLimit
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false })

    signInRateLimit
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false })

    const registrationResponses: Response[] = []
    const signInResponses: Response[] = []

    /* oxlint-disable eslint/no-await-in-loop -- Rate limits must be observed sequentially. */
    for (let attempt = 0; attempt < 2; attempt += 1) {
      registrationResponses.push(await verificationRequest(email))
    }

    for (let attempt = 0; attempt < 6; attempt += 1) {
      signInResponses.push(await signInRequest(email))
    }

    /* oxlint-enable eslint/no-await-in-loop */

    expect(registrationResponses[0]?.status).toBe(202)

    expect(signInResponses.slice(0, 5).map((response) => response.status)).toStrictEqual([
      401,
      401,
      401,
      401,
      401
    ])

    const registrationRateLimitKeys = registrationRateLimit.mock.calls.map(([options]) => options.key)
    const signInRateLimitKeys = signInRateLimit.mock.calls.map(([options]) => options.key)

    expect(registrationRateLimit).toHaveBeenCalledTimes(2)
    expect(signInRateLimit).toHaveBeenCalledTimes(6)
    expect(new Set(registrationRateLimitKeys).size).toBe(1)
    expect(new Set(signInRateLimitKeys).size).toBe(1)
    expect(registrationRateLimitKeys[0]).toMatch(/^[0-9a-f]{64}$/u)
    expect(signInRateLimitKeys[0]).toBe(registrationRateLimitKeys[0])

    const limitedRegistration = registrationResponses.at(1)
    const limitedSignIn = signInResponses.at(5)

    assert(limitedRegistration !== undefined)
    assert(limitedSignIn !== undefined)
    expect(limitedRegistration.status).toBe(429)
    expect(limitedSignIn.status).toBe(429)
    expect(limitedRegistration.headers.get('retry-after')).toBe('60')
    expect(limitedSignIn.headers.get('retry-after')).toBe('60')

    await expect(readJson<AuthErrorResponse>(limitedRegistration)).resolves.toStrictEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many attempts. Try again later.'
      }
    })

    await expect(readJson<AuthErrorResponse>(limitedSignIn)).resolves.toStrictEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many attempts. Try again later.'
      }
    })

    expectNoStore(limitedRegistration)
    expectNoStore(limitedSignIn)
  })

  it('preserves a live token when the activation rate limit is exhausted', async () => {
    const email = uniqueEmail('limited-activation')

    await verificationRequest(email)

    const token = readVerificationToken(getLatestEmailMessage())
    const rateLimit = vi.spyOn(env.REGISTRATION_ACTIVATION_RATE_LIMITER, 'limit')

    rateLimit.mockResolvedValueOnce({ success: false })

    const response = await completionRequest(token)
    const [rateLimitCall] = rateLimit.mock.calls

    assert(rateLimitCall !== undefined)

    const [rateLimitOptions] = rateLimitCall

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(rateLimitOptions.key).toMatch(/^[0-9a-f]{64}$/u)
    expect(countFetchCalls(HIBP_RANGE_URL)).toBe(0)

    await expect(countAccountState(email)).resolves.toStrictEqual({
      credentials: 0,
      tokens: 1,
      users: 0
    })

    expectNoStore(response)
  })
})
