import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { CatalogErrorCode, CatalogErrorEnvelope } from './types.ts'

const ERROR_MESSAGES = {
  AUTHENTICATION_REQUIRED: 'Authentication is required.',
  INTERNAL_ERROR: 'An unexpected error occurred.',
  INVALID_REQUEST: 'The request is invalid.',
  SERVICE_UNAVAILABLE: 'Catalog search is temporarily unavailable.'
} satisfies Record<CatalogErrorCode, string>

interface CatalogErrorOptions {
  cause?: unknown;
  fields?: Record<string, string>;
}

class CatalogHttpError extends Error {
  readonly code: CatalogErrorCode
  readonly fields: Record<string, string> | undefined
  readonly status: ContentfulStatusCode

  constructor(
    code: CatalogErrorCode,
    status: ContentfulStatusCode,
    options: CatalogErrorOptions = {}
  ) {
    super(ERROR_MESSAGES[code], { cause: options.cause })

    this.code = code
    this.fields = options.fields
    this.name = 'CatalogHttpError'
    this.status = status
  }
}

function createCatalogErrorEnvelope(error: CatalogHttpError): CatalogErrorEnvelope {
  const body = {
    code: error.code,
    message: error.message
  }

  if (!error.fields) {
    return { error: body }
  }

  return {
    error: {
      ...body,
      fields: error.fields
    }
  }
}

export {
  CatalogHttpError,
  createCatalogErrorEnvelope
}
