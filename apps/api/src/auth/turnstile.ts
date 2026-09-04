import { isRecord } from '@tv/shared/type-guards'
import { TURNSTILE_RESPONSE_FIELD, type TurnstileAction } from '@tv/shared/turnstile'
import { AuthHttpError } from './errors.ts'

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const TURNSTILE_TOKEN_MAX_LENGTH = 2048
const SITEVERIFY_TIMEOUT_MILLISECONDS = 10_000
const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA'

const CONFIGURATION_ERROR_CODES = new Set([
  'bad-request',
  'internal-error',
  'invalid-input-secret',
  'missing-input-secret'
])

interface SiteverifyResponse {
  action: string | undefined;
  errorCodes: string[] | undefined;
  hostname: string | undefined;
  success: boolean;
}

interface VerifyTurnstileOptions {
  expectedAction: TurnstileAction;
  expectedHostname: string;
  fetchImplementation?: typeof fetch;
  remoteIp?: string | undefined;
  secret: string | undefined;
  token: unknown;
}

class TurnstileSiteverifyError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options)

    this.name = 'TurnstileSiteverifyError'
  }
}

function createBotVerificationError(): AuthHttpError {
  return new AuthHttpError('BOT_VERIFICATION_FAILED', 403)
}

function createServiceUnavailableError(cause: unknown): AuthHttpError {
  return new AuthHttpError('SERVICE_UNAVAILABLE', 503, { cause })
}

function readTurnstileToken(value: unknown): unknown {
  if (!isRecord(value)) {
    return
  }

  return value[TURNSTILE_RESPONSE_FIELD]
}

function parseSiteverifyResponse(value: unknown): SiteverifyResponse | null {
  if (!isRecord(value) || typeof value.success !== 'boolean') {
    return null
  }

  const errorCodes = value['error-codes']

  if (
    errorCodes !== undefined
    && (!Array.isArray(errorCodes) || !errorCodes.every(code => typeof code === 'string'))
  ) {
    return null
  }

  if (value.action !== undefined && typeof value.action !== 'string') {
    return null
  }

  if (value.hostname !== undefined && typeof value.hostname !== 'string') {
    return null
  }

  return {
    action: value.action,
    errorCodes,
    hostname: value.hostname,
    success: value.success
  }
}

function findConfigurationError(errorCodes: string[] | undefined): string | undefined {
  return errorCodes?.find(code => CONFIGURATION_ERROR_CODES.has(code))
}

async function verifyTurnstileToken(options: VerifyTurnstileOptions): Promise<void> {
  if (
    typeof options.token !== 'string'
    || options.token.length === 0
    || options.token.length > TURNSTILE_TOKEN_MAX_LENGTH
  ) {
    throw createBotVerificationError()
  }

  if (options.secret === undefined || options.secret.length === 0) {
    const cause = new TurnstileSiteverifyError('Turnstile secret is unavailable.')

    throw createServiceUnavailableError(cause)
  }

  const parameters = new URLSearchParams({
    response: options.token,
    secret: options.secret
  })

  if (options.remoteIp !== undefined && options.remoteIp !== '') {
    parameters.set('remoteip', options.remoteIp)
  }

  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch

  // oxlint-disable-next-line eslint/init-declarations -- Network failures are translated below.
  let response: Response

  try {
    response = await fetchImplementation(SITEVERIFY_URL, {
      body: parameters,

      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },

      method: 'POST',
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MILLISECONDS)
    })
  } catch (error) {
    const cause = new TurnstileSiteverifyError(
      'Turnstile Siteverify request failed.',
      { cause: error }
    )

    throw createServiceUnavailableError(cause)
  }

  if (!response.ok) {
    const cause = new TurnstileSiteverifyError(
      `Turnstile Siteverify returned HTTP ${response.status}.`
    )

    throw createServiceUnavailableError(cause)
  }

  // oxlint-disable-next-line eslint/init-declarations -- Invalid JSON is translated below.
  let rawResponse: unknown

  try {
    rawResponse = await response.json()
  } catch (error) {
    const cause = new TurnstileSiteverifyError(
      'Turnstile Siteverify returned invalid JSON.',
      { cause: error }
    )

    throw createServiceUnavailableError(cause)
  }

  const result = parseSiteverifyResponse(rawResponse)

  if (result === null) {
    const cause = new TurnstileSiteverifyError(
      'Turnstile Siteverify returned an invalid response.'
    )

    throw createServiceUnavailableError(cause)
  }

  const configurationError = findConfigurationError(result.errorCodes)

  if (configurationError !== undefined) {
    const cause = new TurnstileSiteverifyError(
      `Turnstile Siteverify reported ${configurationError}.`
    )

    throw createServiceUnavailableError(cause)
  }

  if (
    !result.success
    || (
      options.secret !== TURNSTILE_TEST_SECRET
      && (
        result.action !== options.expectedAction
        || result.hostname !== options.expectedHostname
      )
    )
  ) {
    throw createBotVerificationError()
  }
}

export {
  readTurnstileToken,
  SITEVERIFY_URL,
  TURNSTILE_TOKEN_MAX_LENGTH,
  verifyTurnstileToken
}
