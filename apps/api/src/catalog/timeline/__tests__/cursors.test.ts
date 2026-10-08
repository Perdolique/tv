import { describe, expect, it } from 'vitest'

import {
  encodeTimelineCursor,
  readTimelineEpisodesCursor,
  readTimelineGroupCursor,
  readTimelinePageCursor,
  type TimelineGroupCursor
} from '../../timeline-cursors.ts'

const scope = {
  userId: '93000000-0000-4000-8000-000000000001',
  catalogItemId: '93000000-0000-4000-8000-000000000002',
  timeZone: 'Europe/Tallinn'
}

const upper = {
  id: '93000000-0000-7000-8000-000000000004',
  occurredAt: '2026-10-25T01:30:00.123456Z'
}

const after = {
  id: '93000000-0000-7000-8000-000000000003',
  occurredAt: '2026-10-25T01:30:00.123455Z'
}

const group: TimelineGroupCursor = {
  ...scope,
  viewingId: '93000000-0000-7000-8000-000000000005',
  localDate: '2026-10-25',
  kind: 'group',
  upper,
  version: 1
}

describe('timeline cursor contracts', () => {
  it('keeps microseconds and independent timeline, group and episode positions', () => {
    // Arrange
    const timeline = {
      ...scope,
      kind: 'timeline',
      version: 1,
      upper,
      after,
      boundaryDate: '2026-10-25',

      oldestSeenViewing: {
        id: group.viewingId,
        recordedAt: '2026-10-24T01:30:00.123456Z'
      }
    } as const

    const episodes = {
      ...group,
      kind: 'episodes',
      after
    } as const

    const timelineValue = encodeTimelineCursor(timeline)
    const groupValue = encodeTimelineCursor(group)
    const episodesValue = encodeTimelineCursor(episodes)

    // Act
    const page = readTimelinePageCursor(timelineValue, scope)
    const snapshot = readTimelineGroupCursor(groupValue, group)
    const detail = readTimelineEpisodesCursor(episodesValue, snapshot)

    // Assert
    expect(page).toStrictEqual(timeline)
    expect(snapshot).toStrictEqual(group)
    expect(detail).toStrictEqual(episodes)
    expect(readTimelinePageCursor(null, scope)).toBeNull()
    expect(readTimelineEpisodesCursor(null, group)).toBeNull()
    expect(() => readTimelinePageCursor(groupValue, scope)).toThrow('The request is invalid.')
    expect(() => readTimelineGroupCursor(timelineValue, group)).toThrow('The request is invalid.')
  })

  it.each([
    { userId: '93000000-0000-4000-8000-000000000009' },
    { catalogItemId: '93000000-0000-4000-8000-000000000009' },
    { timeZone: 'UTC' }
  ])('rejects a page cursor reused under another scope: %j', difference => {
    // Arrange
    const value = encodeTimelineCursor({
      ...scope,
      kind: 'timeline',
      version: 1,
      upper,
      after,
      boundaryDate: '2026-10-25',
      oldestSeenViewing: null
    })

    const anotherScope = {
      ...scope,
      ...difference
    }

    // Act and assert
    expect(() => readTimelinePageCursor(value, anotherScope)).toThrow('The request is invalid.')
  })

  it.each([
    { viewingId: '93000000-0000-7000-8000-000000000009' },
    { localDate: '2026-10-26' },
    { timeZone: 'UTC' }
  ])('binds group details to their viewing, day and time zone: %j', difference => {
    // Arrange
    const value = encodeTimelineCursor(group)

    const anotherGroup = {
      ...group,
      ...difference
    }

    // Act and assert
    expect(() => readTimelineGroupCursor(value, anotherGroup)).toThrow('The request is invalid.')
  })

  it('rejects an episode cursor from a different upper bound', () => {
    // Arrange
    const value = encodeTimelineCursor({
      ...group,
      kind: 'episodes',
      after
    })

    const anotherSnapshot = {
      ...group,

      upper: {
        ...upper,
        occurredAt: '2026-10-25T01:30:00.123457Z'
      }
    }

    // Act and assert
    expect(() => readTimelineEpisodesCursor(value, anotherSnapshot)).toThrow('The request is invalid.')
  })

  const oversizedCursor = 'a'.repeat(4097)

  it.each(['', 'invalid', 'e30', oversizedCursor])('rejects a malformed cursor %s', value => {
    expect(() => readTimelinePageCursor(value, scope)).toThrow('The request is invalid.')
  })

  it.each([
    '2026-02-30T01:30:00.123456Z',
    '0000-10-25T01:30:00.123456Z',
    '2026-10-25T24:30:00.123456Z',
    '2026-10-25T01:30:00.123Z',
    '2026-10-25T01:30:00.123457Z'
  ])('rejects invalid or out of bound positions %s', occurredAt => {
    // Arrange
    const value = encodeTimelineCursor({
      ...scope,
      kind: 'timeline',
      version: 1,
      upper,
      boundaryDate: '2026-10-25',
      oldestSeenViewing: null,

      after: {
        ...after,
        occurredAt
      }
    })

    // Act and assert
    expect(() => readTimelinePageCursor(value, scope)).toThrow('The request is invalid.')
  })
})
