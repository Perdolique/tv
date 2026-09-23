import { readFile } from 'node:fs/promises'
import { env } from 'node:process'
import { URL } from 'node:url'
import { Client } from 'pg'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { catalogEpisodeSources } from '../../../../scripts/catalog-episode-sources.ts'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'

const databaseUrl = env.TEST_DATABASE_URL

if (databaseUrl === undefined || databaseUrl === '') {
  throw new Error('TEST_DATABASE_URL is required for database integration tests')
}

const client = new Client({ connectionString: databaseUrl })
const migrationUrl = new URL('../../../../../../packages/database/migrations/20260923170649_conscious_captain_britain/migration.sql', import.meta.url)
const migration = await readFile(migrationUrl, 'utf8')

await client.connect()
await assertDisposableTestDatabase(client)

async function expectRejected(query: string, code: string): Promise<void> {
  await client.query('SAVEPOINT rejected_change')
  await expect(client.query(query)).rejects.toMatchObject({ code })
  await client.query('ROLLBACK TO SAVEPOINT rejected_change')
  await client.query('RELEASE SAVEPOINT rejected_change')
}

describe('catalog external link migration', () => {
  beforeEach(async () => {
    await client.query('BEGIN')
    await client.query('CREATE SCHEMA tv_issue61_fixture')
    await client.query('SET LOCAL search_path = tv_issue61_fixture, public')

    await client.query(`
      CREATE TABLE catalog_items (
        id uuid PRIMARY KEY,
        type public.catalog_item_type NOT NULL,
        release_year integer
      );
      CREATE TABLE catalog_item_titles (
        catalog_item_id uuid NOT NULL REFERENCES catalog_items (id),
        locale text NOT NULL,
        title text NOT NULL
      );
      CREATE TABLE catalog_episodes (
        id uuid PRIMARY KEY,
        catalog_item_id uuid NOT NULL REFERENCES catalog_items (id),
        season_number integer NOT NULL,
        episode_number integer NOT NULL,
        source_title text,
        air_date date,
        tvmaze_episode_id integer NOT NULL,
        CONSTRAINT catalog_episodes_tvmaze_episode_id_positive CHECK (tvmaze_episode_id > 0)
      );
      CREATE UNIQUE INDEX catalog_episodes_tvmaze_episode_id_unique
        ON catalog_episodes (tvmaze_episode_id);
      CREATE TABLE catalog_episode_watches (user_id uuid, catalog_episode_id uuid REFERENCES catalog_episodes (id));
      CREATE TABLE catalog_item_follows (user_id uuid, catalog_item_id uuid REFERENCES catalog_items (id));
      INSERT INTO catalog_items SELECT id, type, release_year FROM public.catalog_items;
      INSERT INTO catalog_item_titles
        SELECT catalog_item_id, locale, title FROM public.catalog_item_titles;
      INSERT INTO catalog_episodes
        SELECT episode.id, episode.catalog_item_id, episode.season_number,
          episode.episode_number, episode.source_title, episode.air_date,
          link.external_id::integer
        FROM public.catalog_episodes AS episode
        JOIN public.catalog_external_links AS link
          ON link.catalog_episode_id = episode.id
            AND link.provider = 'tvmaze' AND link.entity_type = 'episode';
      INSERT INTO catalog_episode_watches VALUES
        ('71000000-0000-7000-8000-000000000001', '30000000-0000-7000-8000-000000000001');
      INSERT INTO catalog_item_follows
        SELECT '71000000-0000-7000-8000-000000000001', item.id
        FROM catalog_items AS item
        JOIN catalog_item_titles AS title ON title.catalog_item_id = item.id
        WHERE title.locale = 'en' AND title.title = 'Chernobyl';
    `)
  })

  afterEach(async () => {
    await client.query('ROLLBACK')
  })

  afterAll(async () => {
    await client.end()
  })

  it('moves all old episode IDs and reviewed title matches without changing internal IDs or user data', async () => {
    const before = await client.query(`
      SELECT id, tvmaze_episode_id::text AS external_id
      FROM catalog_episodes ORDER BY id
    `)

    const watches = await client.query('SELECT * FROM catalog_episode_watches')
    const follows = await client.query('SELECT * FROM catalog_item_follows')

    await client.query(migration)

    const after = await client.query(`
      SELECT episode.id, link.external_id
      FROM catalog_episodes AS episode
      JOIN catalog_external_links AS link ON link.catalog_episode_id = episode.id
        AND link.provider = 'tvmaze' AND link.entity_type = 'episode'
      ORDER BY episode.id
    `)

    const counts = await client.query(`
      SELECT provider, entity_type, count(*)::integer AS count
      FROM catalog_external_links GROUP BY provider, entity_type
      ORDER BY provider, entity_type
    `)

    const shows = await client.query(`
      SELECT link.external_id::integer AS "showId", title.title,
        item.release_year AS year
      FROM catalog_external_links AS link
      JOIN catalog_items AS item ON item.id = link.catalog_item_id
      JOIN catalog_item_titles AS title
        ON title.catalog_item_id = item.id AND title.locale = 'en'
      WHERE link.provider = 'tvmaze' AND link.entity_type = 'show'
      ORDER BY link.external_id::integer
    `)

    const cards = await client.query(`
      SELECT link.entity_type, link.external_id, title.title
      FROM catalog_external_links AS link
      JOIN catalog_item_titles AS title
        ON title.catalog_item_id = link.catalog_item_id AND title.locale = 'en'
      WHERE link.provider = 'tmdb'
      ORDER BY link.entity_type, link.external_id::integer
    `)

    const expectedShows = catalogEpisodeSources
      .map((source) => {
        return {
          showId: source.showId,
          title: source.title,
          year: source.year
        }
      })
      .toSorted((first, second) => first.showId - second.showId)

    expect(before.rows.length).toBeGreaterThan(0)
    expect(after.rows).toStrictEqual(before.rows)
    expect(shows.rows).toStrictEqual(expectedShows)

    expect(cards.rows).toStrictEqual([
      {
        entity_type: 'movie',
        external_id: '345571',
        title: 'Bella Mia'
      },
      {
        entity_type: 'movie',
        external_id: '438631',
        title: 'Dune'
      },
      {
        entity_type: 'tv',
        external_id: '70593',
        title: 'Kingdom'
      },
      {
        entity_type: 'tv',
        external_id: '105248',
        title: 'Cyberpunk: Edgerunners'
      },
      {
        entity_type: 'tv',
        external_id: '326788',
        title: 'Cyberpunk: Edgerunners 2'
      }
    ])

    expect(counts.rows).toStrictEqual([
      {
        provider: 'tmdb',
        entity_type: 'movie',
        count: 2
      },
      {
        provider: 'tmdb',
        entity_type: 'tv',
        count: 3
      },
      {
        provider: 'tvmaze',
        entity_type: 'episode',
        count: before.rows.length
      },
      {
        provider: 'tvmaze',
        entity_type: 'show',
        count: 15
      }
    ])

    const oldColumn = await client.query(`
      SELECT count(*)::integer AS count FROM information_schema.columns
      WHERE table_schema = 'tv_issue61_fixture'
        AND table_name = 'catalog_episodes'
        AND column_name = 'tvmaze_episode_id'
    `)

    const watchesAfter = await client.query('SELECT * FROM catalog_episode_watches')
    const followsAfter = await client.query('SELECT * FROM catalog_item_follows')

    expect(oldColumn.rows).toStrictEqual([{ count: 0 }])
    expect(watchesAfter.rows).toStrictEqual(watches.rows)
    expect(followsAfter.rows).toStrictEqual(follows.rows)
  })

  it('rejects ambiguous matches and rolls the migration back without losing the old identity', async () => {
    await client.query(`
      INSERT INTO catalog_items VALUES ('71000000-0000-7000-8000-000000000002', 'movie', 2021);
      INSERT INTO catalog_item_titles VALUES
        ('71000000-0000-7000-8000-000000000002', 'en', 'Dune');
    `)

    await client.query('SAVEPOINT before_migration')
    await expect(client.query(migration)).rejects.toThrow('reviewed external source match is missing or ambiguous')
    await client.query('ROLLBACK TO SAVEPOINT before_migration')

    const oldEpisode = await client.query(`
      SELECT tvmaze_episode_id FROM catalog_episodes
      WHERE id = '30000000-0000-7000-8000-000000000001'
    `)

    const watchesAfter = await client.query('SELECT * FROM catalog_episode_watches')
    const linksAfter = await client.query('SELECT to_regclass(\'tv_issue61_fixture.catalog_external_links\') AS links')

    expect(oldEpisode.rows).toStrictEqual([{ tvmaze_episode_id: 1_594_417 }])
    expect(watchesAfter.rows).toHaveLength(1)
    expect(linksAfter.rows).toStrictEqual([{ links: null }])
  })

  it('rejects a missing reviewed match without losing the old identity', async () => {
    await client.query(`
      UPDATE catalog_item_titles SET title = 'Dune (unmatched)'
      WHERE locale = 'en' AND title = 'Dune'
    `)

    await client.query('SAVEPOINT before_migration')
    await expect(client.query(migration)).rejects.toThrow('reviewed external source match is missing or ambiguous')
    await client.query('ROLLBACK TO SAVEPOINT before_migration')

    const oldEpisode = await client.query(`
      SELECT tvmaze_episode_id FROM catalog_episodes
      WHERE id = '30000000-0000-7000-8000-000000000001'
    `)

    const linksAfter = await client.query(`
      SELECT to_regclass('tv_issue61_fixture.catalog_external_links') AS links
    `)

    expect(oldEpisode.rows).toStrictEqual([{ tvmaze_episode_id: 1_594_417 }])
    expect(linksAfter.rows).toStrictEqual([{ links: null }])
  })

  it('enforces source and target uniqueness, media types, and leaves unreviewed cards unlinked', async () => {
    await client.query(migration)

    const kingdom = await client.query(`
      SELECT provider, entity_type, external_id
      FROM catalog_external_links AS link
      JOIN catalog_item_titles AS title ON title.catalog_item_id = link.catalog_item_id
      WHERE title.locale = 'en' AND title.title = 'Kingdom'
      ORDER BY provider
    `)

    expect(kingdom.rows).toStrictEqual([
      {
        provider: 'tmdb',
        entity_type: 'tv',
        external_id: '70593'
      },
      {
        provider: 'tvmaze',
        entity_type: 'show',
        external_id: '26153'
      }
    ])

    await expectRejected(`
      INSERT INTO catalog_external_links (provider, entity_type, external_id, catalog_item_id)
      SELECT 'tmdb', 'movie', '438631', catalog_item_id
      FROM catalog_item_titles WHERE locale = 'en' AND title = 'Dead Man'
    `, '23505')

    await expectRejected(`
      INSERT INTO catalog_external_links (provider, entity_type, external_id, catalog_item_id)
      SELECT 'tvmaze', 'show', '900001', catalog_item_id
      FROM catalog_item_titles WHERE locale = 'en' AND title = 'Dune'
    `, '23514')

    await expectRejected(`
      INSERT INTO catalog_external_links (provider, entity_type, external_id, catalog_item_id)
      SELECT 'other', 'show', '900004', catalog_item_id
      FROM catalog_item_titles WHERE locale = 'en' AND title = 'Kingdom'
    `, '23514')

    await expectRejected(`
      INSERT INTO catalog_external_links (provider, entity_type, external_id, catalog_item_id)
      SELECT 'tmdb', 'movie', '900002', catalog_item_id
      FROM catalog_item_titles WHERE locale = 'en' AND title = 'Dune'
    `, '23505')

    await expectRejected(`
      INSERT INTO catalog_external_links (provider, entity_type, external_id, catalog_item_id)
      SELECT 'tmdb', 'movie', '00', catalog_item_id
      FROM catalog_item_titles WHERE locale = 'en' AND title = 'Dead Man'
    `, '23514')

    await expectRejected(`
      INSERT INTO catalog_external_links (provider, entity_type, external_id)
      VALUES ('tmdb', 'movie', '900003')
    `, '23514')

    await expectRejected(`
      INSERT INTO catalog_external_links (provider, entity_type, external_id, catalog_episode_id)
      VALUES ('tvmaze', 'episode', '900005', '30000000-0000-7000-8000-000000000001')
    `, '23505')

    await expectRejected(`
      UPDATE catalog_items SET type = 'series'
      WHERE id = (
        SELECT catalog_item_id FROM catalog_item_titles
        WHERE locale = 'en' AND title = 'Dune'
      )
    `, '23514')

    const manual = await client.query(`
      SELECT count(link.external_id)::integer AS links
      FROM catalog_item_titles AS title
      LEFT JOIN catalog_external_links AS link ON link.catalog_item_id = title.catalog_item_id
      WHERE title.locale = 'en' AND title.title = 'Dead Man'
    `)

    expect(manual.rows).toStrictEqual([{ links: 0 }])
  })
})
