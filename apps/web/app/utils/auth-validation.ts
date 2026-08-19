import type { AuthFieldErrors } from '~/types/auth.ts'

interface CredentialsPayload {
  email: string;
  password: string;
}

interface ValidationResult {
  fields: AuthFieldErrors;
  payload: CredentialsPayload | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

function validateEmail(email: string): string | null {
  if (email === '') {
    return 'Enter your email address.'
  }

  if (!EMAIL_PATTERN.test(email)) {
    return 'Enter a valid email address.'
  }

  return null
}

function validateCredentials(email: string, password: string): ValidationResult {
  const normalizedEmail = email.trim()
  const fields: AuthFieldErrors = {}
  const emailError = validateEmail(normalizedEmail)

  if (emailError !== null) {
    fields.email = emailError
  }

  if (password === '') {
    fields.password = 'Enter your password.'
  }

  if (Object.keys(fields).length > 0) {
    return {
      fields,
      payload: null
    }
  }

  return {
    fields,

    payload: {
      email: normalizedEmail,
      password
    }
  }
}

export {
  validateCredentials
}

export type {
  CredentialsPayload,
  ValidationResult
}
