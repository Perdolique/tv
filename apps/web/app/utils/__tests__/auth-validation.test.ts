import { describe, expect, it } from 'vitest'
import { validateCredentials } from '../auth-validation.ts'

function createEmail(length: number): string {
  const suffix = '@example.com'

  return `${'a'.repeat(length - suffix.length)}${suffix}`
}

describe(validateCredentials, () => {
  it('trims the email without changing its case and preserves the password', () => {
    const result = validateCredentials(
      '  Viewer@Example.COM  ',
      'correct horse battery staple'
    )

    expect(result).toStrictEqual({
      fields: {},

      payload: {
        email: 'Viewer@Example.COM',
        password: 'correct horse battery staple'
      }
    })
  })

  it('returns both required field errors', () => {
    expect(validateCredentials('   ', '')).toStrictEqual({
      fields: {
        email: 'Enter your email address.',
        password: 'Enter your password.'
      },

      payload: null
    })
  })

  it.each([
    'person@example.c',
    'a..b@example.com'
  ])('rejects invalid common email %s', (email) => {
    expect(validateCredentials(email, 'password')).toStrictEqual({
      fields: {
        email: 'Enter a valid email address.'
      },

      payload: null
    })
  })

  it('accepts a 254-character email address', () => {
    const email = createEmail(254)

    expect(validateCredentials(email, 'password')).toStrictEqual({
      fields: {},

      payload: {
        email,
        password: 'password'
      }
    })
  })

  it('rejects an email address longer than 254 characters', () => {
    expect(validateCredentials(createEmail(255), 'password')).toStrictEqual({
      fields: {
        email: 'Enter a valid email address.'
      },

      payload: null
    })
  })

  it('accepts any non-empty password', () => {
    expect(validateCredentials('viewer@example.com', 'x')).toStrictEqual({
      fields: {},

      payload: {
        email: 'viewer@example.com',
        password: 'x'
      }
    })
  })
})
