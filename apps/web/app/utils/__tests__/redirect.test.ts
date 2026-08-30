import { sanitizeRedirectTo } from '@tv/shared/redirect'
import { describe, expect, it } from 'vitest'

describe(sanitizeRedirectTo, () => {
  it.each([
    ['/catalog?query=dark#results', '/catalog?query=dark'],
    ['/', '/'],
    ['/shows/42', '/shows/42']
  ])('keeps the safe part of internal target %s', (value, expected) => {
    expect(sanitizeRedirectTo(value)).toBe(expected)
  })

  it.each([
    '',
    'https://example.com/account',
    '//example.com/account',
    String.raw`/\example.com/account`,
    '/register',
    '/register?redirectTo=/private',
    '/sign-in',
    '/sign-in/',
    ['/', '/private'],
    null,
    undefined
  ])('replaces unsafe target %j with the fallback', (value) => {
    expect(sanitizeRedirectTo(value)).toBe('/')
  })
})
