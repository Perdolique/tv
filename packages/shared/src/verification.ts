const VERIFICATION_TOKEN_PATTERN = /^[\w-]{43}$/u

function isVerificationToken(value: unknown): value is string {
  return typeof value === 'string' && VERIFICATION_TOKEN_PATTERN.test(value)
}

export { isVerificationToken }
