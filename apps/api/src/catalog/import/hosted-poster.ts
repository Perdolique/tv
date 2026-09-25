import type { Buffer } from 'node:buffer'
import type { ImportSelection, PreviewPoster } from '@tv/database/import-preview'
import { readLimitedBody } from './source-body.ts'
import { sha256 } from './poster.ts'

interface HostedPoster {
  id: string;
  path: string;
}

interface UploadPreparedPosterInput {
  hosted: ImagesBinding['hosted'];
  namespace: string;
  selection: ImportSelection;
  poster: PreviewPoster;
  bytes: Buffer;
}

function hostedPosterId(namespace: string, selection: ImportSelection, poster: PreviewPoster): string {
  if (!/^[a-z0-9-]+$/u.test(namespace)) {
    throw new Error('Invalid catalog image namespace')
  }

  return `tv-${namespace}-${selection.type}-${String(selection.tmdbId)}-${poster.sha256}`
}

function posterStream(bytes: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    }
  })
}

async function verifyHostedPoster(hosted: ImagesBinding['hosted'], id: string, expectedHash: string): Promise<boolean> {
  const image = hosted.image(id)
  const details = await image.details()

  if (details === null) {
    return false
  }

  const stream = await image.bytes()

  if (stream === null) {
    throw new Error('Hosted poster metadata exists without image bytes')
  }

  const bytes = await readLimitedBody(new Response(stream), 1024 * 1024)

  if (sha256(bytes) !== expectedHash) {
    throw new Error('Hosted poster ID contains different image bytes')
  }

  return true
}

async function uploadPreparedPoster({ hosted, namespace, selection, poster, bytes }: UploadPreparedPosterInput): Promise<HostedPoster> {
  if (bytes.byteLength !== poster.byteLength || sha256(bytes) !== poster.sha256) {
    throw new Error('Saved import poster failed its integrity check')
  }

  const id = hostedPosterId(namespace, selection, poster)
  const path = `/api/posters/${id}.webp`

  if (await verifyHostedPoster(hosted, id, poster.sha256)) {
    return {
      id,
      path
    }
  }

  try {
    const uploaded = await hosted.upload(posterStream(bytes), {
      id,
      filename: 'poster.webp',
      requireSignedURLs: false,

      metadata: {
        namespace,
        sha256: poster.sha256,
        sourceHash: poster.sourceHash,
        sourceUrl: poster.sourceUrl,
        tmdbId: selection.tmdbId,
        type: selection.type
      }
    })

    if (uploaded.id !== id) {
      throw new Error('Images returned an unexpected poster ID')
    }
  } catch (error) {
    if (!await verifyHostedPoster(hosted, id, poster.sha256)) {
      throw error
    }
  }

  return {
    id,
    path
  }
}

export { hostedPosterId, uploadPreparedPoster }
export type { HostedPoster }
