import * as v from 'valibot'
import { AuthHttpError } from './errors.ts'
import type { Credentials } from './types.ts'

const EMAIL_MAX_LENGTH = 254
const PASSWORD_MIN_LENGTH = 15
const PASSWORD_MAX_LENGTH = 128
const INVALID_EMAIL_MESSAGE = 'Enter a valid email address.'
const INVALID_PASSWORD_MESSAGE = 'Enter a password.'
const INVALID_PASSWORD_LENGTH_MESSAGE = `Use between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`

const emailSchema = v.pipe(
  v.string(INVALID_EMAIL_MESSAGE),
  v.trim(),
  v.toLowerCase(),
  v.email(INVALID_EMAIL_MESSAGE),
  v.maxLength(EMAIL_MAX_LENGTH, INVALID_EMAIL_MESSAGE)
)

const passwordSchema = v.pipe(
  v.string(INVALID_PASSWORD_MESSAGE),
  v.normalize('NFC')
)

const registrationPasswordSchema = v.pipe(
  passwordSchema,
  v.check((password) => {
    // oxlint-disable-next-line unicorn/prefer-spread -- Array.from explicitly counts Unicode code points.
    const passwordLength = Array.from(password).length

    return passwordLength >= PASSWORD_MIN_LENGTH
      && passwordLength <= PASSWORD_MAX_LENGTH
  }, INVALID_PASSWORD_LENGTH_MESSAGE)
)

function isCredentialsObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function createCredentialsSchema(password: v.GenericSchema<string, string>) {
  return v.pipe(
    v.unknown(),
    v.guard(isCredentialsObject),
    v.object({
      email: emailSchema,
      password
    })
  )
}

const registrationCredentialsSchema = createCredentialsSchema(registrationPasswordSchema)
const signInCredentialsSchema = createCredentialsSchema(passwordSchema)

function parseCredentials(
  schema: v.GenericSchema<unknown, Credentials>,
  value: unknown
): Credentials {
  const result = v.safeParse(schema, value, { abortEarly: true })

  if (result.success) {
    return result.output
  }

  const [issue] = result.issues
  const field = v.getDotPath(issue)

  if (field === null) {
    throw new AuthHttpError('INVALID_REQUEST', 400)
  }

  throw new AuthHttpError('INVALID_REQUEST', 400, {
    fields: {
      [field]: issue.message
    }
  })
}

function validateRegistrationCredentials(value: unknown): Credentials {
  return parseCredentials(registrationCredentialsSchema, value)
}

function validateSignInCredentials(value: unknown): Credentials {
  return parseCredentials(signInCredentialsSchema, value)
}

export {
  validateRegistrationCredentials,
  validateSignInCredentials
}
