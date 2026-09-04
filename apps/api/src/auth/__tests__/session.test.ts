import { generateCookie } from 'hono/cookie'
import { describe, expect, it } from 'vitest'

import {
  createSessionToken,
  getExpiredSessionCookieOptions,
  getSessionCookieName,
  getSessionCookieOptions,
  hashSessionToken,
  isSessionTransportAllowed,
  isSessionToken
} from '../session.ts'

describe('session tokens and cookies', () => {
  it('creates independent 256-bit base64url tokens', () => {
    const firstToken = createSessionToken()
    const secondToken = createSessionToken()

    expect(firstToken).toHaveLength(43)
    expect(isSessionToken(firstToken)).toBe(true)
    expect(secondToken).not.toBe(firstToken)
  })

  it.each([
    ['empty', ''],
    ['undefined', undefined],
    ['malformed', '!'.repeat(43)]
  ])('rejects a %s session token', (_case, token) => {
    expect(isSessionToken(token)).toBe(false)
  })

  it('hashes a token deterministically without preserving the token', async () => {
    const token = createSessionToken()

    const [firstHash, secondHash] = await Promise.all([
      hashSessionToken(token),
      hashSessionToken(token)
    ])

    expect(firstHash).toBe(secondHash)
    expect(firstHash).toMatch(/^[0-9a-f]{64}$/u)
    expect(firstHash).not.toContain(token)
  })

  it('uses the secure host cookie on HTTPS', () => {
    const requestUrl = 'https://tv-api.example.com/api/auth/sign-in'
    const name = getSessionCookieName(requestUrl)

    const cookie = generateCookie(
      name,
      createSessionToken(),
      getSessionCookieOptions(requestUrl)
    )

    expect(name).toBe('__Host-tv_session')
    expect(cookie).toContain('Max-Age=2592000')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).not.toContain('Domain=')
  })

  it('uses the non-secure local cookie on HTTP', () => {
    const requestUrl = 'http://127.0.0.1:8788/api/auth/sign-in'
    const name = getSessionCookieName(requestUrl)

    const cookie = generateCookie(
      name,
      createSessionToken(),
      getSessionCookieOptions(requestUrl)
    )

    expect(name).toBe('tv_session')
    expect(cookie).not.toContain('Secure')
  })

  it('expires the HTTPS host cookie without a domain', () => {
    const requestUrl = 'https://tv-api.example.com/api/auth/session'
    const name = getSessionCookieName(requestUrl)

    const cookie = generateCookie(
      name,
      '',
      getExpiredSessionCookieOptions(requestUrl)
    )

    expect(cookie).toBe(
      '__Host-tv_session=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax'
    )

    expect(cookie).not.toContain('Domain=')
  })

  it('rejects insecure transport outside loopback development hosts', () => {
    const requestUrl = 'http://tv-api.example.com/api/auth/sign-in'

    expect(isSessionTransportAllowed(requestUrl)).toBe(false)

    expect(() => getSessionCookieName(requestUrl)).toThrow(
      'Session cookies require HTTPS outside local development'
    )
  })
})
