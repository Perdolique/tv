import { describe, expect, it } from 'vitest'

import {
  createViewingHistoryResponse,
  decodeViewingCursor,
  encodeViewingCursor,
  type CatalogViewingHistoryRow
} from '../viewing-history.ts'

const cursor = {
  entryId: '30000000-0000-7000-8000-000000000001',
  kind: 'episode',
  markedAt: '2026-09-22T13:00:00.123456Z'
} as const

describe('viewing history cursors', () => {
  it('round trips all timestamp digits and accepts an initial request', () => {
    const encoded = encodeViewingCursor(cursor)
    const serialized = atob(encoded)
    const payload: unknown = JSON.parse(serialized)

    expect(payload).toStrictEqual({
      ...cursor,
      version: 1
    })

    expect(decodeViewingCursor(encoded)).toStrictEqual(cursor)
    expect(decodeViewingCursor(null)).toBeNull()
  })

  it.each([undefined, 0, 2])('rejects cursor version %s', (version) => {
    const payload = JSON.stringify({
      ...cursor,
      version
    })

    const encoded = btoa(payload).replace(/=+$/u, '')

    expect(() => decodeViewingCursor(encoded)).toThrow('The request is invalid.')
  })

  it('rejects padded and noncanonical cursor encodings', () => {
    const encoded = encodeViewingCursor({
      ...cursor,
      kind: 'movie'
    })

    const paddedLength = Math.ceil(encoded.length / 4) * 4
    const padded = encoded.padEnd(paddedLength, '=')
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    const lastCharacter = encoded.slice(-1)
    const lastIndex = alphabet.indexOf(lastCharacter)
    const prefix = encoded.slice(0, -1)
    const noncanonical = `${prefix}${alphabet[lastIndex + 1]}`
    const decodedNoncanonical = atob(noncanonical)
    const decodedCanonical = atob(encoded)

    expect(padded).not.toBe(encoded)
    expect(decodedNoncanonical).toBe(decodedCanonical)
    expect(() => decodeViewingCursor(padded)).toThrow('The request is invalid.')
    expect(() => decodeViewingCursor(noncanonical)).toThrow('The request is invalid.')
  })

  it.each(['', 'invalid', 'e30', 'a'.repeat(1025)])('rejects an invalid cursor: %s', (value) => {
    expect(() => decodeViewingCursor(value)).toThrow('The request is invalid.')
  })

  it.each(['2026-02-30T13:00:00.123456Z', '0000-01-01T00:00:00.000000Z', '2026-09-22T24:00:00.123456Z', '2026-09-22T13:00:00.123Z'])('rejects an invalid timestamp: %s', (markedAt) => {
    const encoded = encodeViewingCursor({
      ...cursor,
      markedAt
    })

    expect(() => decodeViewingCursor(encoded)).toThrow('The request is invalid.')
  })

  it('pages mark identities before translations and keeps different episodes of the same series', () => {
    const rows: CatalogViewingHistoryRow[] = []

    for (let index = 21; index > 0; index -= 1) {
      const suffix = String(index).padStart(12, '0')

      const row: CatalogViewingHistoryRow = {
        catalogItemId: '10000000-0000-7000-8000-000000000001',
        entryId: `30000000-0000-7000-8000-${suffix}`,
        episodeNumber: index,
        isOriginal: true,
        kind: 'episode',
        locale: 'en',
        markedAt: cursor.markedAt,
        posterPath: null,
        releaseYear: 2026,
        seasonNumber: 1,
        sourceTitle: null,
        title: 'Original title',
        type: 'series'
      }

      rows.push(row, {
        ...row,
        isOriginal: false,
        locale: 'ru',
        title: 'Перевод'
      })
    }

    const page = createViewingHistoryResponse(rows, 'ru')

    expect(page.items).toHaveLength(20)
    expect(page.items.map(item => item.episodeNumber)).toStrictEqual(Array.from({ length: 20 }, (_value, index) => 21 - index))
    expect(page.items.every(item => item.title === 'Перевод')).toBe(true)
    expect(page.nextCursor).not.toBeNull()
    expect(decodeViewingCursor(page.nextCursor)?.entryId).toBe('30000000-0000-7000-8000-000000000002')

    expect(createViewingHistoryResponse([], 'en')).toStrictEqual({
      items: [],
      nextCursor: null
    })
  })
})
