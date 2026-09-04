import { findRootCause, serializeError } from '@tv/shared/errors'
import { TURNSTILE_ACTIONS } from '@tv/shared/turnstile'
import { describe, expect, it, vi } from 'vitest'
import { AuthHttpError } from '../errors.ts'
import { SITEVERIFY_URL, TURNSTILE_TOKEN_MAX_LENGTH, verifyTurnstileToken } from '../turnstile.ts'

const SECRET = 'test-secret-value'
const TOKEN = 'test-token-value'
const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA'

function createSiteverifyResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

function createValidResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: TURNSTILE_ACTIONS.signIn,
    hostname: 'tv.perd.dev',
    success: true,
    ...overrides
  }
}

async function getAuthError(operation: () => Promise<void>): Promise<AuthHttpError> {
  try {
    await operation()
  } catch (error) {
    if (error instanceof AuthHttpError) {
      return error
    }

    throw error
  }

  throw new Error('Expected an AuthHttpError')
}

async function verifyWith(
  fetchImplementation: typeof fetch,
  overrides: Partial<Parameters<typeof verifyTurnstileToken>[0]> = {}
): Promise<void> {
  await verifyTurnstileToken({
    expectedAction: TURNSTILE_ACTIONS.signIn,
    expectedHostname: 'tv.perd.dev',
    fetchImplementation,
    remoteIp: '203.0.113.4',
    secret: SECRET,
    token: TOKEN,
    ...overrides
  })
}

function readUrlEncodedRequestBody(fetchImplementation: ReturnType<typeof vi.fn<typeof fetch>>): URLSearchParams {
  const body = fetchImplementation.mock.calls[0]?.[1]?.body

  if (!(body instanceof URLSearchParams)) {
    throw new Error('Expected a URL-encoded Siteverify request body')
  }

  return body
}

async function createNonSuccessResponse(): Promise<Response> {
  await Promise.resolve()

  return new Response('', { status: 503 })
}

async function createInvalidJsonResponse(): Promise<Response> {
  await Promise.resolve()

  return new Response('not-json')
}

async function createMalformedResponse(): Promise<Response> {
  await Promise.resolve()

  return createSiteverifyResponse({ success: 'yes' })
}

async function throwTimeout(): Promise<Response> {
  await Promise.resolve()

  throw new DOMException('timed out', 'AbortError')
}

async function throwNetworkFailure(): Promise<Response> {
  await Promise.resolve()

  throw new Error('network unavailable')
}

describe(verifyTurnstileToken, () => {
  it('posts the canonical Siteverify request and accepts the expected action and hostname', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      createSiteverifyResponse(createValidResult())
    )

    await verifyWith(fetchImplementation)
    expect(fetchImplementation).toHaveBeenCalledTimes(1)

    const input = fetchImplementation.mock.calls[0]?.[0]
    const requestOptions = fetchImplementation.mock.calls[0]?.[1]

    expect(input).toBe(SITEVERIFY_URL)

    expect(requestOptions).toMatchObject({
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },

      method: 'POST'
    })

    expect(requestOptions?.signal).toBeInstanceOf(AbortSignal)

    const parameters = readUrlEncodedRequestBody(fetchImplementation)

    expect(parameters.toString()).toBe(
      'response=test-token-value&secret=test-secret-value&remoteip=203.0.113.4'
    )
  })

  it('omits the optional remote IP when Cloudflare did not provide it', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      createSiteverifyResponse(createValidResult())
    )

    await verifyWith(fetchImplementation, { remoteIp: undefined })

    const parameters = readUrlEncodedRequestBody(fetchImplementation)

    expect(parameters.toString()).not.toContain('remoteip=')
  })

  it.each([
    undefined,
    '',
    'x'.repeat(TURNSTILE_TOKEN_MAX_LENGTH + 1)
  ])('rejects an invalid token before calling Siteverify', async (token) => {
    const fetchImplementation = vi.fn<typeof fetch>()

    const error = await getAuthError(async () => {
      await verifyWith(fetchImplementation, { token })
    })

    expect(error).toMatchObject({
      code: 'BOT_VERIFICATION_FAILED',
      message: 'Complete the security check and try again.',
      status: 403
    })

    expect(fetchImplementation).not.toHaveBeenCalled()
  })

  it('accepts a token at the documented maximum length', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      createSiteverifyResponse(createValidResult())
    )

    await verifyWith(fetchImplementation, {
      token: 'x'.repeat(TURNSTILE_TOKEN_MAX_LENGTH)
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(1)
  })

  it('accepts Cloudflare test-key responses without production action and hostname fields', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      createSiteverifyResponse({
        hostname: 'example.com',
        metadata: { result_with_testing_key: true },
        success: true
      })
    )

    await verifyWith(fetchImplementation, {
      expectedHostname: '127.0.0.1',
      secret: TURNSTILE_TEST_SECRET,
      token: 'XXXX.DUMMY.TOKEN.XXXX'
    })

    const parameters = readUrlEncodedRequestBody(fetchImplementation)

    expect(parameters.get('secret')).toBe(TURNSTILE_TEST_SECRET)
    expect(parameters.get('response')).toBe('XXXX.DUMMY.TOKEN.XXXX')
  })

  it.each([
    [createValidResult({
      success: false,
      'error-codes': ['invalid-input-response']
    })],
    [{
      success: false,
      'error-codes': ['missing-input-response']
    }],
    [{
      success: false,
      'error-codes': ['timeout-or-duplicate']
    }],
    [{ success: true }],
    [createValidResult({ action: TURNSTILE_ACTIONS.register })],
    [createValidResult({ hostname: 'tv-staging.perd.dev' })]
  ])('rejects a failed or mismatched challenge', async (result) => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      createSiteverifyResponse(result)
    )

    const error = await getAuthError(async () => {
      await verifyWith(fetchImplementation)
    })

    expect(error).toMatchObject({
      code: 'BOT_VERIFICATION_FAILED',
      status: 403
    })
  })

  it.each([
    'bad-request',
    'internal-error',
    'invalid-input-secret',
    'missing-input-secret'
  ])('treats Siteverify configuration error %s as unavailable', async (errorCode) => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      createSiteverifyResponse({
        success: false,
        'error-codes': [errorCode]
      })
    )

    const error = await getAuthError(async () => {
      await verifyWith(fetchImplementation)
    })

    expect(error).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503
    })

    expect(String(error.cause)).toContain(errorCode)
  })

  it.each([
    ['a non-success response', createNonSuccessResponse],
    ['invalid JSON', createInvalidJsonResponse],
    ['a malformed response', createMalformedResponse],
    ['a timeout', throwTimeout],
    ['a network failure', throwNetworkFailure]
  ])('fails closed with 503 for %s', async (_scenario, implementation) => {
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(implementation)

    const error = await getAuthError(async () => {
      await verifyWith(fetchImplementation)
    })

    expect(error).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Authentication is temporarily unavailable.',
      status: 503
    })
  })

  it.each([
    undefined,
    ''
  ])('fails closed when the secret binding is missing without leaking the token or secret', async (secret) => {
    const fetchImplementation = vi.fn<typeof fetch>()

    const error = await getAuthError(async () => {
      await verifyWith(fetchImplementation, { secret })
    })

    const rootCause = findRootCause(error)
    const serializedError = JSON.stringify(serializeError(rootCause))

    expect(error.code).toBe('SERVICE_UNAVAILABLE')
    expect(serializedError).not.toContain(TOKEN)
    expect(serializedError).not.toContain(SECRET)
    expect(fetchImplementation).not.toHaveBeenCalled()
  })
})
