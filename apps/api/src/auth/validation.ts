import { isRecord } from '@tv/shared/type-guards'
import { sanitizeRedirectTo } from '@tv/shared/redirect'
import * as v from 'valibot'
import { AuthHttpError } from './errors.ts'
import type { Credentials, RegistrationCompletionEnvelope, RegistrationRequest } from './types.ts'
import { isVerificationToken } from './verification.ts'

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

function createCredentialsSchema(password: v.GenericSchema<string, string>) {
  return v.pipe(
    v.unknown(),
    v.guard(isRecord),
    v.object({
      email: emailSchema,
      password
    })
  )
}

const signInCredentialsSchema = createCredentialsSchema(passwordSchema)

const registrationRequestSchema = v.pipe(
  v.unknown(),
  v.guard(isRecord),
  v.object({
    email: emailSchema,
    redirectTo: v.string()
  }),
  v.transform(({ email, redirectTo }) => {
    return {
      email,
      redirectTo: sanitizeRedirectTo(redirectTo)
    }
  })
)

function parseAuthValue<Output>(
  schema: v.GenericSchema<unknown, Output>,
  value: unknown
): Output {
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

function validateRegistrationRequest(value: unknown): RegistrationRequest {
  return parseAuthValue(registrationRequestSchema, value)
}

function validateRegistrationCompletionEnvelope(
  value: unknown
): RegistrationCompletionEnvelope {
  if (!isRecord(value) || !isVerificationToken(value.token)) {
    throw new AuthHttpError('INVALID_VERIFICATION', 400)
  }

  return {
    password: value.password,
    token: value.token
  }
}

function validateRegistrationPassword(value: unknown): string {
  const result = v.safeParse(registrationPasswordSchema, value, { abortEarly: true })

  if (result.success) {
    return result.output
  }

  const [issue] = result.issues

  throw new AuthHttpError('INVALID_REQUEST', 400, {
    fields: {
      password: issue.message
    }
  })
}

function validateSignInCredentials(value: unknown): Credentials {
  return parseAuthValue(signInCredentialsSchema, value)
}

export {
  validateRegistrationCompletionEnvelope,
  validateRegistrationPassword,
  validateRegistrationRequest,
  validateSignInCredentials
}
