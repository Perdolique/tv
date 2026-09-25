import { Buffer } from 'node:buffer'
import { env } from 'cloudflare:workers'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'
import { largePosterPng, movieResponse, smallPosterPng } from '../../../testing/import-fixtures.ts'
import { preparePoster, sha256 } from '../poster.ts'
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
    await client.query('DELETE FROM catalog_import_previews WHERE operator_id = $1', [user.id])
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
