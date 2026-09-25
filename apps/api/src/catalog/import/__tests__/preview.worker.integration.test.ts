/* oxlint-disable eslint/max-lines -- Worker preview and application checks share one disposable database and Images binding. */
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { env } from 'cloudflare:workers'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { afterAll, afterEach, assert, beforeAll, describe, expect, it, vi } from 'vitest'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'
import { largePosterPng, movieResponse, smallPosterPng } from '../../../testing/import-fixtures.ts'
import { preparePoster, sha256 } from '../poster.ts'
import { applyImportPreview } from '../apply-service.ts'
import { hostedPosterId } from '../hosted-poster.ts'
import { scheduled } from '../scheduled.ts'
import { createImportPreview, openImportPreview, type ImportPreviewResult, type ImportSession } from '../service.ts'

const client = new Client({ connectionString: env.DATABASE.connectionString })
const database = createDatabase(client)

const user = {
  id: '40000000-0000-4000-8000-000000000163',
  email: 'preview-worker@example.com'
}

const session: ImportSession = {
  database,
  user
}

const importedItemIds: string[] = []

function assertSavedResult(result: ImportPreviewResult): asserts result is Exclude<ImportPreviewResult, { status: 'source_failure' }> {
  if (result.status === 'source_failure') {
    throw new Error('Expected a saved preview')
  }
}

describe('import preview Worker runtime', () => {
  beforeAll(async () => {
    await client.connect()
    await assertDisposableTestDatabase(client)
    await client.query('INSERT INTO users (id, email) VALUES ($1, $2)', [user.id, user.email])
    await client.query('INSERT INTO user_permissions (user_id, permission) VALUES ($1, \'catalog.manage\')', [user.id])
  })

  afterEach(async () => {
    await client.query('DELETE FROM catalog_import_operations WHERE operator_id = $1', [user.id])
    await client.query('DELETE FROM catalog_items WHERE id = ANY($1::uuid[])', [importedItemIds])
    await client.query('DELETE FROM catalog_import_previews WHERE operator_id = $1', [user.id])

    importedItemIds.length = 0

    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await client.query('DELETE FROM users WHERE id = $1', [user.id])
    await client.end()
  })

  it.each([
    {
      image: smallPosterPng,
      width: 2,
      height: 3
    },
    {
      image: largePosterPng,
      width: 480,
      height: 360
    }
  ])('prepares WebP within the size limit without cropping or upscaling: $width x $height', async ({ image, width, height }) => {
    const input = Buffer.from(image, 'base64')
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(input))
    const poster = await preparePoster('/test.png', env.IMAGES, { fetch: fetcher })

    expect(poster.metadata.width).toBe(width)
    expect(poster.metadata.height).toBe(height)
    expect(poster.metadata.byteLength).toBeLessThanOrEqual(1024 * 1024)
    expect(poster.metadata.sha256).toBe(sha256(poster.bytes))
    expect(poster.metadata.sourceHash).toBe(sha256(input))
    expect(poster.bytes.toString('ascii', 8, 12)).toBe('WEBP')
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://image.tmdb.org/t/p/original/test.png')
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe('manual')
  })

  it('reopens the saved bytes without contacting either source, and rejects corrupted bytes', async () => {
    const input = Buffer.from(smallPosterPng, 'base64')

    const tmdb = {
      ...movieResponse(),
      poster_path: '/test.png'
    }

    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(tmdb))
      .mockResolvedValueOnce(new Response(input))

    const result = await createImportPreview(session, {
      type: 'movie',
      tmdbId: 603
    }, {
      token: 'test',
      images: env.IMAGES,
      fetch: fetcher
    })

    expect(result.status).toBe('ready')
    assertSavedResult(result)

    const opened = await openImportPreview(session, result.preview.id)

    expect(opened).toStrictEqual(result.preview)
    expect(fetcher).toHaveBeenCalledTimes(2)
    await client.query('UPDATE catalog_import_previews SET poster_bytes = decode(\'010203\', \'hex\') WHERE id = $1', [result.preview.id])
    await expect(openImportPreview(session, result.preview.id)).rejects.toThrow('Saved import poster failed its integrity check')
  })

  it('applies the saved WebP bytes through Images and keeps the versioned poster path on repeat', async () => {
    const input = Buffer.from(smallPosterPng, 'base64')

    const tmdb = {
      ...movieResponse(),
      poster_path: '/test.png'
    }

    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(tmdb))
      .mockResolvedValueOnce(new Response(input))

    const created = await createImportPreview(session, {
      type: 'movie',
      tmdbId: 603
    }, {
      token: 'test',
      images: env.IMAGES,
      fetch: fetcher
    })

    assertSavedResult(created)
    expect(created.status).toBe('ready')

    const options = {
      hosted: env.IMAGES.hosted,
      namespace: `test-${randomUUID()}`
    }

    const applied = await applyImportPreview(session, created.preview.id, options)

    assert(applied.status === 'succeeded', 'Expected the saved poster import to succeed')
    importedItemIds.push(applied.result.catalogItemId)

    const { posterId } = applied.operation

    expect(posterId).not.toBeNull()
    assert(posterId !== null, 'The import did not record its poster ID')

    try {
      expect(applied.result.posterPath).toBe(`/api/posters/${posterId}.webp`)

      const posterFields = await client.query<{ last_applied_value: { value: string | null; hash: string | null } }>(
        'SELECT last_applied_value FROM catalog_import_fields WHERE catalog_item_id = $1 AND field_name = \'posterPath\'',
        [applied.result.catalogItemId]
      )

      expect(posterFields.rows[0]?.last_applied_value).toStrictEqual({
        value: applied.result.posterPath,
        hash: created.preview.data.poster?.sha256
      })

      const stored = await env.IMAGES.hosted.image(posterId).bytes()

      expect(stored).not.toBeNull()
      assert(stored !== null, 'The uploaded poster was not found')

      const bytes = Buffer.from(await new Response(stored).arrayBuffer())

      expect(bytes).toStrictEqual(created.preview.posterBytes)

      const repeated = await applyImportPreview(session, created.preview.id, options)

      expect(repeated).toMatchObject({
        status: 'succeeded',
        operation: { id: applied.operation.id },
        result: applied.result
      })

      expect(fetcher).toHaveBeenCalledTimes(2)
    } finally {
      await env.IMAGES.hosted.image(posterId).delete()
    }
  })

  it('records an Images failure without a catalog write and retries the same saved poster', async () => {
    const input = Buffer.from(smallPosterPng, 'base64')

    const tmdb = {
      ...movieResponse(),
      poster_path: '/test.png'
    }

    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(tmdb))
      .mockResolvedValueOnce(new Response(input))

    const created = await createImportPreview(session, {
      type: 'movie',
      tmdbId: 603
    }, {
      token: 'test',
      images: env.IMAGES,
      fetch: fetcher
    })

    assertSavedResult(created)
    expect(created.status).toBe('ready')

    const unavailable = {
      image: vi.fn<ImagesBinding['hosted']['image']>().mockReturnValue({
        details: vi.fn<ImageHandle['details']>().mockResolvedValue(null),
        bytes: vi.fn<ImageHandle['bytes']>().mockResolvedValue(null),
        signedUrl: vi.fn<ImageHandle['signedUrl']>(),
        update: vi.fn<ImageHandle['update']>(),
        delete: vi.fn<ImageHandle['delete']>()
      }),

      upload: vi.fn<ImagesBinding['hosted']['upload']>().mockRejectedValue(new Error('private Images failure')),
      list: vi.fn<ImagesBinding['hosted']['list']>(),
      createDirectUpload: vi.fn<ImagesBinding['hosted']['createDirectUpload']>()
    }

    const namespace = `test-${randomUUID()}`

    const log = vi.spyOn(console, 'error').mockImplementation(() => {
      // Inspect expected private diagnostics.
    })

    const failed = await applyImportPreview(session, created.preview.id, {
      hosted: unavailable,
      namespace
    })

    expect(failed).toMatchObject({
      status: 'failed',
      issue: { code: 'poster_failed' }
    })

    expect(JSON.stringify(failed)).not.toContain('private Images failure')
    expect(JSON.stringify(log.mock.calls)).toContain('private Images failure')

    const beforeRetry = await client.query<{ count: number }>('SELECT count(*)::integer AS count FROM catalog_external_links WHERE provider = \'tmdb\' AND entity_type = \'movie\' AND external_id = \'603\'')

    expect(beforeRetry.rows[0]?.count).toBe(0)

    const retried = await applyImportPreview(session, created.preview.id, {
      hosted: env.IMAGES.hosted,
      namespace,
      retry: true
    })

    assert(retried.status === 'succeeded', 'Expected the explicit retry to succeed')
    importedItemIds.push(retried.result.catalogItemId)
    assert(retried.operation.posterId !== null, 'The retry did not record its poster ID')
    await env.IMAGES.hosted.image(retried.operation.posterId).delete()
  })

  it('keeps an uploaded but unreferenced poster for a safe retry after a database rollback', async () => {
    const input = Buffer.from(smallPosterPng, 'base64')

    const tmdb = {
      ...movieResponse(),
      poster_path: '/test.png'
    }

    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(tmdb))
      .mockResolvedValueOnce(new Response(input))

    const created = await createImportPreview(session, {
      type: 'movie',
      tmdbId: 603
    }, {
      token: 'test',
      images: env.IMAGES,
      fetch: fetcher
    })

    assertSavedResult(created)
    assert(created.preview.data.poster !== null, 'The preview poster is missing')

    const namespace = `test-${randomUUID()}`
    const posterId = hostedPosterId(namespace, created.preview.selection, created.preview.data.poster)
    const upload = vi.fn<ImagesBinding['hosted']['upload']>().mockImplementation(async (image, options) => env.IMAGES.hosted.upload(image, options))

    const hosted: ImagesBinding['hosted'] = {
      image: imageId => env.IMAGES.hosted.image(imageId),
      upload,
      list: async options => env.IMAGES.hosted.list(options),
      createDirectUpload: async options => env.IMAGES.hosted.createDirectUpload(options)
    }

    const log = vi.spyOn(console, 'error').mockImplementation(() => {
      // The SQL failure is expected in this test.
    })

    await client.query(`
      CREATE FUNCTION test_reject_poster_import() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'private poster write failure'; END $$
    `)

    await client.query('CREATE TRIGGER test_reject_poster_import BEFORE INSERT ON catalog_item_titles FOR EACH ROW EXECUTE FUNCTION test_reject_poster_import()')

    try {
      const failed = await applyImportPreview(session, created.preview.id, {
        hosted,
        namespace
      })

      expect(failed).toMatchObject({
        status: 'failed',
        operation: { posterId },
        issue: { code: 'apply_failed' }
      })

      expect(JSON.stringify(log.mock.calls)).toContain('private poster write failure')

      const orphan = await env.IMAGES.hosted.image(posterId).bytes()

      assert(orphan !== null, 'The uploaded poster was not retained after rollback')
      expect(Buffer.from(await new Response(orphan).arrayBuffer())).toStrictEqual(created.preview.posterBytes)

      const links = await client.query<{ count: number }>('SELECT count(*)::integer AS count FROM catalog_external_links WHERE provider = \'tmdb\' AND entity_type = \'movie\' AND external_id = \'603\'')

      expect(links.rows[0]?.count).toBe(0)
      await client.query('DROP TRIGGER test_reject_poster_import ON catalog_item_titles')
      await client.query('DROP FUNCTION test_reject_poster_import()')

      const retried = await applyImportPreview(session, created.preview.id, {
        hosted,
        namespace,
        retry: true
      })

      assert(retried.status === 'succeeded', 'The orphaned poster retry did not succeed')
      importedItemIds.push(retried.result.catalogItemId)
      expect(retried.result.posterPath).toBe(`/api/posters/${posterId}.webp`)
      expect(upload).toHaveBeenCalledTimes(1)
    } finally {
      await client.query('DROP TRIGGER IF EXISTS test_reject_poster_import ON catalog_item_titles')
      await client.query('DROP FUNCTION IF EXISTS test_reject_poster_import()')
      await env.IMAGES.hosted.image(posterId).delete()
    }
  })

  it('blocks invalid artwork and refuses non-source addresses without a download', async () => {
    const fetcher = vi.fn<typeof fetch>()

    await expect(preparePoster('https://untrusted.test/image.png', env.IMAGES, { fetch: fetcher })).rejects.toMatchObject({ code: 'poster_failed' })
    expect(fetcher).not.toHaveBeenCalled()
    fetcher.mockResolvedValue(new Response('not an image'))
    await expect(preparePoster('/test.png', env.IMAGES, { fetch: fetcher })).rejects.toMatchObject({ code: 'poster_failed' })
  })

  it('saves a blocked preview when a declared poster cannot be downloaded', async () => {
    const tmdb = {
      ...movieResponse(),
      poster_path: '/missing.png'
    }

    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(tmdb))
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))

    const log = vi.spyOn(console, 'error').mockImplementation(() => {
      // Inspect the expected technical failure without writing it to the test console.
    })

    const result = await createImportPreview(session, {
      type: 'movie',
      tmdbId: 603
    }, {
      token: 'test',
      images: env.IMAGES,
      fetch: fetcher
    })

    assertSavedResult(result)
    expect(result.status).toBe('blocked')
    expect(result.preview.data.poster).toBeNull()
    expect(result.preview.data.errors[0]?.code).toBe('source_not_found')

    const warnings = result.preview.data.warnings.map(issue => issue.code)

    expect(warnings).not.toContain('poster_missing')
    expect(JSON.stringify(log.mock.calls)).toContain('HTTP 404')
  })

  it('runs the scheduled cleanup against the Worker database without removing a live preview', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(movieResponse()))
      .mockResolvedValueOnce(Response.json(movieResponse()))

    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000)

    const old = await createImportPreview(session, {
      type: 'movie',
      tmdbId: 603
    }, {
      token: 'test',
      images: env.IMAGES,
      fetch: fetcher,
      now: () => oldTime
    })

    const live = await createImportPreview(session, {
      type: 'movie',
      tmdbId: 603
    }, {
      token: 'test',
      images: env.IMAGES,
      fetch: fetcher
    })

    expect(old.status).toBe('ready')
    expect(live.status).toBe('ready')
    assertSavedResult(old)
    assertSavedResult(live)

    const controller: ScheduledController = {
      scheduledTime: Date.now(),
      cron: '0 3 * * *',
      noRetry: vi.fn<() => void>()
    }

    await scheduled(controller, env)

    const rows = await client.query<{ id: string }>('SELECT id FROM catalog_import_previews WHERE operator_id = $1', [user.id])

    expect(rows.rows).toStrictEqual([{ id: live.preview.id }])
  })
})
