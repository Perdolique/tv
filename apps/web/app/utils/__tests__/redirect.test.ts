import { describe, expect, it } from 'vitest'
import { sanitizeRedirectTo } from '../redirect.ts'

describe(sanitizeRedirectTo, () => {
  it.each([
    ['/catalog?query=dark#results', '/catalog?query=dark#results'],
    ['/', '/'],
    ['/shows/42', '/shows/42']
  ])('keeps the internal target %s', (value, expected) => {
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
