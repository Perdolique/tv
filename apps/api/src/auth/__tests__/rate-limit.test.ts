import { describe, expect, it, type Mock, vi } from 'vitest'
import type { AuthHttpError } from '../errors.ts'
import { enforceRateLimit } from '../rate-limit.ts'

function createRateLimiter(success: boolean): {
  limit: Mock<RateLimit['limit']>;
  rateLimiter: RateLimit;
} {
  const limit = vi.fn<RateLimit['limit']>().mockResolvedValue({ success })

  return {
    limit,
    rateLimiter: { limit }
  }
}

describe(enforceRateLimit, () => {
  it('keys the limiter by normalized email hash', async () => {
    const { limit, rateLimiter } = createRateLimiter(true)

    const emailHash = await enforceRateLimit(
      rateLimiter,
      'person@example.com'
    )

    expect(emailHash).toMatch(/^[0-9a-f]{64}$/u)
    expect(limit).toHaveBeenCalledWith({
      key: emailHash
    })
  })

  it('returns the public rate-limited error when the quota is exhausted', async () => {
    const { rateLimiter } = createRateLimiter(false)

    await expect(
      enforceRateLimit(rateLimiter, 'person@example.com')
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429
    } satisfies Partial<AuthHttpError>)
  })

  it('fails closed when the binding fails', async () => {
    const bindingError = new Error('rate limiting unavailable')

    const rateLimiter = {
      limit: vi.fn().mockRejectedValue(bindingError)
    }

    await expect(
      enforceRateLimit(rateLimiter, 'person@example.com')
    ).rejects.toMatchObject({
      cause: bindingError,
      code: 'SERVICE_UNAVAILABLE',
      status: 503
    } satisfies Partial<AuthHttpError>)
  })
})
