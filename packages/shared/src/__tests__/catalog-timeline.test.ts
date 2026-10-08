import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { catalogTimelineEpisodesQuerySchema, catalogTimelineQuerySchema } from '../catalog-timeline.ts'

describe('timeline query contracts', () => {
  it('normalizes IANA aliases while preserving the opaque cursor', () => {
    // Arrange
    const query = {
      timeZone: 'US/Eastern',
      cursor: 'opaque-cursor'
    }

    // Act
    const result = v.parse(catalogTimelineQuerySchema, query)

    // Assert
    expect(result).toStrictEqual({
      timeZone: 'America/New_York',
      cursor: 'opaque-cursor'
    })
  })

  it.each([
    {},
    { timeZone: 'Mars/Olympus' },
    { timeZone: '+03:00' },
    {
      timeZone: 'UTC',
      cursor: ''
    },
    {
      timeZone: 'UTC',
      userId: 'another-account'
    }
  ])('rejects unsupported history queries: %j', input => {
    expect(v.is(catalogTimelineQuerySchema, input)).toBe(false)
  })

  it.each(['2026-02-29', '2026-02-30', '0000-01-01', '2026-10-25T00:00:00Z'])('rejects an impossible local day: %s', localDate => {
    // Arrange
    const input = {
      timeZone: 'Europe/Tallinn',
      viewingId: '93000000-0000-7000-8000-000000000005',
      localDate,
      groupCursor: 'opaque-group'
    }

    // Act and assert
    expect(v.is(catalogTimelineEpisodesQuerySchema, input)).toBe(false)
  })
})
