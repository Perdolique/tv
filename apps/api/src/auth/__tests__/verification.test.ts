import { isVerificationToken } from '@tv/shared/verification'
import { describe, expect, it } from 'vitest'
import { createVerificationToken, hashVerificationToken } from '../verification.ts'

describe('email verification tokens', () => {
  it('creates independent 256-bit base64url tokens', () => {
    const firstToken = createVerificationToken()
    const secondToken = createVerificationToken()

    expect(firstToken).toMatch(/^[\w-]{43}$/u)
    expect(secondToken).toMatch(/^[\w-]{43}$/u)
    expect(firstToken).not.toBe(secondToken)
    expect(isVerificationToken(firstToken)).toBe(true)
  })

  it('hashes tokens deterministically without retaining the plaintext value', async () => {
    const token = 'a'.repeat(43)
    const tokenHash = await hashVerificationToken(token)

    expect(tokenHash).toMatch(/^[\da-f]{64}$/u)
    expect(tokenHash).not.toContain(token)
    await expect(hashVerificationToken(token)).resolves.toBe(tokenHash)
  })

  it.each([
    '',
    'a'.repeat(42),
    'a'.repeat(44),
    `${'a'.repeat(42)}+`,
    null
  ])('rejects malformed token %j', (token) => {
    expect(isVerificationToken(token)).toBe(false)
  })
})
