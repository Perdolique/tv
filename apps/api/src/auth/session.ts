import type { CookieOptions } from 'hono/utils/cookie'
import { isLoopbackHostname } from '@tv/shared/network'
import * as v from 'valibot'
import { encodeBase64Url } from './base64url.ts'
import { SESSION_DURATION_SECONDS } from './constants.ts'
import { hashSha256 } from './hashing.ts'

const SESSION_TOKEN_LENGTH = 32
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u

const sessionTokenSchema = v.pipe(
  v.string(),
  v.regex(SESSION_TOKEN_PATTERN)
)

function isSessionTransportAllowed(requestUrl: string): boolean {
  const url = new URL(requestUrl)

  return url.protocol === 'https:'
    || (url.protocol === 'http:' && isLoopbackHostname(url.hostname))
}

function usesSecureSessionCookie(requestUrl: string): boolean {
  if (!isSessionTransportAllowed(requestUrl)) {
    throw new TypeError('Session cookies require HTTPS outside local development')
  }

  return new URL(requestUrl).protocol === 'https:'
}

function createSessionToken(): string {
  const tokenBytes = new Uint8Array(SESSION_TOKEN_LENGTH)

  crypto.getRandomValues(tokenBytes)

  return encodeBase64Url(tokenBytes)
}

function isSessionToken(value: unknown): value is string {
  return v.is(sessionTokenSchema, value)
}

async function hashSessionToken(token: string): Promise<string> {
  return hashSha256(token)
}

function getSessionCookieName(requestUrl: string): string {
  return usesSecureSessionCookie(requestUrl)
    ? '__Host-tv_session'
    : 'tv_session'
}

function getSessionCookieOptions(requestUrl: string): CookieOptions {
  const secure = usesSecureSessionCookie(requestUrl)

  return {
    httpOnly: true,
    maxAge: SESSION_DURATION_SECONDS,
    path: '/',
    sameSite: 'Lax',
    secure
  }
}

function getExpiredSessionCookieOptions(requestUrl: string): CookieOptions {
  const options = getSessionCookieOptions(requestUrl)

  return {
    ...options,
    expires: new Date(0),
    maxAge: 0
  }
}

export {
  createSessionToken,
  getExpiredSessionCookieOptions,
  getSessionCookieName,
  getSessionCookieOptions,
  hashSessionToken,
  isSessionTransportAllowed,
  isSessionToken
}
