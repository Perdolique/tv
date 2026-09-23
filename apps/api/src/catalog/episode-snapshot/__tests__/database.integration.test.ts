import * as v from 'valibot'
import { readFile } from 'node:fs/promises'
import { env } from 'node:process'
import { URL } from 'node:url'
import { Client } from 'pg'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  episodeSnapshotSchema,
  renderEpisodeMigration,
  type SnapshotSeries
} from '../../../../scripts/catalog-episode-snapshot.ts'

import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'

const databaseUrl = env.TEST_DATABASE_URL

if (databaseUrl === undefined || databaseUrl === '') {
  throw new Error('TEST_DATABASE_URL is required for database integration tests')
}

const client = new Client({ connectionString: databaseUrl })
const snapshotUrl = new URL('../../../../../../packages/database/data/catalog-episodes.json', import.meta.url)
const serialized = await readFile(snapshotUrl, 'utf8')
const snapshot = v.parse(episodeSnapshotSchema, JSON.parse(serialized))
const migration = renderEpisodeMigration(snapshot)

type ExpectedEpisodeRow = SnapshotSeries['episodes'][number] & {
  series: string;
  year: number;
}

await client.connect()
await assertDisposableTestDatabase(client)

describe('catalog episode snapshot migration', () => {
  beforeEach(async () => {
    await client.query('BEGIN')
  })

  afterEach(async () => {
    await client.query('ROLLBACK')
  })

  afterAll(async () => {
    await client.end()
  })

  it('covers every catalog series with the reviewed source and exact episode data', async () => {
    const coverage = await client.query(`
      SELECT title.title, item.release_year AS year, count(episode.id)::integer AS episodes
      FROM catalog_items AS item
      JOIN catalog_item_titles AS title ON title.catalog_item_id = item.id AND title.locale = 'en'
      LEFT JOIN catalog_episodes AS episode ON episode.catalog_item_id = item.id
      WHERE item.type = 'series'
      GROUP BY item.id, title.title ORDER BY title.title
    `)

    expect(coverage.rows).toStrictEqual([
      {
        title: '1923',
        year: 2022,
        episodes: 15
      },
      {
        title: 'A Different World',
        year: 2026,
        episodes: 10
      },
      {
        title: 'American Horror Story',
        year: 2011,
        episodes: 145
      },
      {
        title: 'Chernobyl',
        year: 2019,
        episodes: 5
      },
      {
        title: 'Cyberpunk: Edgerunners',
        year: 2022,
        episodes: 10
      },
      {
        title: 'Cyberpunk: Edgerunners 2',
        year: 2026,
        episodes: 10
      },
      {
        title: 'Kingdom',
        year: 2019,
        episodes: 12
      },
      {
        title: 'Percy Jackson and the Olympians',
        year: 2023,
        episodes: 24
      },
      {
        title: 'Pride and Prejudice',
        year: 2026,
        episodes: 6
      },
      {
        title: 'South Park',
        year: 1997,
        episodes: 335
      },
      {
        title: 'Spartacus',
        year: 2010,
        episodes: 33
      },
      {
        title: 'Stargate Atlantis',
        year: 2004,
        episodes: 100
      },
      {
        title: 'The Forsytes',
        year: 2025,
        episodes: 6
      },
      {
        title: 'The Gold',
        year: 2023,
        episodes: 12
      },
      {
        title: 'The Wire',
        year: 2002,
        episodes: 60
      }
    ])

    const episodes = await client.query(`
      SELECT title.title AS series, item.release_year AS year, link.external_id::integer AS "tvmazeId",
        episode.season_number AS season, episode.episode_number AS number,
        episode.source_title AS title, episode.air_date::text AS "airDate"
      FROM catalog_episodes AS episode
      JOIN catalog_external_links AS link
        ON link.catalog_episode_id = episode.id
          AND link.provider = 'tvmaze' AND link.entity_type = 'episode'
      JOIN catalog_items AS item ON item.id = episode.catalog_item_id
      JOIN catalog_item_titles AS title ON title.catalog_item_id = item.id AND title.locale = 'en'
      ORDER BY link.external_id::integer
    `)

    const expected: ExpectedEpisodeRow[] = []

    for (const series of snapshot.series) {
      for (const episode of series.episodes) {
        expected.push({
          series: series.source.title,
          year: series.source.year,
          tvmazeId: episode.tvmazeId,
          season: episode.season,
          number: episode.number,
          title: episode.title,
          airDate: episode.airDate
        })
      }
    }

    expected.sort((first, second) => first.tvmazeId - second.tvmazeId)
    expect(episodes.rows).toStrictEqual(expected)
  })

  it('adds the snapshot without changing old UUIDs, watched marks, or calendar data and is repeatable', async () => {
    await client.query(`
      DELETE FROM catalog_episodes
      WHERE id NOT BETWEEN '30000000-0000-7000-8000-000000000001' AND '30000000-0000-7000-8000-000000000005'
    `)

    await client.query(`
      INSERT INTO users (id, email)
      VALUES ('72000000-0000-7000-8000-000000000001', 'snapshot-watch@example.com');
      INSERT INTO catalog_episode_watches (user_id, catalog_episode_id, marked_at)
      VALUES ('72000000-0000-7000-8000-000000000001', '30000000-0000-7000-8000-000000000001', '2026-09-21T12:00:00Z');
    `)

    const oldEpisodes = await client.query('SELECT * FROM catalog_episodes ORDER BY id')
    const oldWatches = await client.query('SELECT * FROM catalog_episode_watches ORDER BY user_id, catalog_episode_id')
    const oldReleases = await client.query('SELECT * FROM catalog_releases ORDER BY id')

    await client.query(migration)

    const preserved = await client.query(`
      SELECT * FROM catalog_episodes
      WHERE id BETWEEN '30000000-0000-7000-8000-000000000001' AND '30000000-0000-7000-8000-000000000005'
      ORDER BY id
    `)

    expect(preserved.rows).toStrictEqual(oldEpisodes.rows)

    const firstImport = await client.query('SELECT * FROM catalog_episodes ORDER BY id')

    expect(firstImport.rows).toHaveLength(783)
    await client.query(migration)

    const repeated = await client.query('SELECT * FROM catalog_episodes ORDER BY id')
    const watches = await client.query('SELECT * FROM catalog_episode_watches ORDER BY user_id, catalog_episode_id')
    const releases = await client.query('SELECT * FROM catalog_releases ORDER BY id')

    expect(repeated.rows).toStrictEqual(firstImport.rows)
    expect(watches.rows).toStrictEqual(oldWatches.rows)
    expect(releases.rows).toStrictEqual(oldReleases.rows)
  })

  it('updates source metadata safely and does not delete episodes absent from a later snapshot', async () => {
    const laterSnapshot = structuredClone(snapshot)

    for (const series of laterSnapshot.series) {
      series.episodes = series.episodes.slice(0, 1)

      for (const episode of series.episodes) {
        episode.title = 'Updated viewer\'s title; $$'
        episode.airDate = null
      }
    }

    const before = await client.query(`
      SELECT episode.id, link.external_id FROM catalog_episodes AS episode
      JOIN catalog_external_links AS link ON link.catalog_episode_id = episode.id
        AND link.provider = 'tvmaze' AND link.entity_type = 'episode'
      ORDER BY episode.id
    `)

    const sql = renderEpisodeMigration(laterSnapshot)

    await client.query(sql)

    const after = await client.query(`
      SELECT episode.id, link.external_id FROM catalog_episodes AS episode
      JOIN catalog_external_links AS link ON link.catalog_episode_id = episode.id
        AND link.provider = 'tvmaze' AND link.entity_type = 'episode'
      ORDER BY episode.id
    `)

    const changed = await client.query(`
      SELECT count(*)::integer AS count FROM catalog_episodes WHERE source_title = $1 AND air_date IS NULL
    `, ['Updated viewer\'s title; $$'])

    expect(after.rows).toStrictEqual(before.rows)
    expect(changed.rows).toStrictEqual([{ count: 15 }])
  })

  it('refuses to move a watched source episode to another coordinate', async () => {
    await client.query(`
      UPDATE catalog_episodes SET episode_number = 99
      WHERE id = (
        SELECT catalog_episode_id FROM catalog_external_links
        WHERE provider = 'tvmaze' AND entity_type = 'episode' AND external_id = '1594417'
      )
    `)

    await expect(client.query(migration)).rejects.toThrow('TVMaze episode identity changed')
  })

  it('refuses a new source ID that would replace an existing episode coordinate', async () => {
    await client.query(`
      UPDATE catalog_external_links SET external_id = '9000099'
      WHERE provider = 'tvmaze' AND entity_type = 'episode' AND external_id = '1594417'
    `)

    await expect(client.query(migration)).rejects.toThrow('coordinate conflicts with an existing episode')
  })

  it('finds a reviewed series by its show link after editorial title and year changes', async () => {
    await client.query(`
      UPDATE catalog_items SET release_year = 1987
      WHERE id = '10000000-0000-7000-8000-000000000019'
    `)

    await client.query(`
      UPDATE catalog_item_titles SET title = 'Reviewed adaptation'
      WHERE catalog_item_id = '10000000-0000-7000-8000-000000000019' AND locale = 'en'
    `)

    await expect(client.query(migration)).resolves.toBeDefined()
  })
})
