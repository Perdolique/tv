import { Buffer } from 'node:buffer'

class SourceBodyError extends Error {
  constructor(message: string) {
    super(message)

    this.name = 'SourceBodyError'
  }
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const contentLength = response.headers.get('content-length')
  const declaredLength = Number(contentLength)
  const sizeLimitMessage = `Source body exceeds ${maxBytes} bytes`

  if (declaredLength > maxBytes) {
    await response.body?.cancel()

    throw new SourceBodyError(sizeLimitMessage)
  }

  if (response.body === null) {
    throw new SourceBodyError('Source body is missing')
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0

  try {
    let part = await reader.read()

    while (!part.done) {
      const bytes: unknown = part.value

      if (!(bytes instanceof Uint8Array)) {
        throw new SourceBodyError('Source body contains a non-byte chunk')
      }

      length += bytes.byteLength

      if (length > maxBytes) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Cancel before reading another oversized chunk.
        await reader.cancel()

        throw new SourceBodyError(sizeLimitMessage)
      }

      chunks.push(bytes)

      // oxlint-disable-next-line eslint/no-await-in-loop -- Read bounded chunks in order without buffering the whole response.
      part = await reader.read()
    }
  } finally {
    reader.releaseLock()
  }

  return Buffer.concat(chunks, length)
}

export { readLimitedBody, SourceBodyError }
