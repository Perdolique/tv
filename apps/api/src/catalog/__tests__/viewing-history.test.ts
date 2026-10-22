import { describe, expect, it } from 'vitest'
import { decodeViewingCursor, encodeViewingCursor, parseViewingStatus } from '../viewing-history.ts'

const scope = {
  userId: '30000000-0000-7000-8000-000000000001',
  status: null,
  titleLocale: 'en'
} as const

const cursor = {
  ...scope,
  viewingId: '30000000-0000-7000-8000-000000000002',
  calendarDate: '2026-09-22',
  historyVersion: 'a'.repeat(32),
  version: 6
} as const

describe('viewing history cursors', () => {
  it('round trips a scoped calendar position and accepts an initial request', () => {
    const encoded = encodeViewingCursor(cursor)

    expect(decodeViewingCursor(encoded, scope)).toStrictEqual(cursor)
    expect(decodeViewingCursor(null, scope)).toBeNull()
  })

  it.each([
    { version: undefined }, { version: 0 }, { version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 },
    { calendarDate: '2026-02-30' }, { calendarDate: '0000-01-01' }, { calendarDate: '2026-09-22T00:00:00Z' },
    { historyVersion: 'invalid' }, { viewingId: 'invalid' }, { status: 'paused' }, { status: 'unknown' },
    { userId: '30000000-0000-7000-8000-000000000003' }, { status: 'watching' }, { titleLocale: 'ru' }
  ])('rejects invalid or out-of-scope cursor data: %j', override => {
    const payload = JSON.stringify({
      ...cursor,
      ...override
    })

    const encoded = btoa(payload).replace(/=+$/u, '')

    expect(() => decodeViewingCursor(encoded, scope)).toThrow('The request is invalid.')
  })

  it.each(['', 'invalid', 'e30', 'a'.repeat(2049)])('rejects a malformed encoding: %s', value => {
    expect(() => decodeViewingCursor(value, scope)).toThrow('The request is invalid.')
  })

  it('rejects padded and noncanonical encodings', () => {
    const canonicalScope = {
      ...scope,
      titleLocale: 'es-419'
    }

    const encoded = encodeViewingCursor({
      ...cursor,
      titleLocale: 'es-419'
    })

    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    const lastIndex = alphabet.indexOf(encoded.slice(-1))
    const prefix = encoded.slice(0, -1)
    const noncanonical = `${prefix}${alphabet[lastIndex + 1]}`

    expect(atob(noncanonical)).toBe(atob(encoded))
    expect(() => decodeViewingCursor(`${encoded}=`, canonicalScope)).toThrow('The request is invalid.')
    expect(() => decodeViewingCursor(noncanonical, canonicalScope)).toThrow('The request is invalid.')
  })

  it.each(['paused', 'dropped'] as const)('round trips a cursor scoped to %s', status => {
    const statusScope = {
      ...scope,
      status
    }

    const statusCursor = {
      ...cursor,
      status
    }

    const encoded = encodeViewingCursor(statusCursor)
    const decoded = decodeViewingCursor(encoded, statusScope)

    expect(decoded).toStrictEqual(statusCursor)
    expect(() => decodeViewingCursor(encoded, scope)).toThrow('The request is invalid.')
  })

  it('supports all four explicit status filters and rejects unknown values', () => {
    const all = parseViewingStatus(null)
    const watching = parseViewingStatus('watching')
    const paused = parseViewingStatus('paused')
    const dropped = parseViewingStatus('dropped')
    const completed = parseViewingStatus('completed')

    expect(all).toBeNull()
    expect(watching).toBe('watching')
    expect(paused).toBe('paused')
    expect(dropped).toBe('dropped')
    expect(completed).toBe('completed')
    expect(() => parseViewingStatus('unknown')).toThrow('The request is invalid.')
  })
})
