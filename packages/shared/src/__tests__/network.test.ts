import { describe, expect, it } from 'vitest'
import { isLoopbackHostname } from '../network.ts'

describe('isLoopbackHostname()', () => {
  it.each([
    '127.0.0.1',
    '[::1]',
    '::1',
    'localhost'
  ])('accepts %s', (hostname) => {
    expect(isLoopbackHostname(hostname)).toBe(true)
  })

  it.each([
    '0.0.0.0',
    'api.example.com',
    'localhost.example.com'
  ])('rejects %s', (hostname) => {
    expect(isLoopbackHostname(hostname)).toBe(false)
  })
})
