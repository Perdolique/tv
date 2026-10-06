/* oxlint-disable eslint/max-lines -- Target choices share one disposable catalog fixture and preservation assertions. */
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { env } from 'node:process'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { afterAll, afterEach, assert, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertDisposableTestDatabase } from '../../../../testing/test-database.ts'
import { movieResponse, seriesResponse, showResponse } from '../../../../testing/import-fixtures.ts'
import { createImportPreview, openImportPreview, type ImportSession } from '../../service.ts'
import { selectImportTarget } from '../../target.ts'
import { applyImportPreview } from '../../apply-service.ts'
import { findImportOperationView } from '../../history.ts'
import { createImportPreviewView } from '../../review.ts'
import { sha256 } from '../../poster.ts'

const client = new Client({ connectionString: env.TEST_DATABASE_URL })
const database = createDatabase(client)
const now = new Date('2026-09-27T10:00:00Z')
const later = new Date('2026-09-27T11:00:00Z')

const movie = {
  type: 'movie',
  tmdbId: 603
} as const

const series = {
  type: 'series',
  tmdbId: 9_000_001,

  tvmaze: {
    status: 'selected',
    id: 9_000_002
  }
} as const

// oxlint-disable-next-line eslint/init-declarations -- Each case creates its own user and tracks catalog rows for cleanup.
let session: ImportSession

// oxlint-disable-next-line eslint/init-declarations -- Reset before every test.
let itemIds: string[]

function applyOptions() {
  return {
    namespace: 'test',
    now: () => later,

    hosted: {
      image: vi.fn<ImagesBinding['hosted']['image']>(),
      upload: vi.fn<ImagesBinding['hosted']['upload']>(),
      list: vi.fn<ImagesBinding['hosted']['list']>(),
      createDirectUpload: vi.fn<ImagesBinding['hosted']['createDirectUpload']>()
    }
  }
}

async function preview(type: 'movie' | 'series' = 'movie', conflict = false) {
  const tmdb = type === 'movie' ? movieResponse() : {
    ...seriesResponse(),
    id: series.tmdbId
  }

  const show = {
    ...showResponse(),
    id: series.tvmaze.id
  }

  if (conflict) { show.externals.imdb = 'tt9999999' }

  const selection = type === 'movie' ? movie : series

  const result = await createImportPreview(session, selection, {
    token: 'test',
    now: () => now,
    fetch: vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(tmdb)).mockResolvedValueOnce(Response.json(show)),

    images: {
      info: vi.fn<ImagesBinding['info']>(),
      input: vi.fn<ImagesBinding['input']>()
    }
  })

  assert(result.status !== 'source_failure')

  return result.preview
}

async function card(type: 'movie' | 'series' = 'movie') {
  const id = randomUUID()
  const title = type === 'movie' ? movieResponse().original_title : seriesResponse().original_name

  itemIds.push(id)
  await client.query('INSERT INTO catalog_items (id, type, release_year) VALUES ($1, $2, 1984)', [id, type])
  await client.query('INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original) VALUES ($1, \'ja\', $2, true)', [id, title])
  await client.query('INSERT INTO catalog_item_descriptions (catalog_item_id, locale, description) VALUES ($1, \'en-US\', \'\')', [id])

  return id
}

async function snapshot() {
  const result = await client.query<Record<string, unknown>>(`SELECT
    (SELECT jsonb_agg(t ORDER BY id) FROM catalog_items t) AS items,
    (SELECT jsonb_agg(t ORDER BY catalog_item_id, locale) FROM catalog_item_titles t) AS titles,
    (SELECT jsonb_agg(t ORDER BY catalog_item_id, locale) FROM catalog_item_descriptions t) AS descriptions,
    (SELECT jsonb_agg(t ORDER BY id) FROM catalog_episodes t) AS episodes,
    (SELECT jsonb_agg(t ORDER BY provider, entity_type, external_id) FROM catalog_external_links t) AS links,
    (SELECT jsonb_agg(t ORDER BY id) FROM catalog_import_fields t) AS fields,
    (SELECT jsonb_agg(t ORDER BY id) FROM catalog_releases t) AS releases,
    (SELECT jsonb_agg(t ORDER BY user_id, catalog_item_id) FROM catalog_item_follows t) AS follows,
    (SELECT jsonb_agg(t ORDER BY user_id, catalog_item_id) FROM catalog_viewings t) AS watches,
    (SELECT jsonb_agg(t ORDER BY user_id, catalog_episode_id) FROM catalog_episode_watches t) AS episode_watches`)

  const [row] = result.rows

  assert(row !== undefined)

  return row
}

describe('saved import target selection', () => {
  beforeAll(async () => {
    await client.connect()
    await assertDisposableTestDatabase(client)
  })

  beforeEach(async () => {
    const user = {
      id: randomUUID(),
      email: `${randomUUID()}@example.com`
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
    vi.restoreAllMocks()
    await client.query('DELETE FROM catalog_import_operations WHERE operator_id = $1', [session.user.id])
    await client.query('DELETE FROM catalog_items WHERE id = ANY($1::uuid[])', [itemIds])
    await client.query('DELETE FROM users WHERE id = $1', [session.user.id])
  })

  afterAll(async () => { await client.end() })

  it('requires a choice and updates the same card while preserving manual empty fields and user activity', async () => {
    const id = await card()
    const original = await preview()
    const before = await snapshot()

    expect(original.data.target).toStrictEqual({ kind: 'unresolved' })
    expect(original.status).toBe('blocked')

    await expect(applyImportPreview(session, original.id, applyOptions())).resolves.toMatchObject({
      status: 'blocked',
      issue: { code: 'preview_not_ready' }
    })

    const selected = await selectImportTarget(session, {
      previewId: original.id,

      input: {
        kind: 'existing',
        catalogItemId: id
      },

      now: later
    })

    expect(selected.status).toBe('ready')

    expect(selected.data.additions).toMatchObject({
      catalogItemId: id,
      createItem: false
    })

    expect(selected.data.changes).toContainEqual(expect.objectContaining({
      field: 'description',
      locale: 'en-US',
      action: 'preserve_manual',
      before: '',
      after: ''
    }))

    await expect(snapshot()).resolves.toStrictEqual(before)
    await client.query('INSERT INTO catalog_item_follows (user_id, catalog_item_id) VALUES ($1, $2)', [session.user.id, id])
    await client.query('INSERT INTO catalog_viewings (user_id, catalog_item_id) VALUES ($1, $2)', [session.user.id, id])

    const result = await applyImportPreview(session, selected.id, applyOptions())

    assert(result.status === 'succeeded')

    expect(result.result).toMatchObject({
      catalogItemId: id,
      createdItem: false,
      linkedSources: 1
    })

    await expect(applyImportPreview(session, selected.id, applyOptions())).resolves.toStrictEqual(result)

    await expect(findImportOperationView(session, result.operation.id, later)).resolves.toMatchObject({ result: {
      catalogItemId: id,
      createdItem: false
    } })

    const after = await snapshot()

    expect(after.items).toStrictEqual(before.items)

    expect(after.follows).toContainEqual(expect.objectContaining({
      user_id: session.user.id,
      catalog_item_id: id
    }))

    expect(after.watches).toContainEqual(expect.objectContaining({
      user_id: session.user.id,
      catalog_item_id: id
    }))

    expect(after.descriptions).toContainEqual(expect.objectContaining({
      catalog_item_id: id,
      locale: 'en-US',
      description: ''
    }))

    expect(after.titles).toContainEqual(expect.objectContaining({
      catalog_item_id: id,
      locale: 'en-US',
      title: 'English test title'
    }))

    expect(after.releases).toStrictEqual(before.releases)
  })

  it('copies saved source data and poster bytes without network calls or extending expiry across choices', async () => {
    const id = await card()
    const original = await preview()
    const bytes = Buffer.from('saved WebP bytes')

    const poster = {
      sourceUrl: 'https://image.tmdb.org/t/p/original/a.webp',
      sourceHash: 'source',
      sha256: sha256(bytes),
      contentType: 'image/webp',
      width: 1,
      height: 1,
      byteLength: bytes.byteLength
    }

    await client.query('UPDATE catalog_import_previews SET poster_bytes = $2, data = jsonb_set(data, \'{poster}\', $3) WHERE id = $1', [original.id, bytes, JSON.stringify(poster)])

    const parent = await openImportPreview(session, original.id, now)
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Source refetch is forbidden'))

    const chosen = await selectImportTarget(session, {
      previewId: original.id,

      input: {
        kind: 'existing',
        catalogItemId: id
      },

      now: later
    })

    const again = await selectImportTarget(session, {
      previewId: chosen.id,
      input: { kind: 'new' },
      now: new Date('2026-09-28T09:59:59Z')
    })

    expect(network).not.toHaveBeenCalled()
    expect(new Set([original.id, chosen.id, again.id]).size).toBe(3)
    expect(again.createdAt).not.toStrictEqual(original.createdAt)
    expect(again.expiresAt).toStrictEqual(original.expiresAt)
    expect(chosen.expiresAt).toStrictEqual(original.expiresAt)
    expect(again.posterBytes).toStrictEqual(bytes)
    expect(again.data.poster).toStrictEqual(poster)
    expect(again.data.card).toStrictEqual(original.data.card)
    expect(again.data.sourcesFetchedAt).toBe(original.data.sourcesFetchedAt)
    expect(again.data.candidates).toStrictEqual(original.data.candidates)
    await expect(openImportPreview(session, original.id, later)).resolves.toStrictEqual(parent)

    await expect(selectImportTarget(session, {
      previewId: again.id,
      input: { kind: 'new' },
      now: again.expiresAt
    })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('creates a separate same-name card only after the explicit new choice', async () => {
    const id = await card()
    const original = await preview()

    const selected = await selectImportTarget(session, {
      previewId: original.id,
      input: { kind: 'new' },
      now: later
    })

    const result = await applyImportPreview(session, selected.id, applyOptions())

    assert(result.status === 'succeeded')
    itemIds.push(result.result.catalogItemId)
    expect(result.result.createdItem).toBe(true)
    expect(result.result.catalogItemId).not.toBe(id)
  })

  it('does not create a duplicate when a same-name card appears after an empty-match preview', async () => {
    const original = await preview()

    expect(original.data.target).toStrictEqual({ kind: 'new' })
    expect(original.data.candidates).toStrictEqual([])
    await card()

    const before = await snapshot()
    const result = await applyImportPreview(session, original.id, applyOptions())

    expect(result).toMatchObject({
      status: 'failed',
      issue: { code: 'catalog_changed' }
    })

    await expect(snapshot()).resolves.toStrictEqual(before)
  })

  it('rejects target choices and apply when a new same-name card appears after review', async () => {
    const id = await card()
    const original = await preview()

    const selected = await selectImportTarget(session, {
      previewId: original.id,

      input: {
        kind: 'existing',
        catalogItemId: id
      },

      now: later
    })

    const newCandidateId = await card()
    const before = await snapshot()
    const savedPreviews = await client.query('SELECT id FROM catalog_import_previews WHERE operator_id = $1', [session.user.id])

    await expect(selectImportTarget(session, {
      previewId: original.id,
      input: { kind: 'new' },
      now: later
    })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      status: 409
    })

    const currentPreviews = await client.query('SELECT id FROM catalog_import_previews WHERE operator_id = $1', [session.user.id])

    expect(currentPreviews.rows).toStrictEqual(savedPreviews.rows)

    const log = vi.spyOn(console, 'error').mockImplementation(() => {
      // Keep the expected conflict out of the test console.
    })

    const result = await applyImportPreview(session, selected.id, applyOptions())

    expect(result).toMatchObject({
      status: 'failed',
      issue: { code: 'catalog_changed' }
    })

    expect(log).toHaveBeenCalledWith(expect.stringContaining('catalog import apply failed'))
    await expect(snapshot()).resolves.toStrictEqual(before)
    expect(newCandidateId).not.toBe(id)
  })

  it('rejects foreign previews, forged targets, extra request fields, and revoked access', async () => {
    const id = await card()
    const original = await preview()
    const otherId = randomUUID()

    await client.query('INSERT INTO users (id, email) VALUES ($1, $2)', [otherId, `${otherId}@example.com`])
    await client.query('INSERT INTO user_permissions (user_id, permission) VALUES ($1, \'catalog.manage\')', [otherId])

    try {
      const other = {
        database,

        user: {
          id: otherId,
          email: `${otherId}@example.com`
        }
      }

      await expect(selectImportTarget(other, {
        previewId: original.id,
        input: { kind: 'new' },
        now: later
      })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    } finally {
      await client.query('DELETE FROM users WHERE id = $1', [otherId])
    }

    for (const target of [{
      kind: 'existing',
      catalogItemId: randomUUID()
    }, {
      kind: 'existing',
      catalogItemId: 'bad'
    }, { kind: 'unresolved' }, {
      kind: 'new',
      operatorId: session.user.id
    }]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each forged body must reach the target boundary independently.
      await expect(selectImportTarget(session, {
        previewId: original.id,
        input: target,
        now: later
      })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    }

    await client.query('DELETE FROM user_permissions WHERE user_id = $1', [session.user.id])

    await expect(selectImportTarget(session, {
      previewId: original.id,

      input: {
        kind: 'existing',
        catalogItemId: id
      },

      now: later
    })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('rejects choices when source ownership changes and locks fresh exact matches', async () => {
    const id = await card()
    const second = await card()
    const original = await preview()

    await client.query('INSERT INTO catalog_external_links (provider, entity_type, external_id, catalog_item_id) VALUES (\'tmdb\', \'movie\', \'603\', $1)', [id])

    await expect(selectImportTarget(session, {
      previewId: original.id,

      input: {
        kind: 'existing',
        catalogItemId: second
      },

      now: later
    })).rejects.toMatchObject({ status: 409 })

    await expect(selectImportTarget(session, {
      previewId: original.id,
      input: { kind: 'new' },
      now: later
    })).rejects.toMatchObject({ status: 409 })

    const locked = await preview()

    expect(locked.data.target).toStrictEqual({
      kind: 'existing',
      catalogItemId: id
    })

    await expect(selectImportTarget(session, {
      previewId: locked.id,
      input: { kind: 'new' },
      now: later
    })).rejects.toMatchObject({ status: 409 })

    await expect(selectImportTarget(session, {
      previewId: locked.id,

      input: {
        kind: 'existing',
        catalogItemId: second
      },

      now: later
    })).rejects.toMatchObject({ status: 409 })
  })

  it.each([
    {
      conflict: 'type',
      code: 'title_type_conflict',
      sql: 'UPDATE catalog_items SET type = \'series\' WHERE id = $1'
    },
    {
      conflict: 'source',
      code: 'reviewed_mapping_conflict',
      sql: 'INSERT INTO catalog_external_links (provider, entity_type, external_id, catalog_item_id) VALUES (\'tmdb\', \'movie\', \'9999999\', $1)'
    }
  ])('blocks a $conflict conflict when the chosen card is reread', async ({ code, sql }) => {
    const id = await card()
    const original = await preview()

    await client.query(sql, [id])

    const selected = await selectImportTarget(session, {
      previewId: original.id,

      input: {
        kind: 'existing',
        catalogItemId: id
      },

      now: later
    })

    expect(selected.status).toBe('blocked')
    expect(selected.data.errors).toContainEqual(expect.objectContaining({ code }))
    expect(createImportPreviewView(selected).data.candidates).toStrictEqual(original.data.candidates)
    await expect(applyImportPreview(session, selected.id, applyOptions())).resolves.toMatchObject({ status: 'blocked' })
  })

  it('rejects a target choice when its saved candidate was deleted', async () => {
    const id = await card()
    const original = await preview()

    await client.query('DELETE FROM catalog_items WHERE id = $1', [id])

    await expect(selectImportTarget(session, {
      previewId: original.id,

      input: {
        kind: 'existing',
        catalogItemId: id
      },

      now: later
    })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      status: 409
    })
  })

  it.each([
    {
      change: 'title',
      sql: 'UPDATE catalog_item_titles SET title = \'Changed after review\' WHERE catalog_item_id = $1 AND $2::uuid IS NOT NULL'
    },
    {
      change: 'candidate',
      sql: 'UPDATE catalog_item_titles SET title = \'Changed after review\' WHERE catalog_item_id = $2 AND $1::uuid IS NOT NULL'
    },
    {
      change: 'delete',
      sql: 'DELETE FROM catalog_items WHERE id = $1 AND $2::uuid IS NOT NULL'
    },
    {
      change: 'source',
      sql: 'INSERT INTO catalog_external_links (provider, entity_type, external_id, catalog_item_id) SELECT \'tmdb\', \'movie\', \'603\', $2 WHERE $1::uuid IS NOT NULL'
    }
  ])('rejects $change changes after target review without substituting a target', async ({ sql }) => {
    const id = await card()
    const other = await card()
    const original = await preview()

    const selected = await selectImportTarget(session, {
      previewId: original.id,

      input: {
        kind: 'existing',
        catalogItemId: id
      },

      now: later
    })

    await client.query(sql, [id, other])

    const before = await snapshot()

    const log = vi.spyOn(console, 'error').mockImplementation(() => {
      // Keep the expected conflict out of the test console.
    })

    const result = await applyImportPreview(session, selected.id, applyOptions())

    expect(result).toMatchObject({
      status: 'failed',
      issue: { code: 'catalog_changed' }
    })

    expect(log).toHaveBeenCalledWith(expect.stringContaining('catalog import apply failed'))
    await expect(snapshot()).resolves.toStrictEqual(before)
  })

  it('keeps source conflicts blocking after target recalculation', async () => {
    const id = await card('series')
    const original = await preview('series', true)

    const selected = await selectImportTarget(session, {
      previewId: original.id,

      input: {
        kind: 'existing',
        catalogItemId: id
      },

      now: later
    })

    expect(selected.data.sourceErrors).toContainEqual(expect.objectContaining({ code: 'external_id_conflict' }))
    expect(selected.data.errors).toContainEqual(expect.objectContaining({ code: 'external_id_conflict' }))
    expect(selected.status).toBe('blocked')
  })

  it('keeps episode UUIDs, watches, and calendar entries and never merges episodes by coordinates', async () => {
    const id = await card('series')
    const episodeId = randomUUID()

    await client.query('INSERT INTO catalog_episodes (id, catalog_item_id, season_number, episode_number, source_title, air_date) VALUES ($1, $2, 1, 1, \'Manual pilot\', \'2026-09-28\')', [episodeId, id])
    await client.query('INSERT INTO catalog_episode_watches (user_id, catalog_episode_id) VALUES ($1, $2)', [session.user.id, episodeId])
    await client.query('INSERT INTO catalog_item_follows (user_id, catalog_item_id) VALUES ($1, $2)', [session.user.id, id])

    const original = await preview('series')

    const collision = await selectImportTarget(session, {
      previewId: original.id,

      input: {
        kind: 'existing',
        catalogItemId: id
      },

      now: later
    })

    expect(collision.data.errors).toContainEqual(expect.objectContaining({ code: 'episode_coordinates_conflict' }))
    await client.query('INSERT INTO catalog_external_links (provider, entity_type, external_id, catalog_episode_id) VALUES (\'tvmaze\', \'episode\', \'910001\', $1)', [episodeId])

    const selected = await selectImportTarget(session, {
      previewId: original.id,

      input: {
        kind: 'existing',
        catalogItemId: id
      },

      now: later
    })

    const before = await snapshot()
    const result = await applyImportPreview(session, selected.id, applyOptions())

    assert(result.status === 'succeeded')

    expect(result.result).toMatchObject({
      catalogItemId: id,
      createdItem: false,
      createdEpisodes: 2
    })

    const after = await snapshot()

    expect(after.episodes).toContainEqual(expect.objectContaining({
      id: episodeId,
      source_title: 'Manual pilot',
      air_date: '2026-09-28'
    }))

    expect(after.episode_watches).toStrictEqual(before.episode_watches)
    expect(after.follows).toStrictEqual(before.follows)
    expect(after.releases).toStrictEqual(before.releases)
  })
})
