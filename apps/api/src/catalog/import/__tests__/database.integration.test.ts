/* oxlint-disable eslint/max-lines -- Saved-preview scenarios share one disposable database and access fixture. */
import { randomUUID } from 'node:crypto'
import { env } from 'node:process'
import { createDatabase } from '@tv/database'
import type { ImportSelection } from '@tv/database/import-preview'
import { Client } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'
import { inspectCatalogState, readCatalogState } from '../catalog-state.ts'
import { deleteExpiredImportPreviews, PREVIEW_LIFETIME_MS } from '../repository.ts'
import { createImportPreviewView } from '../review.ts'

import {
  createImportPreview,
  openImportPreview,
  type ImportDependencies,
  type ImportPreviewResult,
  type ImportSession
} from '../service.ts'

import { movieResponse, seriesResponse, showResponse } from '../../../testing/import-fixtures.ts'

const client = new Client({ connectionString: env.TEST_DATABASE_URL })
const database = createDatabase(client)
const now = new Date('2026-09-24T10:00:00Z')

const movieSelection = {
  type: 'movie',
  tmdbId: 603
} as const

const seriesSelection = {
  type: 'series',
  tmdbId: 9_000_001,

  tvmaze: {
    status: 'selected',
    id: 9_000_002
  }
} as const

// oxlint-disable-next-line eslint/init-declarations -- Each test receives its own session in beforeEach.
let session: ImportSession

// oxlint-disable-next-line eslint/init-declarations -- Each test starts with an empty cleanup list in beforeEach.
let itemIds: string[]

function dependencies(tmdb: unknown = movieResponse(), tvmaze: unknown = showResponse()): ImportDependencies {
  return {
    token: 'secret-test-token',
    now: () => now,

    fetch: vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(tmdb))
      .mockResolvedValueOnce(Response.json(tvmaze)),

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

async function fingerprint(selection: ImportSelection): Promise<string> {
  return database.transaction(async (transaction) => {
    const state = await readCatalogState(transaction, selection, [])

    return inspectCatalogState(state, selection, []).fingerprint
  }, {
    isolationLevel: 'repeatable read',
    accessMode: 'read only'
  })
}

async function seedUserActivity(): Promise<void> {
  const itemId = await createItem('movie', ['tmdb', 'movie', '9000005'])

  await client.query('INSERT INTO catalog_item_follows (user_id, catalog_item_id) VALUES ($1, $2)', [session.user.id, itemId])
  await client.query('INSERT INTO catalog_movie_watches (user_id, catalog_item_id) VALUES ($1, $2)', [session.user.id, itemId])

  const watches = await client.query('INSERT INTO catalog_episode_watches (user_id, catalog_episode_id) SELECT $1, id FROM catalog_episodes ORDER BY id LIMIT 1 RETURNING catalog_episode_id', [session.user.id])

  expect(watches.rowCount).toBe(1)
}

async function catalogSnapshot() {
  const result = await client.query<Record<string, unknown>>(`
    SELECT
      (SELECT jsonb_agg(to_jsonb(item) ORDER BY id) FROM catalog_items AS item) AS items,
      (SELECT jsonb_agg(to_jsonb(title) ORDER BY catalog_item_id, locale) FROM catalog_item_titles AS title) AS titles,
      (SELECT jsonb_agg(to_jsonb(episode) ORDER BY id) FROM catalog_episodes AS episode) AS episodes,
      (SELECT jsonb_agg(to_jsonb(link) ORDER BY provider, entity_type, external_id) FROM catalog_external_links AS link) AS links,
      (SELECT jsonb_agg(to_jsonb(release) ORDER BY id) FROM catalog_releases AS release) AS releases,
      (SELECT jsonb_agg(to_jsonb(follow) ORDER BY user_id, catalog_item_id) FROM catalog_item_follows AS follow) AS follows,
      (SELECT jsonb_agg(to_jsonb(watch) ORDER BY user_id, catalog_item_id) FROM catalog_movie_watches AS watch) AS movies,
      (SELECT jsonb_agg(to_jsonb(watch) ORDER BY user_id, catalog_episode_id) FROM catalog_episode_watches AS watch) AS watches,
      (SELECT jsonb_agg(to_jsonb(account) ORDER BY id) FROM users AS account) AS users
  `)

  return result.rows
}

function assertSavedResult(result: ImportPreviewResult): asserts result is Exclude<ImportPreviewResult, { status: 'source_failure' }> {
  if (result.status === 'source_failure') {
    throw new Error('Expected a saved preview')
  }
}

function expectBlocked(result: ImportPreviewResult, code: string): void {
  assertSavedResult(result)
  expect(result.status).toBe('blocked')

  const codes = result.preview.data.errors.map(issue => issue.code)

  expect(codes).toContain(code)
}

function expectWarning(result: ImportPreviewResult, code: string): void {
  assertSavedResult(result)
  expect(result.status).toBe('ready')

  const codes = result.preview.data.warnings.map(issue => issue.code)

  expect(codes).toContain(code)
}

describe('saved catalog import previews', () => {
  beforeAll(async () => {
    await client.connect()
    await assertDisposableTestDatabase(client)
  })

  beforeEach(async () => {
    const user = {
      id: randomUUID(),
      email: 'preview-test@example.com'
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
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await client.end()
  })

  it('saves a normalized movie and exact operator without changing catalog or user records', async () => {
    await seedUserActivity()

    const before = await catalogSnapshot()
    const result = await createImportPreview(session, movieSelection, dependencies())

    expect(result.status).toBe('ready')
    assertSavedResult(result)
    expect(result.preview.operatorId).toBe(session.user.id)

    expect(result.preview.data.card).toMatchObject({
      identity: {
        provider: 'tmdb',
        entityType: 'movie',
        externalId: '603'
      },

      originalTitle: {
        value: 'Original test title',

        source: {
          field: 'original_title',
          locale: 'ja'
        }
      },

      releaseYear: { value: 2026 }
    })

    expect(result.preview.data.additions.createItem).toBe(true)
    expect(result.preview.data.warnings.map(issue => issue.code)).toContain('poster_missing')
    expect(result.preview.expiresAt.getTime() - result.preview.createdAt.getTime()).toBe(PREVIEW_LIFETIME_MS)
    await expect(openImportPreview(session, result.preview.id, now)).resolves.toStrictEqual(result.preview)
    await expect(catalogSnapshot()).resolves.toStrictEqual(before)
    expect(JSON.stringify(result.preview)).not.toContain('Fallback')
  })

  it('previews a series with future and unnamed episodes without creating releases', async () => {
    await seedUserActivity()

    const tmdb = {
      ...seriesResponse(),
      id: seriesSelection.tmdbId
    }

    const tvmaze = {
      ...showResponse(),
      id: seriesSelection.tvmaze.id
    }

    const before = await catalogSnapshot()
    const result = await createImportPreview(session, seriesSelection, dependencies(tmdb, tvmaze))

    expect(result).toMatchObject({
      status: 'ready',
      preview: { data: { evidence: { matchingIds: ['imdb', 'thetvdb'] } } }
    })

    assertSavedResult(result)
    expect(result.preview.data.episodes).toHaveLength(3)
    expect(result.preview.data.additions.episodeExternalIds).toStrictEqual(['910001', '910002', '910004'])
    await expect(catalogSnapshot()).resolves.toStrictEqual(before)
  })

  it('requires explicit absence evidence and saves it with a warning', async () => {
    const input = {
      type: 'series',
      tmdbId: 9_000_001,

      tvmaze: {
        status: 'verified_absent',
        reason: 'Checked both external IDs and the source website.'
      }
    }

    const tmdb = {
      ...seriesResponse(),
      id: 9_000_001
    }

    const result = await createImportPreview(session, input, dependencies(tmdb))

    expectWarning(result, 'show_verified_absent')

    await expect(createImportPreview(session, {
      type: 'series',
      tmdbId: 9_000_001
    }, dependencies())).rejects.toMatchObject({ code: 'INVALID_REQUEST' })

    await expect(createImportPreview(session, {
      ...input,

      tvmaze: {
        status: 'verified_absent',
        reason: ' '
      }
    }, dependencies())).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('warns on a verified empty episode list and blocks conflicting provider IDs', async () => {
    const tmdb = {
      ...seriesResponse(),
      id: seriesSelection.tmdbId
    }

    const emptyShow = {
      ...showResponse(),
      id: seriesSelection.tvmaze.id,
      _embedded: { episodes: [] }
    }

    const empty = await createImportPreview(session, seriesSelection, dependencies(tmdb, emptyShow))

    const conflictShow = {
      ...emptyShow,

      externals: {
        imdb: 'tt7654321',
        thetvdb: 123
      }
    }

    const conflict = await createImportPreview(session, seriesSelection, dependencies(tmdb, conflictShow))

    expect(empty.status).toBe('ready')
    expectWarning(empty, 'episodes_empty')
    expectBlocked(conflict, 'external_id_conflict')
  })

  it('blocks an unnumbered episode instead of saving a ready Edgerunners preview', async () => {
    const show = {
      ...showResponse(),

      _embedded: { episodes: [{
        id: 910_001,
        type: 'regular',
        season: null,
        number: 1,
        name: null,
        airdate: null
      }] }
    }

    const result = await createImportPreview(session, {
      type: 'series',
      tmdbId: 105_248,

      tvmaze: {
        status: 'selected',
        id: 48_945
      }
    }, dependencies(seriesResponse(), show))

    expectBlocked(result, 'episode_coordinates_invalid')
    assertSavedResult(result)
    expect(result.preview.data.warnings.map(issue => issue.code)).not.toContain('episodes_empty')
  })

  it('fingerprints only affected catalog state, including absent links and editorial changes', async () => {
    const absent = await fingerprint(movieSelection)
    const itemId = await createItem('movie', ['tmdb', 'movie', '603'])
    const linked = await fingerprint(movieSelection)

    expect(linked).not.toBe(absent)

    const linkedPreview = await createImportPreview(session, movieSelection, dependencies())

    assertSavedResult(linkedPreview)
    expect(linkedPreview.preview.catalogFingerprint).toBe(linked)
    await client.query('INSERT INTO catalog_item_follows (user_id, catalog_item_id) VALUES ($1, $2)', [session.user.id, itemId])
    await client.query('INSERT INTO catalog_movie_watches (user_id, catalog_item_id) VALUES ($1, $2)', [session.user.id, itemId])
    await expect(fingerprint(movieSelection)).resolves.toBe(linked)
    await createItem('movie', ['tmdb', 'movie', '9000005'])
    await expect(fingerprint(movieSelection)).resolves.toBe(linked)
    await client.query('INSERT INTO catalog_item_titles (catalog_item_id, locale, title) VALUES ($1, \'en\', \'Manual\')', [itemId])
    await client.query('INSERT INTO catalog_item_descriptions (catalog_item_id, locale, description) VALUES ($1, \'en\', \'\')', [itemId])

    const edited = await fingerprint(movieSelection)
    const editedPreview = await createImportPreview(session, movieSelection, dependencies())

    expect(edited).not.toBe(linked)
    assertSavedResult(editedPreview)
    expect(editedPreview.preview.catalogFingerprint).toBe(edited)
  })

  it('marks only source-linked catalog cards as exact and same-name cards as suggestions', async () => {
    const exactId = await createItem('movie', ['tmdb', 'movie', '603'])
    const possibleId = await createItem('movie', ['tmdb', 'movie', '9000006'])

    await client.query('INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original) VALUES ($1, \'en\', \'Existing exact\', true), ($2, \'en\', \'Original test title\', true)', [exactId, possibleId])

    const result = await createImportPreview(session, movieSelection, dependencies())

    assertSavedResult(result)

    const review = await createImportPreviewView(database, result.preview)

    expect(review.matches).toStrictEqual([
      expect.objectContaining({
        id: exactId,
        kind: 'exact_source'
      }),
      expect.objectContaining({
        id: possibleId,
        kind: 'possible_title'
      })
    ])

    expect(JSON.stringify(review)).not.toContain('posterBytes')
  })

  it('suggests an exact localized title match while keeping the English display title', async () => {
    // Arrange
    const possibleId = await createItem('movie', ['tmdb', 'movie', '9000006'])
    const partialId = await createItem('movie', ['tmdb', 'movie', '9000007'])

    await client.query(`
      INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original)
      VALUES ($1, 'en', 'Solaris', true), ($1, 'ru', 'Солярис', false),
        ($2, 'en', 'Solaris sequel', true), ($2, 'ru', 'Солярис 2', false)
    `, [possibleId, partialId])

    const tmdb = {
      ...movieResponse(),
      original_title: 'Солярис',
      original_language: 'ru'
    }

    const options = dependencies(tmdb)
    const result = await createImportPreview(session, movieSelection, options)

    assertSavedResult(result)

    // Act
    const review = await createImportPreviewView(database, result.preview)

    // Assert
    expect(review.matches).toStrictEqual([{
      id: possibleId,
      title: 'Solaris',
      year: null,
      type: 'movie',
      kind: 'possible_title'
    }])

    expect(review.data.additions.createItem).toBe(true)
  })

  it('rejects forged operators and revoked access before contacting sources', async () => {
    const options = dependencies()

    await expect(createImportPreview(session, {
      ...movieSelection,
      operatorId: randomUUID()
    }, options)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })

    await client.query('DELETE FROM user_permissions WHERE user_id = $1', [session.user.id])
    await expect(createImportPreview(session, movieSelection, options)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(options.fetch).not.toHaveBeenCalled()
  })

  it('expires at exactly 24 hours and cleanup leaves valid previews alone', async () => {
    const result = await createImportPreview(session, movieSelection, dependencies())

    assertSavedResult(result)

    const lastInstant = new Date(result.preview.expiresAt.getTime() - 1)
    const boundary = result.preview.expiresAt

    await expect(openImportPreview(session, result.preview.id, lastInstant)).resolves.not.toBeNull()
    await expect(openImportPreview(session, result.preview.id, boundary)).resolves.toBeNull()
    await expect(deleteExpiredImportPreviews(database, lastInstant)).resolves.toBe(0)
    await expect(deleteExpiredImportPreviews(database, boundary)).resolves.toBe(1)
  })

  it('stores permanent failures but leaves transient failures out of preview storage and keeps diagnostics', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {
      // Keep expected source failures out of the test console.
    })

    const options = dependencies()

    vi.spyOn(options, 'fetch').mockReset().mockResolvedValue(new Response('secret technical response', { status: 404 }))

    const missing = await createImportPreview(session, movieSelection, options)

    expect(missing).toMatchObject({
      status: 'blocked',

      preview: { data: { errors: [{
        code: 'source_not_found',
        message: 'The selected source record was not found.'
      }] } }
    })

    vi.spyOn(options, 'fetch').mockResolvedValue(new Response('', {
      status: 429,
      headers: { 'Retry-After': '60' }
    }))

    const unavailable = await createImportPreview(session, movieSelection, options)
    const rows = await client.query('SELECT count(*)::integer AS count FROM catalog_import_previews WHERE operator_id = $1', [session.user.id])

    expect(unavailable).toStrictEqual({
      status: 'source_failure',

      issue: {
        code: 'source_unavailable',
        message: 'The source is temporarily unavailable. Try again later.'
      },

      retryAfterSeconds: 60
    })

    expect(rows.rows).toStrictEqual([{ count: 1 }])
    expect(JSON.stringify(log.mock.calls)).toContain('HTTP 404')
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-test-token')
    expect(JSON.stringify(missing)).not.toContain('secret technical response')
  })

  it('does not save a preview when Images is temporarily unavailable', async () => {
    const tmdb = {
      ...movieResponse(),
      poster_path: '/poster.png'
    }

    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(tmdb))
      .mockResolvedValueOnce(new Response('poster bytes'))

    const transform = vi.fn<ImageTransformer['transform']>()

    const transformer: ImageTransformer = {
      transform,
      draw: vi.fn<ImageTransformer['draw']>(),

      output: vi.fn<ImageTransformer['output']>().mockResolvedValue({
        response: () => new Response('Images unavailable', { status: 503 }),
        contentType: () => 'image/webp',
        image: vi.fn<ImageTransformationResult['image']>()
      })
    }

    transform.mockReturnValue(transformer)

    const images = {
      info: vi.fn<ImagesBinding['info']>().mockResolvedValue({
        format: 'image/png',
        fileSize: 12,
        width: 2,
        height: 3
      }),

      input: vi.fn<ImagesBinding['input']>().mockReturnValue(transformer)
    }

    const log = vi.spyOn(console, 'error').mockImplementation(() => {
      // Keep the expected failure out of the test console.
    })

    const result = await createImportPreview(session, movieSelection, {
      token: 'test',
      images,
      fetch: fetcher
    })

    const rows = await client.query('SELECT id FROM catalog_import_previews WHERE operator_id = $1', [session.user.id])

    expect(result).toStrictEqual({
      status: 'source_failure',

      issue: {
        code: 'source_unavailable',
        message: 'The source is temporarily unavailable. Try again later.'
      },

      retryAfterSeconds: null
    })

    expect(rows.rows).toStrictEqual([])
    expect(JSON.stringify(log.mock.calls)).toContain('HTTP 503')
  })
})
