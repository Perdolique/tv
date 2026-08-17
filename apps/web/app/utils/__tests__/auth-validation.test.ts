import { describe, expect, it } from 'vitest'
import { validateCredentials } from '../auth-validation.ts'

describe(validateCredentials, () => {
  it('builds a payload with only the normalized email and password', () => {
    const result = validateCredentials(
      '  viewer@example.com  ',
      'correct horse battery staple'
    )

    expect(result).toStrictEqual({
      fields: {},
      payload: {
        email: 'viewer@example.com',
        password: 'correct horse battery staple'
      }
    })
  })
})
