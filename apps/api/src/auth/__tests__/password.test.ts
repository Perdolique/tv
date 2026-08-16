import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../password.ts'

const BUFFER_GENERATED_PASSWORD_HASH = [
  '$scrypt$ln=14,r=8,p=5',
  '-_8AAQIDBAUGBwgJCgsMDQ',
  'cWW2cRSPDEYDo2dH50qx6SSGUAca5YJ1b6CFaZ3Yfzta7BgVlu75d3iA2tOo7F9wOLcf1cruts-0gFT-OjY3cQ'
].join('$')

describe('scrypt password hashes', () => {
  it('creates the versioned format with the configured parameters', async () => {
    const passwordHash = await hashPassword('a sufficiently long password')

    expect(passwordHash).toMatch(
      /^\$scrypt\$ln=14,r=8,p=5\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/u
    )
  })

  it('accepts the matching password and rejects another password', async () => {
    const passwordHash = await hashPassword('a sufficiently long password')

    const [matches, doesNotMatch] = await Promise.all([
      verifyPassword('a sufficiently long password', passwordHash),
      verifyPassword('another sufficiently long password', passwordHash)
    ])

    expect(matches).toBe(true)
    expect(doesNotMatch).toBe(false)
  })

  it('verifies a persisted Buffer-generated hash', async () => {
    const matches = await verifyPassword(
      'legacy password',
      BUFFER_GENERATED_PASSWORD_HASH
    )

    expect(matches).toBe(true)
  })

  it('treats canonically equivalent Unicode passwords as equal', async () => {
    const passwordHash = await hashPassword(`Cafe\u0301${'x'.repeat(10)}`)
    const matches = await verifyPassword(`Café${'x'.repeat(10)}`, passwordHash)

    expect(matches).toBe(true)
  })

  it('rejects an unsupported stored hash format', async () => {
    await expect(verifyPassword('password', '$argon2id$invalid')).rejects.toThrow(
      'Unsupported password hash format'
    )
  })
})
