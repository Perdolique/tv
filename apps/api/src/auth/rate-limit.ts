import { AuthHttpError } from './errors.ts'
import { hashSha256 } from './hashing.ts'

export async function enforceRateLimit(
  rateLimiter: RateLimit,
  normalizedEmail: string
): Promise<string> {
  const emailHash = await hashSha256(normalizedEmail)

  try {
    const result = await rateLimiter.limit({
      key: emailHash
    })

    if (!result.success) {
      throw new AuthHttpError('RATE_LIMITED', 429)
    }
  } catch (error) {
    if (error instanceof AuthHttpError) {
      throw error
    }

    throw new AuthHttpError('SERVICE_UNAVAILABLE', 503, { cause: error })
  }

  return emailHash
}
