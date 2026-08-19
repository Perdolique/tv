import { describe, expect, it } from 'vitest'
import { AuthHttpError, createErrorEnvelope } from '../errors.ts'

describe(createErrorEnvelope, () => {
  it('exposes only the safe error contract', () => {
    const technicalError = new Error('database password authentication failed')

    const error = new AuthHttpError('SERVICE_UNAVAILABLE', 503, {
      cause: technicalError
    })

    expect(createErrorEnvelope(error)).toStrictEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable.'
      }
    })
  })

  it('includes field errors when validation owns them', () => {
    const error = new AuthHttpError('INVALID_REQUEST', 400, {
      fields: {
        email: 'Enter a valid email address.'
      }
    })

    expect(createErrorEnvelope(error)).toStrictEqual({
      error: {
        code: 'INVALID_REQUEST',

        fields: {
          email: 'Enter a valid email address.'
        },

        message: 'The request is invalid.'
      }
    })
  })
})
