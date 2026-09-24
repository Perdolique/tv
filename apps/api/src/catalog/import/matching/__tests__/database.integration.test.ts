import { randomUUID } from 'node:crypto'
import { env } from 'node:process'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertDisposableTestDatabase } from '../../../../testing/test-database.ts'
import { seriesResponse, showResponse } from '../../../../testing/import-fixtures.ts'
import { createImportPreview, type ImportPreviewResult, type ImportSession } from '../../service.ts'

const client = new Client({ connectionString: env.TEST_DATABASE_URL })
const database = createDatabase(client)

const seriesSelection = {
  type: 'series',
  tmdbId: 9_000_001,

  tvmaze: {
    status: 'selected',
    id: 9_000_002
  }
} as const

// oxlint-disable-next-line eslint/init-declarations -- Initialized for each test in beforeEach.
let session: ImportSession

// oxlint-disable-next-line eslint/init-declarations -- Initialized for each test in beforeEach.
let itemIds: string[]

function dependencies(tmdb: unknown, tvmaze: unknown = showResponse()) {
  return {
    token: 'test',
    fetch: vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(tmdb)).mockResolvedValueOnce(Response.json(tvmaze)),

    images: {
      info: vi.fn<ImagesBinding['info']>(),
      input: vi.fn<ImagesBinding['input']>()
    }
  }
}

async function createItem(type: 'movie' | 'series', identity: [string, string, string]): Promise<string> {
  const id = randomUUID()
  const [provider, entityType, externalId] = identity

  itemIds.push(id)
  await client.query('INSERT INTO catalog_items (id, type) VALUES ($1, $2)', [id, type])
  await client.query('INSERT INTO catalog_external_links (provider, entity_type, external_id, catalog_item_id) VALUES ($1, $2, $3, $4)', [provider, entityType, externalId, id])

  return id
}

async function catalogSnapshot() {
  const episodes = await client.query('SELECT * FROM catalog_episodes ORDER BY id')
  const links = await client.query('SELECT * FROM catalog_external_links ORDER BY provider, entity_type, external_id')

  return {
    episodes: episodes.rows,
    links: links.rows
  }
}

function expectBlocked(result: ImportPreviewResult, code: string): void {
  if (result.status === 'source_failure') {
    throw new Error('Expected a saved preview')
  }

  expect(result.status).toBe('blocked')

  const codes = result.preview.data.errors.map(issue => issue.code)

  expect(codes).toContain(code)
}

describe('catalog import identity conflicts', () => {
  beforeAll(async () => {
    await client.connect()
    await assertDisposableTestDatabase(client)
  })

  beforeEach(async () => {
    const user = {
      id: randomUUID(),
      email: 'preview-match@example.com'
    }

    session = {
      database,
      user
    }
    itemIds = []

    await client.query('INSERT INTO users (id, email) VALUES ($1, $2)', [user.id, user.email])
    await client.query('INSERT INTO user_permissions (user_id, permission) VALUES ($1, \'catalog.manage\')', [user.id])
  })

  afterEach(async () => {
    await client.query('DELETE FROM catalog_items WHERE id = ANY($1::uuid[])', [itemIds])
    await client.query('DELETE FROM users WHERE id = $1', [session.user.id])
  })

  afterAll(async () => {
    await client.end()
  })

  it('blocks different existing cards and preserves reviewed source mappings', async () => {
    await createItem('series', ['tmdb', 'tv', String(seriesSelection.tmdbId)])
    await createItem('series', ['tvmaze', 'show', String(seriesSelection.tvmaze.id)])

    const before = await catalogSnapshot()

    const tmdb = {
      ...seriesResponse(),
      id: seriesSelection.tmdbId
    }

    const tvmaze = {
      ...showResponse(),
      id: seriesSelection.tvmaze.id
    }

    const result = await createImportPreview(session, seriesSelection, dependencies(tmdb, tvmaze))

    expect(result.status).toBe('blocked')
    expectBlocked(result, 'title_identity_conflict')
    await expect(catalogSnapshot()).resolves.toStrictEqual(before)
  })

  it('does not replace a reviewed TVMaze mapping with a new ID or an absence claim', async () => {
    const id = await createItem('series', ['tmdb', 'tv', String(seriesSelection.tmdbId)])

    await client.query('INSERT INTO catalog_external_links (provider, entity_type, external_id, catalog_item_id) VALUES (\'tvmaze\', \'show\', \'9000003\', $1)', [id])

    const before = await catalogSnapshot()

    const tmdb = {
      ...seriesResponse(),
      id: seriesSelection.tmdbId
    }

    const tvmaze = {
      ...showResponse(),
      id: seriesSelection.tvmaze.id
    }

    const different = await createImportPreview(session, seriesSelection, dependencies(tmdb, tvmaze))

    const absent = await createImportPreview(session, {
      type: 'series',
      tmdbId: seriesSelection.tmdbId,

      tvmaze: {
        status: 'verified_absent',
        reason: 'Checked'
      }
    }, dependencies(tmdb))

    expect([different.status, absent.status]).toStrictEqual(['blocked', 'blocked'])

    for (const result of [different, absent]) {
      expectBlocked(result, 'reviewed_mapping_conflict')
    }

    await expect(catalogSnapshot()).resolves.toStrictEqual(before)
  })

  it('blocks episode IDs assigned to another card and does not merge by coordinates', async () => {
    const ownId = await createItem('series', ['tmdb', 'tv', String(seriesSelection.tmdbId)])
    const otherId = await createItem('series', ['tmdb', 'tv', '9000004'])
    const episodeId = randomUUID()

    await client.query('INSERT INTO catalog_episodes (id, catalog_item_id, season_number, episode_number) VALUES ($1, $2, 1, 1)', [episodeId, otherId])
    await client.query('INSERT INTO catalog_external_links (provider, entity_type, external_id, catalog_episode_id) VALUES (\'tvmaze\', \'episode\', \'910001\', $1)', [episodeId])
    await client.query('INSERT INTO catalog_episodes (catalog_item_id, season_number, episode_number) VALUES ($1, 1, 2)', [ownId])

    const before = await catalogSnapshot()

    const tmdb = {
      ...seriesResponse(),
      id: seriesSelection.tmdbId
    }

    const tvmaze = {
      ...showResponse(),
      id: seriesSelection.tvmaze.id
    }

    const result = await createImportPreview(session, seriesSelection, dependencies(tmdb, tvmaze))

    expect(result.status).toBe('blocked')
    expectBlocked(result, 'episode_title_conflict')
    expectBlocked(result, 'episode_coordinates_conflict')
    await expect(catalogSnapshot()).resolves.toStrictEqual(before)
  })

})
