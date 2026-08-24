import * as v from 'valibot'
import type { AuthFieldErrors } from '~/types/auth.ts'

const EMAIL_MAX_LENGTH = 254
const INVALID_EMAIL_MESSAGE = 'Enter a valid email address.'

const emailSchema = v.pipe(
  v.string(),
  v.trim(),
  v.nonEmpty('Enter your email address.'),
  v.email(INVALID_EMAIL_MESSAGE),
  v.maxLength(EMAIL_MAX_LENGTH, INVALID_EMAIL_MESSAGE)
)

const passwordSchema = v.pipe(
  v.string(),
  v.nonEmpty('Enter your password.')
)

const credentialsSchema = v.object({
  email: emailSchema,
  password: passwordSchema
})

const emailRequestSchema = v.object({
  email: emailSchema
})

const passwordRequestSchema = v.object({
  password: passwordSchema
})

type CredentialsPayload = v.InferOutput<typeof credentialsSchema>

interface ValidationResult {
  fields: AuthFieldErrors;
  payload: CredentialsPayload | null;
}

interface EmailValidationResult {
  fields: AuthFieldErrors;
  payload: v.InferOutput<typeof emailRequestSchema> | null;
}

interface PasswordValidationResult {
  fields: AuthFieldErrors;
  payload: v.InferOutput<typeof passwordRequestSchema> | null;
}

function validateCredentials(email: string, password: string): ValidationResult {
  const result = v.safeParse(credentialsSchema, {
    email,
    password
  }, {
    abortPipeEarly: true
  })

  if (result.success) {
    return {
      fields: {},
      payload: result.output
    }
  }

  const errors = v.flatten<typeof credentialsSchema>(result.issues).nested
  const emailError = errors?.email?.[0]
  const passwordError = errors?.password?.[0]
  const fields: AuthFieldErrors = {}

  if (emailError !== undefined) {
    fields.email = emailError
  }

  if (passwordError !== undefined) {
    fields.password = passwordError
  }

  return {
    fields,
    payload: null
  }
}

function validateEmail(email: string): EmailValidationResult {
  const result = v.safeParse(emailRequestSchema, { email }, {
    abortPipeEarly: true
  })

  if (result.success) {
    return {
      fields: {},
      payload: result.output
    }
  }

  const [issue] = result.issues

  return {
    fields: {
      email: issue.message
    },

    payload: null
  }
}

function validatePassword(password: string): PasswordValidationResult {
  const result = v.safeParse(passwordRequestSchema, { password }, {
    abortPipeEarly: true
  })

  if (result.success) {
    return {
      fields: {},
      payload: result.output
    }
  }

  const [issue] = result.issues

  return {
    fields: {
      password: issue.message
    },

    payload: null
  }
}

export {
  validateCredentials,
  validateEmail,
  validatePassword
}

export type {
  CredentialsPayload,
  EmailValidationResult,
  PasswordValidationResult,
  ValidationResult
}
