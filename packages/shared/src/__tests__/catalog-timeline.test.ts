import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { catalogTimelineQuerySchema, catalogTimelineResponseSchema } from '../catalog-timeline.ts'

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
    const isValidQuery = v.is(catalogTimelineQuerySchema, input)

    expect(isValidQuery).toBe(false)
  })

  it.each(['rating_changed', 'series_paused'])('rejects a removed kind in a current start event: %s', kind => {
    // Arrange
    const input = {
      items: [{
        id: '93000000-0000-4000-8000-000000000005',
        kind,
        occurredAt: '2026-10-17T00:00:00.000Z',
        viewingId: '93000000-0000-4000-8000-000000000006',
        startedOn: '2026-10-17',
        score: null
      }],

      nextCursor: null
    }

    // Act and assert
    const isValidTimeline = v.is(catalogTimelineResponseSchema, input)

    expect(isValidTimeline).toBe(false)
  })

  it.each([{
    id: '93000000-0000-4000-8000-000000000005',
    kind: 'rating_changed',
    occurredAt: '2026-10-17T00:00:00.000Z',
    target: 'item',
    seasonNumber: null,
    catalogEpisodeId: null,
    episodeNumber: null,
    previousScore: 6,
    score: 8
  }, {
    id: '93000000-0000-4000-8000-000000000005',
    kind: 'series_paused',
    occurredAt: '2026-10-17T00:00:00.000Z',
    viewingId: '93000000-0000-4000-8000-000000000006'
  }])('rejects a removed legacy event: $kind', item => {
    // Arrange
    const input = {
      items: [item],
      nextCursor: null
    }

    // Act
    const isValidTimeline = v.is(catalogTimelineResponseSchema, input)

    // Assert
    expect(isValidTimeline).toBe(false)
  })

  it.each(['2026-02-29', '2026-02-30', '0000-01-01', '2026-10-25T00:00:00Z'])('rejects an impossible viewing calendar day: %s', startedOn => {
    // Arrange
    const input = {
      items: [{
        id: '93000000-0000-4000-8000-000000000005',
        kind: 'series_started',
        occurredAt: '2026-10-17T00:00:00.000Z',
        viewingId: '93000000-0000-4000-8000-000000000006',
        startedOn,
        score: null
      }],

      nextCursor: null
    }

    // Act and assert
    expect(v.is(catalogTimelineResponseSchema, input)).toBe(false)
  })
})
