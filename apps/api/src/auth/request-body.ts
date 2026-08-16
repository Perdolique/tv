import { AuthHttpError } from './errors.ts'

async function readRequiredJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.toLowerCase()
  const mediaType = contentType?.split(';', 1)[0]?.trim()

  if (mediaType !== 'application/json') {
    throw new AuthHttpError('INVALID_REQUEST', 400)
  }

  try {
    return await request.json()
  } catch (error) {
    throw new AuthHttpError('INVALID_REQUEST', 400, { cause: error })
  }
}

async function requireEmptyBody(request: Request): Promise<void> {
  if (request.body === null) {
    return
  }

  const body = await request.arrayBuffer()

  if (body.byteLength !== 0) {
    throw new AuthHttpError('INVALID_REQUEST', 400)
  }
}

export {
  readRequiredJsonBody,
  requireEmptyBody
}
