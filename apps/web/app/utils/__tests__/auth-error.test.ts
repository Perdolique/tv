import { describe, expect, it } from 'vitest'
import { FALLBACK_ERROR_MESSAGE, parseAuthError } from '../auth-error.ts'

describe(parseAuthError, () => {
  it('accepts a known safe error and supported field errors', () => {
    const result = parseAuthError({
      error: {
        code: 'INVALID_REQUEST',

        fields: {
          email: 'Enter a valid email address.',
          password: 'Enter a password.',
          token: 'Technical token detail'
        },

        message: 'The request is invalid.'
      }
    })

    expect(result).toStrictEqual({
      code: 'INVALID_REQUEST',

      fields: {
        email: 'Enter a valid email address.',
        password: 'Enter a password.'
      },

      message: 'The request is invalid.'
    })
  })

  it('keeps supported string field errors independently', () => {
    const result = parseAuthError({
      error: {
        code: 'INVALID_REQUEST',

        fields: {
          email: 42,
          password: 'Enter a password.',
          token: 'Technical token detail'
        },

        message: 'The request is invalid.'
      }
    })

    expect(result).toStrictEqual({
      code: 'INVALID_REQUEST',

      fields: {
        password: 'Enter a password.'
      },

      message: 'The request is invalid.'
    })
  })

  it.each([
    null,
    { error: 'broken' },
    { error: {
      code: 'DATABASE_ERROR',
      message: 'password leaked'
    } },
    { error: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'connection refused'
    } }
  ])('replaces malformed or unsafe response %j with a generic error', (value) => {
    expect(parseAuthError(value)).toStrictEqual({
      fields: {},
      message: FALLBACK_ERROR_MESSAGE
    })
  })
})
