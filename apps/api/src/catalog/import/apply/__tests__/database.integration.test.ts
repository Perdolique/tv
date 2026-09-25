/* oxlint-disable eslint/max-lines -- Application scenarios share a disposable database and one operator fixture. */
import { randomUUID } from 'node:crypto'
import { env } from 'node:process'
import { createDatabase } from '@tv/database'
import type { ImportSelection } from '@tv/database/import-preview'
import { Client } from 'pg'
import { afterAll, afterEach, assert, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertDisposableTestDatabase } from '../../../../testing/test-database.ts'
import { movieResponse, seriesResponse, showResponse } from '../../../../testing/import-fixtures.ts'
import { applyImportPreview, listImportOperations, type ApplyImportOptions } from '../../apply-service.ts'
import { createImportPreview, type ImportSession } from '../../service.ts'

const firstClient = new Client({ connectionString: env.TEST_DATABASE_URL })
const secondClient = new Client({ connectionString: env.TEST_DATABASE_URL })
const firstDatabase = createDatabase(firstClient)
const secondDatabase = createDatabase(secondClient)
const start = new Date('2026-09-25T10:00:00Z')

const movie: ImportSelection = {
  type: 'movie',
  tmdbId: 603
}

const series: ImportSelection = {
  type: 'series',
  tmdbId: 9_000_001,

  tvmaze: {
    status: 'selected',
    id: 9_000_002
  }
}

// oxlint-disable-next-line eslint/init-declarations -- Assigned by the fixture before every test.
let session: ImportSession

// oxlint-disable-next-line eslint/init-declarations -- Assigned by the fixture before every test.
let otherSession: ImportSession

// oxlint-disable-next-line eslint/init-declarations -- Assigned by the fixture before every test.
let itemIds: string[]

function previewOptions(tmdb: unknown = movieResponse(), tvmaze: unknown = showResponse()) {
  return {
    token: 'test-token',
    now: () => start,

    fetch: vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(tmdb))
      .mockResolvedValueOnce(Response.json(tvmaze)),

    images: {
      info: vi.fn<ImagesBinding['info']>(),
      input: vi.fn<ImagesBinding['input']>()
    }
  }
}

function applyOptions(now = start): ApplyImportOptions {
  return {
    hosted: {
      image: vi.fn<ImagesBinding['hosted']['image']>(),
      upload: vi.fn<ImagesBinding['hosted']['upload']>(),
      list: vi.fn<ImagesBinding['hosted']['list']>(),
      createDirectUpload: vi.fn<ImagesBinding['hosted']['createDirectUpload']>()
    },

    namespace: 'test',
    now: () => now
  }
}

async function savedPreview(selection: ImportSelection = movie, tmdb: unknown = movieResponse(), tvmaze: unknown = showResponse()) {
  const created = await createImportPreview(session, selection, previewOptions(tmdb, tvmaze))

  if (created.status !== 'ready') {
    throw new Error(`Expected a ready preview, received ${created.status}`)
  }

  return created.preview
}

async function applySuccess(previewId: string, options = applyOptions()) {
  const applied = await applyImportPreview(session, previewId, options)

  if (applied.status !== 'succeeded') {
    throw new Error(`Expected a successful application, received ${applied.status}`)
  }

  itemIds.push(applied.result.catalogItemId)

  return applied
}

async function catalogRows() {
  const rows = await firstClient.query<Record<string, unknown>>(`
    SELECT
      (SELECT jsonb_agg(to_jsonb(item) ORDER BY id) FROM catalog_items item) AS items,
      (SELECT jsonb_agg(to_jsonb(title) ORDER BY catalog_item_id, locale) FROM catalog_item_titles title) AS titles,
      (SELECT jsonb_agg(to_jsonb(description) ORDER BY catalog_item_id, locale) FROM catalog_item_descriptions description) AS descriptions,
      (SELECT jsonb_agg(to_jsonb(episode) ORDER BY id) FROM catalog_episodes episode) AS episodes,
      (SELECT jsonb_agg(to_jsonb(link) ORDER BY provider, entity_type, external_id) FROM catalog_external_links link) AS links,
      (SELECT jsonb_agg(to_jsonb(field) ORDER BY id) FROM catalog_import_fields field) AS fields,
      (SELECT jsonb_agg(to_jsonb(release) ORDER BY id) FROM catalog_releases release) AS releases,
      (SELECT jsonb_agg(to_jsonb(follow) ORDER BY user_id, catalog_item_id) FROM catalog_item_follows follow) AS follows,
      (SELECT jsonb_agg(to_jsonb(watch) ORDER BY user_id, catalog_item_id) FROM catalog_movie_watches watch) AS movie_watches,
      (SELECT jsonb_agg(to_jsonb(watch) ORDER BY user_id, catalog_episode_id) FROM catalog_episode_watches watch) AS episode_watches
  `)

  return rows.rows[0]
}

describe('saved catalog import application', () => {
  beforeAll(async () => {
    await Promise.all([firstClient.connect(), secondClient.connect()])
    await assertDisposableTestDatabase(firstClient)
  })

  beforeEach(async () => {
    const user = {
      id: randomUUID(),
      email: `${randomUUID()}@example.com`
    }

    session = {
      database: firstDatabase,
      user
    }
    otherSession = {
      database: secondDatabase,
      user
    }
    itemIds = []

    await firstClient.query('INSERT INTO users (id, email) VALUES ($1, $2)', [user.id, user.email])
    await firstClient.query('INSERT INTO user_permissions (user_id, permission) VALUES ($1, \'catalog.manage\')', [user.id])
  })

  afterEach(async () => {
    await firstClient.query('DELETE FROM catalog_import_operations WHERE operator_id = $1', [session.user.id])
    await firstClient.query('DELETE FROM catalog_items WHERE id = ANY($1::uuid[])', [itemIds])
    await firstClient.query('DELETE FROM users WHERE id = $1', [session.user.id])
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await Promise.all([firstClient.end(), secondClient.end()])
  })

  it('applies one movie and description-only regional locales, then replays the saved result after preview cleanup', async () => {
    const tmdb = movieResponse()
    const russian = tmdb.translations.translations.find(translation => translation.iso_639_1 === 'ru')

    assert(russian !== undefined, 'The Russian translation fixture is missing')

    russian.data.overview = 'Russian description without a translated title'

    tmdb.translations.translations.push({
      iso_639_1: 'en',
      iso_3166_1: 'GB',

      data: {
        title: 'British title',
        overview: 'British description'
      }
    })

    const preview = await savedPreview(movie, tmdb)
    const applied = await applySuccess(preview.id)
    const id = applied.result.catalogItemId

    expect(applied.result).toMatchObject({
      createdItem: true,
      createdEpisodes: 0
    })

    const titles = await firstClient.query<{ locale: string; title: string; is_original: boolean }>('SELECT locale, title, is_original FROM catalog_item_titles WHERE catalog_item_id = $1 ORDER BY locale', [id])
    const descriptions = await firstClient.query<{ locale: string; description: string }>('SELECT locale, description FROM catalog_item_descriptions WHERE catalog_item_id = $1 ORDER BY locale', [id])

    expect(titles.rows.map(row => row.locale)).toStrictEqual(['en-GB', 'en-US', 'ja', 'ja-JP'])
    expect(descriptions.rows.map(row => row.locale)).toStrictEqual(['en-GB', 'en-US', 'ja-JP', 'ru-RU'])
    expect(titles.rows).not.toContainEqual(expect.objectContaining({ locale: 'ru-RU' }))

    const beforeReplay = await catalogRows()

    await firstClient.query('DELETE FROM catalog_import_previews WHERE id = $1', [preview.id])

    const replay = await applyImportPreview(session, preview.id, applyOptions())

    expect(replay.status).toBe('succeeded')

    expect(replay).toMatchObject({
      result: applied.result,
      operation: { id: applied.operation.id }
    })

    await expect(catalogRows()).resolves.toStrictEqual(beforeReplay)

    await expect(listImportOperations(session)).resolves.toMatchObject([{
      id: applied.operation.id,
      status: 'succeeded'
    }])
  })

  it('applies regular series episodes and keeps UUIDs, follows, watches and calendar records on update', async () => {
    const tmdb = {
      ...seriesResponse(),
      id: 9_000_001
    }

    const show = {
      ...showResponse(),
      id: 9_000_002
    }

    const first = await savedPreview(series, tmdb, show)
    const applied = await applySuccess(first.id)
    const itemId = applied.result.catalogItemId
    const episodeIds = await firstClient.query<{ id: string }>('SELECT id FROM catalog_episodes WHERE catalog_item_id = $1 ORDER BY season_number, episode_number', [itemId])

    expect(applied.result.createdEpisodes).toBe(3)
    expect(episodeIds.rows).toHaveLength(3)

    const [watchedEpisode] = episodeIds.rows

    assert(watchedEpisode !== undefined, 'The series has no regular episode')

    const watchedEpisodeId = watchedEpisode.id

    await firstClient.query('INSERT INTO catalog_item_follows (user_id, catalog_item_id) VALUES ($1, $2)', [session.user.id, itemId])
    await firstClient.query('INSERT INTO catalog_episode_watches (user_id, catalog_episode_id) VALUES ($1, $2)', [session.user.id, watchedEpisodeId])
    await firstClient.query('INSERT INTO catalog_releases (catalog_item_id, release_date, season_number, episode_number) VALUES ($1, $2, 1, 1)', [itemId, '2099-01-01'])

    const changedShow = structuredClone(show)

    // oxlint-disable-next-line eslint/no-underscore-dangle -- TVMaze names this response field _embedded.
    const [firstEpisode] = changedShow._embedded.episodes

    assert(firstEpisode !== undefined, 'The TVMaze episode fixture is missing')

    firstEpisode.name = 'Updated source episode'

    const second = await savedPreview(series, tmdb, changedShow)
    const updated = await applySuccess(second.id)
    const episodeIdsAfter = await firstClient.query<{ id: string }>('SELECT id FROM catalog_episodes WHERE catalog_item_id = $1 ORDER BY season_number, episode_number', [itemId])

    expect(updated.result.catalogItemId).toBe(itemId)
    expect(updated.result.createdItem).toBe(false)
    expect(updated.result.createdEpisodes).toBe(0)
    expect(episodeIdsAfter.rows).toStrictEqual(episodeIds.rows)

    const retained = await firstClient.query(`
      SELECT
        (SELECT count(*) FROM catalog_item_follows WHERE catalog_item_id = $1)::integer AS follows,
        (SELECT count(*) FROM catalog_episode_watches WHERE catalog_episode_id = $2)::integer AS watches,
        (SELECT count(*) FROM catalog_releases WHERE catalog_item_id = $1)::integer AS releases,
        (SELECT source_title FROM catalog_episodes WHERE id = $2) AS title
    `, [itemId, watchedEpisodeId])

    expect(retained.rows[0]).toStrictEqual({
      follows: 1,
      watches: 1,
      releases: 1,
      title: 'Updated source episode'
    })
  })

  it('preserves an editorial empty value and retains source fields that disappear', async () => {
    const first = await savedPreview()
    const applied = await applySuccess(first.id)
    const id = applied.result.catalogItemId

    await firstClient.query('UPDATE catalog_items SET release_year = NULL WHERE id = $1', [id])
    await firstClient.query('UPDATE catalog_item_descriptions SET description = \'\' WHERE catalog_item_id = $1 AND locale = \'en-US\'', [id])

    const changed = movieResponse()

    changed.release_date = '2027-02-03'

    const [, english] = changed.translations.translations

    assert(english !== undefined, 'The English translation fixture is missing')

    english.data.title = ''
    english.data.overview = 'Updated source description'

    const second = await savedPreview(movie, changed)

    expect(second.data.changes).toStrictEqual(expect.arrayContaining([
      expect.objectContaining({
        target: 'item',
        field: 'releaseYear',
        action: 'preserve_manual',
        before: null
      }),
      expect.objectContaining({
        target: 'title',
        locale: 'en-US',
        action: 'retain_missing'
      }),
      expect.objectContaining({
        target: 'description',
        locale: 'en-US',
        action: 'preserve_manual',
        before: ''
      })
    ]))

    await applySuccess(second.id)

    const rows = await firstClient.query(`
      SELECT item.release_year, title.title, description.description
      FROM catalog_items item
      JOIN catalog_item_titles title ON title.catalog_item_id = item.id AND title.locale = 'en-US'
      JOIN catalog_item_descriptions description ON description.catalog_item_id = item.id AND description.locale = 'en-US'
      WHERE item.id = $1
    `, [id])

    expect(rows.rows[0]).toStrictEqual({
      release_year: null,
      title: 'English test title',
      description: ''
    })

    const fields = await firstClient.query(`
      SELECT field_name, locale, last_source_value, last_applied_value, reviewed_at
      FROM catalog_import_fields WHERE catalog_item_id = $1 AND locale = 'en-US' ORDER BY field_name
    `, [id])

    expect(fields.rows).toMatchObject([
      {
        field_name: 'description',
        last_source_value: { value: 'Updated source description' },
        last_applied_value: { value: 'English test description' }
      },
      {
        field_name: 'title',
        last_source_value: { value: null },
        last_applied_value: { value: 'English test title' }
      }
    ])

    await firstClient.query('UPDATE catalog_item_descriptions SET description = \'English test description\' WHERE catalog_item_id = $1 AND locale = \'en-US\'', [id])

    const third = await savedPreview(movie, changed)

    expect(third.data.changes).toStrictEqual(expect.arrayContaining([
      expect.objectContaining({
        target: 'description',
        locale: 'en-US',
        action: 'update',
        before: 'English test description',
        after: 'Updated source description'
      })
    ]))

    await applySuccess(third.id)

    const restored = await firstClient.query<{ description: string }>('SELECT description FROM catalog_item_descriptions WHERE catalog_item_id = $1 AND locale = \'en-US\'', [id])

    expect(restored.rows[0]?.description).toBe('Updated source description')
  })

  it('updates an imported null field and retains a whole missing translation without touching user records', async () => {
    const absentYear = {
      ...movieResponse(),
      release_date: null
    }

    const first = await savedPreview(movie, absentYear)
    const applied = await applySuccess(first.id)
    const itemId = applied.result.catalogItemId

    await firstClient.query('INSERT INTO catalog_item_follows (user_id, catalog_item_id) VALUES ($1, $2)', [session.user.id, itemId])
    await firstClient.query('INSERT INTO catalog_movie_watches (user_id, catalog_item_id) VALUES ($1, $2)', [session.user.id, itemId])
    await firstClient.query('INSERT INTO catalog_releases (catalog_item_id, release_date) VALUES ($1, $2)', [itemId, '2099-01-01'])

    const fresh = movieResponse()

    fresh.translations.translations = fresh.translations.translations.filter(translation => translation.iso_639_1 !== 'en')

    const second = await savedPreview(movie, fresh)

    expect(second.data.changes).toStrictEqual(expect.arrayContaining([
      expect.objectContaining({
        target: 'item',
        field: 'releaseYear',
        action: 'update',
        before: null,
        after: 2026
      }),
      expect.objectContaining({
        target: 'title',
        locale: 'en-US',
        action: 'retain_missing'
      }),
      expect.objectContaining({
        target: 'description',
        locale: 'en-US',
        action: 'retain_missing'
      })
    ]))

    await applySuccess(second.id)

    const result = await firstClient.query<{
      release_year: number;
      title: string;
      description: string;
      follows: number;
      watches: number;
      releases: number;
    }>(`
      SELECT item.release_year, title.title, description.description,
        (SELECT count(*) FROM catalog_item_follows WHERE catalog_item_id = $1)::integer AS follows,
        (SELECT count(*) FROM catalog_movie_watches WHERE catalog_item_id = $1)::integer AS watches,
        (SELECT count(*) FROM catalog_releases WHERE catalog_item_id = $1)::integer AS releases
      FROM catalog_items item
      JOIN catalog_item_titles title ON title.catalog_item_id = item.id AND title.locale = 'en-US'
      JOIN catalog_item_descriptions description ON description.catalog_item_id = item.id AND description.locale = 'en-US'
      WHERE item.id = $1
    `, [itemId])

    expect(result.rows[0]).toStrictEqual({
      release_year: 2026,
      title: 'English test title',
      description: 'English test description',
      follows: 1,
      watches: 1,
      releases: 1
    })

    const ownership = await firstClient.query<{ last_source_value: { value: string | null }; last_applied_value: { value: string } }>(`
      SELECT last_source_value, last_applied_value FROM catalog_import_fields
      WHERE catalog_item_id = $1 AND field_name = 'title' AND locale = 'en-US'
    `, [itemId])

    expect(ownership.rows[0]).toStrictEqual({
      last_source_value: { value: null },
      last_applied_value: { value: 'English test title' }
    })
  })

  it('blocks a linked episode whose source coordinates changed', async () => {
    const tmdb = {
      ...seriesResponse(),
      id: 9_000_001
    }

    const show = {
      ...showResponse(),
      id: 9_000_002
    }

    const first = await savedPreview(series, tmdb, show)
    const applied = await applySuccess(first.id)
    const before = await catalogRows()
    const relocatedShow = structuredClone(show)

    // oxlint-disable-next-line eslint/no-underscore-dangle -- TVMaze names this response field _embedded.
    const [firstEpisode] = relocatedShow._embedded.episodes

    assert(firstEpisode !== undefined, 'The TVMaze episode fixture is missing')

    firstEpisode.number = 3

    const blocked = await createImportPreview(session, series, previewOptions(tmdb, relocatedShow))

    assert(blocked.status === 'blocked', 'Changed episode coordinates must block the preview')
    expect(blocked.preview.data.errors.map(problem => problem.code)).toContain('episode_coordinates_changed')

    await expect(applyImportPreview(session, blocked.preview.id, applyOptions())).resolves.toMatchObject({
      status: 'blocked',
      issue: { code: 'preview_not_ready' }
    })

    expect(applied.result.createdEpisodes).toBe(3)
    await expect(catalogRows()).resolves.toStrictEqual(before)
  })

  it('blocks old, expired and changed previews and rechecks access before writing', async () => {
    const expired = await savedPreview()
    const expiry = new Date(expired.expiresAt)

    await expect(applyImportPreview(session, expired.id, applyOptions(expiry))).resolves.toMatchObject({
      status: 'blocked',
      issue: { code: 'preview_unavailable' }
    })

    await firstClient.query(`UPDATE catalog_import_previews SET data = jsonb_set(data, '{version}', '1') WHERE id = $1`, [expired.id])

    await expect(applyImportPreview(session, expired.id, applyOptions())).resolves.toMatchObject({
      status: 'blocked',
      issue: { code: 'preview_version' }
    })

    const stale = await savedPreview()
    const existingId = randomUUID()

    itemIds.push(existingId)
    await firstClient.query('INSERT INTO catalog_items (id, type) VALUES ($1, \'movie\')', [existingId])
    await firstClient.query('INSERT INTO catalog_external_links (provider, entity_type, external_id, catalog_item_id) VALUES (\'tmdb\', \'movie\', \'603\', $1)', [existingId])

    const log = vi.spyOn(console, 'error').mockImplementation(() => {
      // The stale preview is expected in this test.
    })

    const rejected = await applyImportPreview(session, stale.id, applyOptions())

    expect(rejected).toMatchObject({
      status: 'failed',
      issue: { code: 'catalog_changed' }
    })

    expect(log).toHaveBeenCalledWith(expect.stringContaining('catalog import apply failed'))

    await expect(applyImportPreview(session, stale.id, {
      ...applyOptions(),
      retry: true
    })).resolves.toMatchObject({
      status: 'failed',
      issue: { code: 'catalog_changed' }
    })

    await firstClient.query('DELETE FROM user_permissions WHERE user_id = $1', [session.user.id])
    await expect(applyImportPreview(session, stale.id, applyOptions())).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('marks an abandoned attempt failed in history, then requires an explicit retry', async () => {
    const preview = await savedPreview()
    const old = new Date(start.getTime() - 10 * 60 * 1000)

    await firstClient.query(`
      INSERT INTO catalog_import_operations (preview_id, operator_id, selection, title, status, started_at, lease_expires_at)
      VALUES ($1, $2, $3, 'Original test title', 'pending', $4, $5)
    `, [preview.id, session.user.id, movie, old, new Date(old.getTime() + 5 * 60 * 1000)])

    const history = await listImportOperations(session, 50, start)

    expect(history).toStrictEqual(expect.arrayContaining([
      expect.objectContaining({
        previewId: preview.id,
        status: 'failed',
        failureCode: 'interrupted',
        retryable: true
      })
    ]))

    await expect(applyImportPreview(session, preview.id, applyOptions())).resolves.toMatchObject({
      status: 'failed',
      issue: { code: 'interrupted' }
    })

    const completed = await applySuccess(preview.id, {
      ...applyOptions(),
      retry: true
    })

    const attempts = await firstClient.query('SELECT status, failure_code FROM catalog_import_operations WHERE preview_id = $1 ORDER BY started_at', [preview.id])

    expect(completed.status).toBe('succeeded')

    expect(attempts.rows).toStrictEqual([
      {
        status: 'failed',
        failure_code: 'interrupted'
      },
      {
        status: 'succeeded',
        failure_code: null
      }
    ])
  })

  it('rolls back a mid-write failure, saves safe history and succeeds only on explicit retry', async () => {
    const preview = await savedPreview()
    const before = await catalogRows()

    const log = vi.spyOn(console, 'error').mockImplementation(() => {
      // The SQL failure is expected in this test.
    })

    await firstClient.query(`
      CREATE FUNCTION test_reject_import_title() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'private write failure'; END $$
    `)

    await firstClient.query('CREATE TRIGGER test_reject_import_title BEFORE INSERT ON catalog_item_titles FOR EACH ROW EXECUTE FUNCTION test_reject_import_title()')

    try {
      const failed = await applyImportPreview(session, preview.id, applyOptions())

      expect(failed).toMatchObject({
        status: 'failed',
        issue: { code: 'apply_failed' }
      })

      expect(JSON.stringify(failed)).not.toContain('private write failure')
      expect(JSON.stringify(log.mock.calls)).toContain('private write failure')
      await expect(catalogRows()).resolves.toStrictEqual(before)
      await expect(applyImportPreview(session, preview.id, applyOptions())).resolves.toMatchObject({ status: 'failed' })
    } finally {
      await firstClient.query('DROP TRIGGER test_reject_import_title ON catalog_item_titles')
      await firstClient.query('DROP FUNCTION test_reject_import_title()')
    }

    const completed = await applySuccess(preview.id, {
      ...applyOptions(),
      retry: true
    })

    expect(completed.result.createdItem).toBe(true)

    const attempts = await firstClient.query('SELECT status FROM catalog_import_operations WHERE preview_id = $1 ORDER BY started_at, id', [preview.id])

    expect(attempts.rows).toStrictEqual([{ status: 'failed' }, { status: 'succeeded' }])
  })

  it('serializes the same preview across two connections', async () => {
    const first = await savedPreview()
    const options = applyOptions()

    const [sameA, sameB] = await Promise.all([
      applyImportPreview(session, first.id, options),
      applyImportPreview(otherSession, first.id, options)
    ])

    const confirmed = await applyImportPreview(session, first.id, options)

    expect(confirmed.status).toBe('succeeded')
    expect([sameA.status, sameB.status]).toContain('succeeded')
    assert(confirmed.status === 'succeeded', 'Expected one completed import')
    itemIds.push(confirmed.result.catalogItemId)

    const once = await firstClient.query<{ count: number }>('SELECT count(*)::integer AS count FROM catalog_import_operations WHERE preview_id = $1', [first.id])

    expect(once.rows[0]?.count).toBe(1)
  })

  it('rejects overlapping previews across two connections with one saved catalog title', async () => {
    const first = await savedPreview()
    const second = await savedPreview()

    const log = vi.spyOn(console, 'error').mockImplementation(() => {
      // One source conflict is expected in this test.
    })

    const [firstResult, secondResult] = await Promise.all([
      applyImportPreview(session, first.id, applyOptions()),
      applyImportPreview(otherSession, second.id, applyOptions())
    ])

    const succeeded = [firstResult, secondResult].filter(result => result.status === 'succeeded')
    const failed = [firstResult, secondResult].filter(result => result.status === 'failed')

    expect(succeeded).toHaveLength(1)
    expect(failed).toHaveLength(1)

    const [loser] = failed

    assert(loser?.status === 'failed', 'One preview must lose the source mapping')
    expect(['conflict', 'catalog_changed']).toContain(loser.issue.code)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('catalog import apply failed'))

    const [winner] = succeeded

    assert(winner?.status === 'succeeded', 'One preview must win the source mapping')
    itemIds.push(winner.result.catalogItemId)

    const links = await firstClient.query<{ count: number }>('SELECT count(*)::integer AS count FROM catalog_external_links WHERE provider = \'tmdb\' AND entity_type = \'movie\' AND external_id = \'603\'')

    expect(links.rows[0]?.count).toBe(1)
  })
})
