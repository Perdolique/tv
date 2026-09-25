import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { env } from 'cloudflare:workers'
import { assert, describe, expect, it, vi } from 'vitest'
import { smallPosterPng } from '../../../testing/import-fixtures.ts'
import { uploadPreparedPoster } from '../hosted-poster.ts'
import { preparePoster } from '../poster.ts'

const selection = {
  type: 'movie',
  tmdbId: 603
} as const

describe('hosted catalog posters in the Worker runtime', () => {
  it('uploads the exact prepared bytes once and reuses the same versioned ID', async () => {
    const source = Buffer.from(smallPosterPng, 'base64')
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(source))
    const prepared = await preparePoster('/test.png', env.IMAGES, { fetch: fetcher })
    const namespace = `test-${randomUUID()}`

    const first = await uploadPreparedPoster({
      hosted: env.IMAGES.hosted,
      namespace,
      selection,
      poster: prepared.metadata,
      bytes: prepared.bytes
    })

    try {
      expect(first.path).toBe(`/api/posters/${first.id}.webp`)

      const stored = await env.IMAGES.hosted.image(first.id).bytes()

      expect(stored).not.toBeNull()
      assert(stored !== null, 'The hosted poster bytes were not saved')

      const savedBytes = Buffer.from(await new Response(stored).arrayBuffer())

      expect(savedBytes).toStrictEqual(prepared.bytes)

      const second = await uploadPreparedPoster({
        hosted: env.IMAGES.hosted,
        namespace,
        selection,
        poster: prepared.metadata,
        bytes: prepared.bytes
      })

      expect(second).toStrictEqual(first)
    } finally {
      await env.IMAGES.hosted.image(first.id).delete()
    }
  })

  it('reports an Images upload failure and rejects a changed file under an existing ID', async () => {
    const source = Buffer.from(smallPosterPng, 'base64')

    const prepared = await preparePoster('/test.png', env.IMAGES, {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(source))
    })

    const unavailable = {
      image: vi.fn<ImagesBinding['hosted']['image']>().mockReturnValue({
        details: vi.fn<ImageHandle['details']>().mockResolvedValue(null),
        bytes: vi.fn<ImageHandle['bytes']>().mockResolvedValue(null),
        signedUrl: vi.fn<ImageHandle['signedUrl']>(),
        update: vi.fn<ImageHandle['update']>(),
        delete: vi.fn<ImageHandle['delete']>()
      }),

      upload: vi.fn<ImagesBinding['hosted']['upload']>().mockRejectedValue(new Error('Images unavailable')),
      list: vi.fn<ImagesBinding['hosted']['list']>(),
      createDirectUpload: vi.fn<ImagesBinding['hosted']['createDirectUpload']>()
    }

    const input = {
      namespace: 'test',
      selection,
      poster: prepared.metadata,
      bytes: prepared.bytes
    }

    await expect(uploadPreparedPoster({
      ...input,
      hosted: unavailable
    })).rejects.toThrow('Images unavailable')

    const changed = {
      ...unavailable,

      image: vi.fn<ImagesBinding['hosted']['image']>().mockReturnValue({
        details: vi.fn<ImageHandle['details']>().mockResolvedValue({
          id: 'existing',
          requireSignedURLs: false,
          variants: []
        }),

        bytes: vi.fn<ImageHandle['bytes']>().mockResolvedValue(new Response('different bytes').body),
        signedUrl: vi.fn<ImageHandle['signedUrl']>(),
        update: vi.fn<ImageHandle['update']>(),
        delete: vi.fn<ImageHandle['delete']>()
      }),

      upload: vi.fn<ImagesBinding['hosted']['upload']>()
    }

    await expect(uploadPreparedPoster({
      ...input,
      hosted: changed
    })).rejects.toThrow('different image bytes')

    expect(changed.upload).not.toHaveBeenCalled()
  })
})
