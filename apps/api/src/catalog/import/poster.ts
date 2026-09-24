import type { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import type { PreviewPoster } from '@tv/database/import-preview'
import { readLimitedBody } from './source-body.ts'
import { fetchSourceBytes, ImportSourceError, type SourceHttpOptions } from './source-http.ts'

interface PreparedPoster {
  bytes: Buffer;
  metadata: PreviewPoster;
}

interface PosterDimensions {
  width: number;
  height: number;
}

type BindingImageInfo = Awaited<ReturnType<ImagesBinding['info']>>

function sha256(bytes: Uint8Array | string): string {
  const hash = createHash('sha256')

  hash.update(bytes)

  return hash.digest('hex')
}

function imageStream(bytes: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    }
  })
}

function isTemporaryImagesError(error: unknown): boolean {
  return error instanceof DOMException && (
    error.name === 'AbortError' || error.name === 'TimeoutError' || error.name === 'NetworkError'
  )
}

function isTemporaryImagesStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 503 || status === 504
}

function validatedPosterDimensions(bytes: Buffer, info: BindingImageInfo, box: PosterDimensions): PosterDimensions {
  const signature = bytes.toString('ascii', 0, 4)
  const format = bytes.toString('ascii', 8, 12)

  if (signature !== 'RIFF' || format !== 'WEBP') {
    throw new Error('Prepared poster does not match the requested WebP dimensions')
  }

  if (!('width' in info) || info.width <= 0 || info.height <= 0) {
    throw new Error('Prepared poster does not match the requested WebP dimensions')
  }

  const exceedsBox = info.width > box.width || info.height > box.height
  const missesBox = box.width - info.width > 1 || box.height - info.height > 1

  if (exceedsBox || missesBox) {
    throw new Error('Prepared poster does not match the requested WebP dimensions')
  }

  return {
    width: info.width,
    height: info.height
  }
}

async function preparePoster(path: string, images: Pick<ImagesBinding, 'info' | 'input'>, options: SourceHttpOptions): Promise<PreparedPoster> {
  try {
    if (!/^\/[a-zA-Z0-9]+\.(?:jpg|jpeg|png|webp)$/u.test(path)) {
      throw new Error('Invalid TMDB poster path')
    }

    const sourceUrl = `https://image.tmdb.org/t/p/original${path}`

    const source = await fetchSourceBytes({
      provider: 'poster',
      url: sourceUrl,
      maxBytes: 10 * 1024 * 1024
    }, options)

    const sourceStream = imageStream(source)
    const sourceInfo = await images.info(sourceStream)

    if (!('width' in sourceInfo) || sourceInfo.width <= 0 || sourceInfo.height <= 0) {
      throw new Error('The source poster has no raster dimensions')
    }

    // Explicit dimensions also preserve composition in the lower-fidelity local binding.
    const scale = Math.min(1, 480 / sourceInfo.width, 720 / sourceInfo.height)

    // Round the box up so a second aspect-ratio fit cannot shrink it unnecessarily.
    const scaledWidth = Math.ceil(sourceInfo.width * scale)
    const scaledHeight = Math.ceil(sourceInfo.height * scale)
    const width = Math.min(480, scaledWidth)
    const height = Math.min(720, scaledHeight)
    const transformStream = imageStream(source)
    const transformer = images.input(transformStream)

    const resized = transformer.transform({
      width,
      height,
      fit: 'scale-down'
    })

    const output = await resized.output({
      format: 'image/webp',
      anim: false
    })

    const response = output.response()

    if (!response.ok) {
      await response.body?.cancel()

      const { status } = response
      const temporary = isTemporaryImagesStatus(status)
      const cause = new Error(`Images returned HTTP ${status}`)

      throw new ImportSourceError('images', temporary ? 'source_unavailable' : 'poster_failed', {
        cause,
        temporary
      })
    }

    if (output.contentType() !== 'image/webp') {
      await response.body?.cancel()

      throw new Error('Images did not produce WebP')
    }

    const bytes = await readLimitedBody(response, 1024 * 1024)
    const outputStream = imageStream(bytes)
    const info = await images.info(outputStream)

    const dimensions = validatedPosterDimensions(bytes, info, {
      width,
      height
    })

    const sourceHash = sha256(source)
    const outputHash = sha256(bytes)

    return {
      bytes,

      metadata: {
        sourceUrl,
        sourceHash,
        sha256: outputHash,
        contentType: 'image/webp',
        width: dimensions.width,
        height: dimensions.height,
        byteLength: bytes.byteLength
      }
    }
  } catch (error) {
    if (error instanceof ImportSourceError) {
      throw error
    }

    const temporary = isTemporaryImagesError(error)

    throw new ImportSourceError('images', temporary ? 'source_unavailable' : 'poster_failed', {
      cause: error,
      temporary
    })
  }
}

export { preparePoster, sha256 }
export type { PreparedPoster }
