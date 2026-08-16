import { describe, expect, it } from 'vitest'
import { AuthHttpError } from '../errors.ts'
import { validateRegistrationCredentials, validateSignInCredentials } from '../validation.ts'

const INVALID_EMAIL_FIELD = {
  email: 'Enter a valid email address.'
}

const INVALID_PASSWORD_FIELD = {
  password: 'Enter a password.'
}

const INVALID_PASSWORD_LENGTH_FIELD = {
  password: 'Use between 15 and 128 characters.'
}

function getAuthError(operation: () => unknown): AuthHttpError {
  try {
    operation()
  } catch (error) {
    if (error instanceof AuthHttpError) {
      return error
    }

    throw error
  }

  throw new Error('Expected an AuthHttpError')
}

function createEmail(length: number): string {
  const suffix = '@example.com'

  return `${'a'.repeat(length - suffix.length)}${suffix}`
}

describe('auth credential validation', () => {
  it('normalizes credentials and ignores unknown fields', () => {
    const credentials = validateSignInCredentials({
      email: '  Person@Example.COM ',
      extra: true,
      password: 'wrong'
    })

    expect(credentials).toStrictEqual({
      email: 'person@example.com',
      password: 'wrong'
    })
  })

  it('normalizes registration and sign-in passwords to NFC', () => {
    const decomposedPassword = `Cafe\u0301${'x'.repeat(11)}`

    const registrationCredentials = validateRegistrationCredentials({
      email: 'person@example.com',
      password: decomposedPassword
    })

    const signInCredentials = validateSignInCredentials({
      email: 'person@example.com',
      password: decomposedPassword
    })

    const normalizedPassword = `Café${'x'.repeat(11)}`

    expect(registrationCredentials.password).toBe(normalizedPassword)
    expect(signInCredentials.password).toBe(normalizedPassword)
  })

  it('uses common email validation stricter than the previous loose shape', () => {
    const error = getAuthError(() => validateRegistrationCredentials({
      email: 'person@example.c',
      password: 'a'.repeat(15)
    }))

    expect(error).toMatchObject({
      code: 'INVALID_REQUEST',
      fields: INVALID_EMAIL_FIELD,
      status: 400
    })
  })

  it('accepts a 254-character email address', () => {
    const email = createEmail(254)

    const credentials = validateSignInCredentials({
      email,
      password: 'wrong'
    })

    expect(credentials.email).toBe(email)
  })

  it('rejects an email address longer than 254 characters', () => {
    const error = getAuthError(() => validateSignInCredentials({
      email: createEmail(255),
      password: 'wrong'
    }))

    expect(error.fields).toStrictEqual(INVALID_EMAIL_FIELD)
  })

  it.each([
    null,
    []
  ])('returns a root error for a non-object credential input', (input) => {
    const error = getAuthError(() => validateRegistrationCredentials(input))

    expect(error).toMatchObject({
      code: 'INVALID_REQUEST',
      fields: undefined,
      message: 'The request is invalid.',
      status: 400
    })
  })

  it('returns an email field error for a non-string email', () => {
    const error = getAuthError(() => validateSignInCredentials({
      email: null,
      password: 'wrong'
    }))

    expect(error.fields).toStrictEqual(INVALID_EMAIL_FIELD)
  })

  it('returns a password field error for a non-string password', () => {
    const error = getAuthError(() => validateSignInCredentials({
      email: 'person@example.com',
      password: null
    }))

    expect(error.fields).toStrictEqual(INVALID_PASSWORD_FIELD)
  })

  it('returns only the first field error when both fields are invalid', () => {
    const error = getAuthError(() => validateRegistrationCredentials({
      email: 'not-an-email',
      password: 'short'
    }))

    expect(error.fields).toStrictEqual(INVALID_EMAIL_FIELD)
  })

  it.each([
    15,
    128
  ])('accepts a registration password containing %i Unicode code points', (length) => {
    const password = '😀'.repeat(length)

    const credentials = validateRegistrationCredentials({
      email: 'person@example.com',
      password
    })

    // oxlint-disable-next-line unicorn/prefer-spread -- Array.from verifies the production code-point length contract.
    expect(Array.from(credentials.password)).toHaveLength(length)
  })

  it.each([
    14,
    129
  ])('rejects a registration password containing %i Unicode code points', (length) => {
    const error = getAuthError(() => validateRegistrationCredentials({
      email: 'person@example.com',
      password: '😀'.repeat(length)
    }))

    expect(error.fields).toStrictEqual(INVALID_PASSWORD_LENGTH_FIELD)
  })

  it('keeps a short sign-in password on the credential path', () => {
    const credentials = validateSignInCredentials({
      email: 'person@example.com',
      password: 'wrong'
    })

    expect(credentials.password).toBe('wrong')
  })
})
