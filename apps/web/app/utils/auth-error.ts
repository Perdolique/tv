import { isRecord } from '@tv/shared/type-guards'
import * as v from 'valibot'
import type { AuthErrorCode, AuthFieldErrors, ParsedAuthError } from '~/types/auth.ts'

const AUTH_ERROR_MESSAGES = {
  INTERNAL_ERROR: 'An unexpected error occurred.',
  INVALID_CREDENTIALS: 'Invalid email or password.',
  INVALID_REQUEST: 'The request is invalid.',
  INVALID_VERIFICATION: 'This verification link is invalid or has expired.',
  PASSWORD_COMPROMISED: 'Choose a password that has not appeared in a known data breach.',
  RATE_LIMITED: 'Too many attempts. Try again later.',
  SERVICE_UNAVAILABLE: 'Authentication is temporarily unavailable.'
} as const

const FALLBACK_ERROR_MESSAGE = 'Something went wrong. Try again.'

const authErrorCodeSchema = v.custom<AuthErrorCode>(
  value => typeof value === 'string' && Object.hasOwn(AUTH_ERROR_MESSAGES, value)
)

const authErrorResponseSchema = v.object({
  error: v.pipe(
    v.object({
      code: authErrorCodeSchema,
      fields: v.optional(v.unknown()),
      message: v.string()
    }),
    v.check(({ code, message }) => message === AUTH_ERROR_MESSAGES[code])
  )
})

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

function parseAuthError(value: unknown): ParsedAuthError {
  const result = v.safeParse(authErrorResponseSchema, value, { abortEarly: true })

  if (!result.success) {
    return {
      fields: {},
      message: FALLBACK_ERROR_MESSAGE
    }
  }

  const { code, fields } = result.output.error

  return {
    code,
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
