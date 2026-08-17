import { describe, expect, it } from 'vitest'
import { validateRegistration } from '../auth-validation.ts'

describe(validateRegistration, () => {
  it('rejects mismatched password confirmation without a request payload', () => {
    const result = validateRegistration({
      email: 'viewer@example.com',
      password: 'correct horse battery staple',
      passwordConfirmation: 'different password'
    })

    expect(result).toStrictEqual({
      fields: {
        passwordConfirmation: 'Passwords do not match.'
      },
      payload: null
    })
  })

  it('builds a payload with only the normalized email and password', () => {
    const result = validateRegistration({
      email: '  viewer@example.com  ',
      password: 'correct horse battery staple',
      passwordConfirmation: 'correct horse battery staple'
    })

    expect(result).toStrictEqual({
      fields: {},
      payload: {
        email: 'viewer@example.com',
        password: 'correct horse battery staple'
      }
    })
  })
})
