import { describe, expect, it } from 'vitest'
import { decodeBase64Url, encodeBase64Url } from '../base64url.ts'

describe('base64url encoding', () => {
  it('matches the Node Buffer encoding contract', () => {
    const bytes = Uint8Array.from([251, 255])
    const encoded = encodeBase64Url(bytes)
    const decoded = decodeBase64Url('-_8')

    expect(encoded).toBe('-_8')
    expect(decoded).toStrictEqual(bytes)
  })
})
