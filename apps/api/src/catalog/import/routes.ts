import type { Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import * as v from 'valibot'

// oxlint-disable-next-line import/no-relative-parent-imports -- Import routes use the shared catalog error contract.
import { CatalogHttpError } from '../errors.ts'

/* oxlint-disable import/no-relative-parent-imports -- Import routes use the shared catalog error and session contracts. */
import {
  logCatalogServerError,
  withCatalogImportAccess,
  type CatalogDependencies,
  type CatalogEnvironment
} from '../session.ts'

import { applyImportPreview } from './apply-service.ts'
import { findImportOperationView, listImportOperationPage } from './history.ts'
import { createImportPreviewView } from './review.ts'
import { parseImportSearchPage, parseImportSearchQuery, searchTmdb, searchTvmaze } from './search.ts'
import { createImportPreview, openImportPreview, SOURCE_MESSAGES } from './service.ts'
import { ImportSourceError } from './source-http.ts'

const titleTypeSchema = v.picklist(['movie', 'series'])
const applyBodySchema = v.strictObject({ retry: v.optional(v.boolean()) })
const POSTER_CACHE_CONTROL = 'public, max-age=31536000, immutable'

const importBodyLimit = bodyLimit({
  maxSize: 2 ** 14,

  onError: () => {
    throw new CatalogHttpError('INVALID_REQUEST', 413)
  }
})

function imageNamespace(origin: string): string {
  const {hostname} = new URL(origin)
  const namespace = hostname.replaceAll('.', '-')

  if (!/^[a-z0-9-]+$/u.test(namespace)) {
    throw new Error('Catalog image namespace is invalid')
  }

  return namespace
}

function sourceFailure(context: Context<CatalogEnvironment>, error: ImportSourceError): Response {
  const catalogError = new CatalogHttpError('SERVICE_UNAVAILABLE', 503, { cause: error })

  logCatalogServerError(context, catalogError)

  if (error.retryAfterSeconds !== null) {
    context.header('Retry-After', String(error.retryAfterSeconds))
  }

  return context.json({
    status: 'source_failure',

    issue: {
      code: error.code,
      message: SOURCE_MESSAGES[error.code]
    },

    retryAfterSeconds: error.retryAfterSeconds
  }, 503)
}

function registerCatalogImportRoutes(app: Hono<CatalogEnvironment>, dependencies: CatalogDependencies): void {
  // A boolean navigation hint also handles a session that expires after the page opens.
  // The privileged routes below still reject missing grants and check them again on use.
  app.get('/api/catalog/imports/navigation', async (context) => {
    try {
      return await withCatalogImportAccess(context, dependencies.connectDatabase, () => context.json({ allowed: true }))
    } catch (error) {
      if (error instanceof CatalogHttpError && (error.code === 'FORBIDDEN' || error.code === 'AUTHENTICATION_REQUIRED')) {
        return context.json({ allowed: false })
      }

      throw error
    }
  })

  app.get('/api/catalog/imports/access', async (context) => withCatalogImportAccess(
    context,
    dependencies.connectDatabase,
    () => context.json({ allowed: true })
  ))

  app.get('/api/catalog/imports/search', async (context) => withCatalogImportAccess(
    context,
    dependencies.connectDatabase,
    async () => {
      const url = new URL(context.req.url)
      const type = url.searchParams.get('type')

      if (!v.is(titleTypeSchema, type)) {
        throw new CatalogHttpError('INVALID_REQUEST', 400, {
          fields: { type: 'Choose a movie or series.' }
        })
      }

      const query = parseImportSearchQuery(url.searchParams.get('query'))
      const page = parseImportSearchPage(url.searchParams.get('page'))

      try {
        const result = await searchTmdb({
          type,
          query,
          page,
          token: context.env.TMDB_READ_ACCESS_TOKEN
        })

        return context.json(result)
      } catch (error) {
        if (error instanceof ImportSourceError) {
          return sourceFailure(context, error)
        }

        throw error
      }
    }
  ))

  app.get('/api/catalog/imports/shows', async (context) => withCatalogImportAccess(
    context,
    dependencies.connectDatabase,
    async () => {
      const url = new URL(context.req.url)
      const query = parseImportSearchQuery(url.searchParams.get('query'))

      try {
        const result = await searchTvmaze(query)

        return context.json(result)
      } catch (error) {
        if (error instanceof ImportSourceError) {
          return sourceFailure(context, error)
        }

        throw error
      }
    }
  ))

  app.post('/api/catalog/imports/previews', async (context) => withCatalogImportAccess(
    context,
    dependencies.connectDatabase,
    async (session) => {
      await importBodyLimit(context, async () => {
        // The access-checked route continues below after the limit accepts the body.
      })

      const input: unknown = await context.req.json().catch(() => null)

      const result = await createImportPreview(session, input, {
        token: context.env.TMDB_READ_ACCESS_TOKEN,
        images: context.env.IMAGES
      })

      if (result.status === 'source_failure') {
        if (result.retryAfterSeconds !== null) {
          context.header('Retry-After', String(result.retryAfterSeconds))
        }

        return context.json(result, 503)
      }

      const preview = await createImportPreviewView(session.database, result.preview)

      return context.json({ preview }, 201)
    }
  ))

  app.get('/api/catalog/imports/previews/:id', async (context) => withCatalogImportAccess(
    context,
    dependencies.connectDatabase,
    async (session) => {
      const saved = await openImportPreview(session, context.req.param('id'))

      if (saved === null) {
        throw new CatalogHttpError('NOT_FOUND', 404)
      }

      const preview = await createImportPreviewView(session.database, saved)

      return context.json({ preview })
    }
  ))

  app.get('/api/catalog/imports/previews/:id/poster', async (context) => withCatalogImportAccess(
    context,
    dependencies.connectDatabase,
    async (session) => {
      const saved = await openImportPreview(session, context.req.param('id'))

      if (saved?.posterBytes === null || saved?.posterBytes === undefined) {
        throw new CatalogHttpError('NOT_FOUND', 404)
      }

      const posterBytes = new Uint8Array(saved.posterBytes)

      return new Response(posterBytes, {
        headers: {
          'Cache-Control': 'private, no-store',
          'Content-Type': 'image/webp',
          'X-Content-Type-Options': 'nosniff'
        }
      })
    }
  ))

  app.post('/api/catalog/imports/previews/:id/apply', async (context) => withCatalogImportAccess(
    context,
    dependencies.connectDatabase,
    async (session) => {
      await importBodyLimit(context, async () => {
        // The access-checked route continues below after the limit accepts the body.
      })

      const body: unknown = await context.req.json().catch(() => null)
      const parsed = v.safeParse(applyBodySchema, body)

      if (!parsed.success) {
        throw new CatalogHttpError('INVALID_REQUEST', 400)
      }

      const result = await applyImportPreview(session, context.req.param('id'), {
        hosted: context.env.IMAGES.hosted,
        namespace: imageNamespace(context.env.WEB_ORIGIN),
        retry: parsed.output.retry ?? false
      })

      if (result.status === 'blocked') {
        return context.json({
          status: 'blocked',
          operation: null,
          issue: result.issue
        }, 409)
      }

      const operation = await findImportOperationView(session, result.operation.id)

      if (operation === null) {
        throw new CatalogHttpError('SERVICE_UNAVAILABLE', 503)
      }

      const status = result.status === 'pending' ? 202 : 200

      return context.json({
        status: result.status,
        operation,
        issue: result.status === 'failed' ? result.issue : null
      }, status)
    }
  ))

  app.get('/api/catalog/imports/operations', async (context) => withCatalogImportAccess(
    context,
    dependencies.connectDatabase,
    async (session) => {
      const url = new URL(context.req.url)
      const page = await listImportOperationPage(session, url.searchParams.get('cursor'))

      return context.json(page)
    }
  ))

  app.get('/api/catalog/imports/operations/:id', async (context) => withCatalogImportAccess(
    context,
    dependencies.connectDatabase,
    async (session) => {
      const operation = await findImportOperationView(session, context.req.param('id'))

      if (operation === null) {
        throw new CatalogHttpError('NOT_FOUND', 404)
      }

      return context.json({ operation })
    }
  ))

  app.get('/api/posters/:file', async (context) => {
    const namespace = imageNamespace(context.env.WEB_ORIGIN)
    const pattern = new RegExp(`^tv-${namespace}-(?:movie|series)-[1-9]\\d*-[a-f0-9]{64}\\.webp$`, 'u')
    const file = context.req.param('file')

    if (!pattern.test(file)) {
      throw new CatalogHttpError('NOT_FOUND', 404)
    }

    const imageId = file.slice(0, -'.webp'.length)
    const image = context.env.IMAGES.hosted.image(imageId)
    const stream = await image.bytes()

    if (stream === null) {
      throw new CatalogHttpError('NOT_FOUND', 404)
    }

    return new Response(stream, {
      headers: {
        'Cache-Control': POSTER_CACHE_CONTROL,
        'Content-Type': 'image/webp',
        'X-Content-Type-Options': 'nosniff'
      }
    })
  })
}

export { registerCatalogImportRoutes }
