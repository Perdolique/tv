import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AuthErrorCode, AuthErrorEnvelope } from './types.ts'

const ERROR_MESSAGES = {
  INTERNAL_ERROR: 'An unexpected error occurred.',
  INVALID_CREDENTIALS: 'Invalid email or password.',
  INVALID_REQUEST: 'The request is invalid.',
  INVALID_VERIFICATION: 'This verification link is invalid or has expired.',
  PASSWORD_COMPROMISED: 'Choose a password that has not appeared in a known data breach.',
  RATE_LIMITED: 'Too many attempts. Try again later.',
  SERVICE_UNAVAILABLE: 'Authentication is temporarily unavailable.'
} satisfies Record<AuthErrorCode, string>

interface AuthErrorOptions {
  cause?: unknown;
  fields?: Record<string, string>;
}

class AuthHttpError extends Error {
  readonly code: AuthErrorCode
  readonly fields: Record<string, string> | undefined
  readonly status: ContentfulStatusCode

  constructor(
    code: AuthErrorCode,
    status: ContentfulStatusCode,
    options: AuthErrorOptions = {}
  ) {
    super(ERROR_MESSAGES[code], { cause: options.cause })

    this.code = code
    this.fields = options.fields
    this.name = 'AuthHttpError'
    this.status = status
  }
}

function createErrorEnvelope(error: AuthHttpError): AuthErrorEnvelope {
  const body = {
    code: error.code,
    message: error.message
  }

  if (!error.fields) {
    return { error: body }
  }

  return {
    error: {
      ...body,
      fields: error.fields
    }
  }
}

export {
  AuthHttpError,
  createErrorEnvelope
}
