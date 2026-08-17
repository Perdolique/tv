import type { AuthFieldErrors } from '~/types/auth.ts'

interface CredentialsPayload {
  email: string;
  password: string;
}

interface RegistrationFormValues extends CredentialsPayload {
  passwordConfirmation: string;
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

function validateRegistration(values: RegistrationFormValues): ValidationResult {
  const result = validateCredentials(values.email, values.password)

  if (values.passwordConfirmation === '') {
    result.fields.passwordConfirmation = 'Confirm your password.'
  } else if (values.passwordConfirmation !== values.password) {
    result.fields.passwordConfirmation = 'Passwords do not match.'
  }

  if (Object.keys(result.fields).length > 0) {
    return {
      fields: result.fields,
      payload: null
    }
  }

  return result
}

export {
  validateCredentials,
  validateRegistration
}

export type {
  CredentialsPayload,
  RegistrationFormValues,
  ValidationResult
}
