import { describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'
import { encodeTimelineCursor, readTimelinePageCursor, type TimelinePageCursor } from '../../timeline-cursors.ts'

const scope = {
  userId: '93000000-0000-4000-8000-000000000001',
  catalogItemId: '93000000-0000-4000-8000-000000000002',
  timeZone: 'Europe/Tallinn'
}

const cursor: TimelinePageCursor = {
  userId: scope.userId,
  catalogItemId: scope.catalogItemId,
  timeZone: scope.timeZone,
  kind: 'timeline',
  version: 4,
  calendarVersion: 'b20b46e4cbf34d76bfb4ae036cd45d31',

  upper: {
    id: '93000000-0000-7000-8000-000000000004',
    occurredAt: '2026-10-25T01:30:00.123456Z'
  },

  after: {
    id: 'episode_group:93000000-0000-7000-8000-000000000003:2026-10-25',
    occurredAt: '2026-10-25T00:00:00.000000Z',
    localDate: '2026-10-25'
  }
}

describe('timeline cursor contracts', () => {
  it('preserves the source microseconds, stable group identity and calendar version in a bounded cursor', () => {
    // Arrange
    const value = encodeTimelineCursor(cursor)

    // Act
    const result = readTimelinePageCursor(value, scope)

    // Assert
    expect(result).toStrictEqual(cursor)
    expect(value.length).toBeLessThan(1024)
    expect(readTimelinePageCursor(null, scope)).toBeNull()
  })

  it.each([
    { userId: '93000000-0000-4000-8000-000000000009' },
    { catalogItemId: '93000000-0000-4000-8000-000000000009' },
    { timeZone: 'UTC' }
  ])('rejects a page cursor reused under another scope: %j', difference => {
    // Arrange
    const value = encodeTimelineCursor(cursor)

    const anotherScope = {
      ...scope,
      ...difference
    }

    // Act and assert
    expect(() => readTimelinePageCursor(value, anotherScope)).toThrow('The request is invalid.')
  })

  it.each([
    { version: 3 },
    { calendarVersion: 'bad-version' },
    { kind: 'episodes' },
    { after: {
      ...cursor.after,
      localDate: '2026-02-30'
    } },
    { after: {
      ...cursor.after,
      id: 'not-an-identity'
    } }
  ])('rejects former contracts and malformed calendar positions: %j', difference => {
    // Arrange
    const payload = JSON.stringify({
      ...cursor,
      ...difference
    })

    const bytes = Buffer.from(payload)
    const value = bytes.toString('base64url')

    // Act and assert
    expect(() => readTimelinePageCursor(value, scope)).toThrow('The request is invalid.')
  })

  const oversizedCursor = 'a'.repeat(4097)

  it.each(['', 'invalid', 'e30', oversizedCursor])('rejects malformed cursor input %s', value => {
    expect(() => readTimelinePageCursor(value, scope)).toThrow('The request is invalid.')
  })

  it.each([
    '2026-02-30T01:30:00.123456Z',
    '0000-10-25T01:30:00.123456Z',
    '2026-10-25T24:30:00.123456Z',
    '2026-10-25T01:30:00.123Z'
  ])('rejects an invalid precise timestamp %s', occurredAt => {
    // Arrange
    const value = encodeTimelineCursor({
      ...cursor,

      upper: {
        ...cursor.upper,
        occurredAt
      }
    })

    // Act and assert
    expect(() => readTimelinePageCursor(value, scope)).toThrow('The request is invalid.')
  })
})
