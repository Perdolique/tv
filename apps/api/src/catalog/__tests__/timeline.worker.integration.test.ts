import { env, exports } from 'cloudflare:workers'
import assert from 'node:assert/strict'
import type { CatalogTimelineEpisodesResponse, CatalogTimelineResponse } from '@tv/shared/catalog-timeline'
import { Client } from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashSessionToken } from '../../auth/session.ts'
import { assertDisposableTestDatabase } from '../../testing/test-database.ts'

const SESSION_TOKEN = 't'.repeat(43)
const USER_ID = '93000000-0000-4000-8000-000000000021'
const SERIES_ID = '93000000-0000-4000-8000-000000000023'
const COOKIE = `__Host-tv_session=${SESSION_TOKEN}`

const invalidQueries: Record<string, string>[] = [
  {},
  { timeZone: 'Mars/Olympus' },
  {
    timeZone: 'UTC',
    cursor: 'bad'
  },
  {
    timeZone: 'UTC',
    userId: USER_ID
  },
  {
    timeZone: 'UTC',
    ['__proto__']: 'ignored'
  }
]

async function withClient<Result>(operation: (client: Client) => Promise<Result>): Promise<Result> {
  const client = new Client({ connectionString: env.DATABASE.connectionString })

  try {
    await client.connect()
    await assertDisposableTestDatabase(client)

    return await operation(client)
  } finally {
    await client.end()
  }
}

async function request(path: string, cookie: string | null = COOKIE): Promise<Response> {
  const headers = new Headers()

  if (cookie !== null) {
    headers.set('Cookie', cookie)
  }

  const url = `https://tv-api.test${path}`
  const upstream = new Request(url, { headers })

  return exports.default.fetch(upstream)
}

function timelineUrl(parameters: Record<string, string>, suffix = ''): string {
  const query = new URLSearchParams(parameters)
  const queryString = query.toString()
  const path = `/api/catalog/items/${SERIES_ID}/timeline${suffix}?${queryString}`

  return path
}

describe('private timeline Worker contract', () => {
  beforeEach(async () => {
    const hash = await hashSessionToken(SESSION_TOKEN)

    await withClient(async client => {
      await client.query('DELETE FROM users WHERE id = $1', [USER_ID])
      await client.query('DELETE FROM catalog_items WHERE id = $1', [SERIES_ID])
      await client.query('INSERT INTO users (id, email) VALUES ($1, \'timeline-worker@example.com\')', [USER_ID])
      await client.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'1 day\')', [USER_ID, hash])
      await client.query('INSERT INTO catalog_items (id, type) VALUES ($1, \'series\')', [SERIES_ID])
      await client.query('INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original) VALUES ($1, \'en\', \'Worker timeline series\', true)', [SERIES_ID])
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()

    await withClient(async client => {
      await client.query('DELETE FROM users WHERE id = $1', [USER_ID])
      await client.query('DELETE FROM catalog_items WHERE id = $1', [SERIES_ID])
    })
  })

  it.each(['', '/episodes'])('authenticates %s before validating IDs and queries', async suffix => {
    // Act
    const path = `/api/catalog/items/invalid/timeline${suffix}?timeZone=invalid&cursor=bad`
    const response = await request(path, null)

    // Assert
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'AUTHENTICATION_REQUIRED' } })
  })

  it.each(invalidQueries)('rejects invalid or foreign query fields: %j', async parameters => {
    // Act
    const path = timelineUrl(parameters)
    const response = await request(path)

    // Assert
    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('returns empty history and rejects duplicate time zones', async () => {
    // Act
    const timelinePath = timelineUrl({ timeZone: 'UTC' })
    const response = await request(timelinePath)
    const duplicateUrl = `${timelinePath}&timeZone=Europe%2FTallinn`
    const duplicate = await request(duplicateUrl)

    // Assert
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')

    await expect(response.json()).resolves.toStrictEqual({
      items: [],
      nextCursor: null
    })

    expect(duplicate.status).toBe(400)
  })

  it('returns one full group and bounds independent detail pages to it', async () => {
    // Arrange
    const viewingId = await withClient(async client => {
      await client.query('INSERT INTO catalog_episodes (catalog_item_id, season_number, episode_number) SELECT $1, 1, number FROM generate_series(1, 25) number', [SERIES_ID])

      const viewings = await client.query<{ id: string }>('INSERT INTO catalog_viewings (user_id, catalog_item_id, status) VALUES ($1, $2, \'watching\') RETURNING id', [USER_ID, SERIES_ID])
      const id = viewings.rows[0]?.id

      assert.ok(id !== undefined, 'Viewing fixture is missing')

      await client.query(`
        WITH marks AS (
          INSERT INTO catalog_viewing_episode_watches (user_id, catalog_item_id, viewing_id, catalog_episode_id, marked_at)
          SELECT $1, $2, $3, id, '2026-10-25T01:30:00.123456Z'::timestamptz FROM catalog_episodes
          WHERE catalog_item_id = $2 RETURNING *
        )
        INSERT INTO catalog_timeline_events (user_id, catalog_item_id, kind, viewing_id, watch_id, catalog_episode_id, occurred_at)
        SELECT user_id, catalog_item_id, 'episode_watched', viewing_id, id, catalog_episode_id, marked_at FROM marks
      `, [USER_ID, SERIES_ID, id])

      return id
    })

    // Act
    const timelinePath = timelineUrl({ timeZone: 'Europe/Tallinn' })
    const response = await request(timelinePath)
    const timeline = await response.json<CatalogTimelineResponse>()
    const [group] = timeline.items

    expect(group?.kind).toBe('episode_group')
    assert.ok(group?.kind === 'episode_group', 'Episode group is missing')

    const parameters = {
      timeZone: 'Europe/Tallinn',
      viewingId,
      localDate: group.localDate,
      groupCursor: group.episodesCursor
    }

    const detailsPath = timelineUrl(parameters, '/episodes')
    const detailsResponse = await request(detailsPath)
    const details = await detailsResponse.json<CatalogTimelineEpisodesResponse>()

    assert.ok(details.nextCursor !== null, 'Episode detail cursor is missing')

    const nextParameters = {
      ...parameters,
      cursor: details.nextCursor
    }

    const nextPath = timelineUrl(nextParameters, '/episodes')
    const nextResponse = await request(nextPath)
    const next = await nextResponse.json<CatalogTimelineEpisodesResponse>()

    const wrongDayParameters = {
      ...parameters,
      localDate: '2026-10-26'
    }

    const wrongDayPath = timelineUrl(wrongDayParameters, '/episodes')
    const wrongDay = await request(wrongDayPath)

    // Assert
    expect(timeline.items).toHaveLength(1)
    expect(group.totalCount).toBe(25)
    expect(details.items).toHaveLength(20)
    expect(next.items).toHaveLength(5)
    expect(next.nextCursor).toBeNull()
    expect(detailsResponse.headers.get('cache-control')).toBe('no-store')
    expect(nextResponse.headers.get('cache-control')).toBe('no-store')
    expect(wrongDay.status).toBe(400)
  })

  it('shows safe infrastructure errors and logs their raw cause', async () => {
    // Arrange
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {
      // Captured diagnostics are checked below.
    })

    await withClient(async client => {
      await client.query('ALTER TABLE catalog_timeline_events RENAME TO catalog_timeline_events_unavailable')

      try {
        // Act
        const timelinePath = timelineUrl({ timeZone: 'UTC' })
        const response = await request(timelinePath)

        // Assert
        expect(response.status).toBe(503)
        expect(response.headers.get('cache-control')).toBe('no-store')

        await expect(response.json()).resolves.toMatchObject({ error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'The catalog is temporarily unavailable.'
        } })

        const technicalLogs = JSON.stringify(logs.mock.calls)

        expect(technicalLogs).toContain('catalog_timeline_events')
        expect(technicalLogs).toContain('does not exist')
      } finally {
        await client.query('ALTER TABLE catalog_timeline_events_unavailable RENAME TO catalog_timeline_events')
      }
    })
  })
})
