import type { AuthFieldErrors, ParsedAuthError } from '~/types/auth.ts'

const AUTH_ERROR_MESSAGES = {
  INTERNAL_ERROR: 'An unexpected error occurred.',
  INVALID_CREDENTIALS: 'Invalid email or password.',
  INVALID_REQUEST: 'The request is invalid.',
  PASSWORD_COMPROMISED: 'Choose a password that has not appeared in a known data breach.',
  RATE_LIMITED: 'Too many attempts. Try again later.',
  SERVICE_UNAVAILABLE: 'Authentication is temporarily unavailable.'
} as const

const FALLBACK_ERROR_MESSAGE = 'Something went wrong. Try again.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseFieldErrors(value: unknown): AuthFieldErrors {
  if (!isRecord(value)) {
    return {}
  }

  const fields: AuthFieldErrors = {}

  if (typeof value.email === 'string') {
    fields.email = value.email
  }

  if (typeof value.password === 'string') {
    fields.password = value.password
  }

  return fields
}

function isAuthErrorCode(value: unknown): value is keyof typeof AUTH_ERROR_MESSAGES {
  return typeof value === 'string' && Object.hasOwn(AUTH_ERROR_MESSAGES, value)
}

function parseAuthError(value: unknown): ParsedAuthError {
  if (!isRecord(value) || !isRecord(value.error)) {
    return {
      fields: {},
      message: FALLBACK_ERROR_MESSAGE
    }
  }

  const { code, fields, message } = value.error

  if (
    !isAuthErrorCode(code)
    || typeof message !== 'string'
    || message !== AUTH_ERROR_MESSAGES[code]
  ) {
    return {
      fields: {},
      message: FALLBACK_ERROR_MESSAGE
    }
  }

  return {
    fields: parseFieldErrors(fields),
    message: AUTH_ERROR_MESSAGES[code]
  }
}

function getFetchErrorData(error: unknown): unknown {
  if (!isRecord(error)) {
    return
  }

  return error.data
}

export {
  FALLBACK_ERROR_MESSAGE,
  getFetchErrorData,
  parseAuthError
}
