import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { preparePoster } from '../poster.ts'

describe('import poster limits', () => {
  it.each([
    {
      sourceWidth: 1200,
      sourceHeight: 1801,
      boxHeight: 720,
      outputWidth: 479,
      outputHeight: 720
    },
    {
      sourceWidth: 590,
      sourceHeight: 100,
      boxHeight: 82,
      outputWidth: 480,
      outputHeight: 81
    }
  ])('keeps WebP bounds and actual dimensions when fitting $sourceWidth x $sourceHeight', async ({ sourceWidth, sourceHeight, boxHeight, outputWidth, outputHeight }) => {
    const output = Buffer.from('RIFF0000WEBP')
    const response = new Response(output)
    const transform = vi.fn<ImageTransformer['transform']>()

    const transformer: ImageTransformer = {
      transform,
      draw: vi.fn<ImageTransformer['draw']>(),

      output: vi.fn<ImageTransformer['output']>().mockResolvedValue({
        response: () => response,
        contentType: () => 'image/webp',
        image: vi.fn<ImageTransformationResult['image']>()
      })
    }

    transform.mockReturnValue(transformer)

    const images = {
      info: vi.fn<ImagesBinding['info']>()
        .mockResolvedValueOnce({
        format: 'image/png',
        fileSize: 100,
        width: sourceWidth,
        height: sourceHeight
      })
        .mockResolvedValueOnce({
        format: 'image/webp',
        fileSize: output.byteLength,
        width: outputWidth,
        height: outputHeight
      }),

      input: vi.fn<ImagesBinding['input']>().mockReturnValue(transformer)
    }

    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('test image'))
    const poster = await preparePoster('/poster.png', images, { fetch: fetcher })

    expect(transform).toHaveBeenCalledWith({
      width: 480,
      height: boxHeight,
      fit: 'scale-down'
    })

    expect(poster.metadata.width).toBe(outputWidth)
    expect(poster.metadata.height).toBe(outputHeight)
  })

  it('rejects an oversized download before asking Images to transform it', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('small actual body', {
      headers: { 'content-length': String(10 * 1024 * 1024 + 1) }
    }))

    const images = {
      info: vi.fn<ImagesBinding['info']>(),
      input: vi.fn<ImagesBinding['input']>()
    }

    await expect(preparePoster('/poster.jpg', images, { fetch: fetcher })).rejects.toMatchObject({ code: 'source_invalid' })
    expect(images.info).not.toHaveBeenCalled()
    expect(images.input).not.toHaveBeenCalled()
  })

  it('rejects WebP output larger than one MiB', async () => {
    const output = Buffer.alloc(1024 * 1024 + 1)

    output.write('RIFF', 0, 'ascii')
    output.write('WEBP', 8, 'ascii')

    const response = new Response(output)
    const transform = vi.fn<ImageTransformer['transform']>()

    const transformer: ImageTransformer = {
      transform,
      draw: vi.fn<ImageTransformer['draw']>(),

      output: vi.fn<ImageTransformer['output']>().mockResolvedValue({
        response: () => response,
        contentType: () => 'image/webp',
        image: vi.fn<ImageTransformationResult['image']>()
      })
    }

    transform.mockReturnValue(transformer)

    const images = {
      info: vi.fn<ImagesBinding['info']>().mockResolvedValueOnce({
        format: 'image/png',
        fileSize: 100,
        width: 2,
        height: 3
      }).mockResolvedValueOnce({
        format: 'image/webp',
        fileSize: output.byteLength,
        width: 2,
        height: 3
      }),

      input: vi.fn<ImagesBinding['input']>().mockReturnValue(transformer)
    }

    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('test image'))

    await expect(preparePoster('/poster.png', images, { fetch: fetcher })).rejects.toMatchObject({ code: 'poster_failed' })

    expect(transform).toHaveBeenCalledWith({
      width: 2,
      height: 3,
      fit: 'scale-down'
    })
  })

  it.each([
    {
      status: 400,
      code: 'poster_failed',
      temporary: false
    },
    {
      status: 503,
      code: 'source_unavailable',
      temporary: true
    }
  ])('classifies Images HTTP $status without accepting failed output', async ({ status, code, temporary }) => {
    const response = new Response('Images failed', { status })
    const transform = vi.fn<ImageTransformer['transform']>()

    const transformer: ImageTransformer = {
      transform,
      draw: vi.fn<ImageTransformer['draw']>(),

      output: vi.fn<ImageTransformer['output']>().mockResolvedValue({
        response: () => response,
        contentType: () => 'image/webp',
        image: vi.fn<ImageTransformationResult['image']>()
      })
    }

    transform.mockReturnValue(transformer)

    const images = {
      info: vi.fn<ImagesBinding['info']>().mockResolvedValue({
        format: 'image/png',
        fileSize: 100,
        width: 2,
        height: 3
      }),

      input: vi.fn<ImagesBinding['input']>().mockReturnValue(transformer)
    }

    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('test image'))

    await expect(preparePoster('/poster.png', images, { fetch: fetcher })).rejects.toMatchObject({
      provider: 'images',
      code,
      temporary,
      cause: new Error(`Images returned HTTP ${status}`)
    })
  })

  it('treats an Images timeout as a temporary source failure', async () => {
    const error = new DOMException('Images timed out', 'TimeoutError')

    const images = {
      info: vi.fn<ImagesBinding['info']>().mockRejectedValue(error),
      input: vi.fn<ImagesBinding['input']>()
    }

    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('test image'))

    await expect(preparePoster('/poster.png', images, { fetch: fetcher })).rejects.toMatchObject({
      provider: 'images',
      code: 'source_unavailable',
      temporary: true,
      cause: error
    })

    expect(images.input).not.toHaveBeenCalled()
  })
})
