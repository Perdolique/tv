import type { Database } from '@tv/database'
import type { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import * as v from 'valibot'
import { catalogItems } from '@tv/database/schema'
import { eq } from 'drizzle-orm'

import {
  DISCOVERY_PREVIEW_SIZE,
  collectionIdSchema,
  collectionInputSchema,
  collectionUpdateSchema,
  collectionDeleteSchema,
  discoveryKindSchema
} from '@tv/shared/catalog-discovery'

import { canonicalizeTitleLocale } from './search.ts'
import { CatalogHttpError } from './errors.ts'

import {
  withCatalogDatabase,
  withCatalogImportAccess,
  type CatalogDependencies,
  type CatalogEnvironment
} from './session.ts'

import { findCollectionPreviews, findDiscoveryPage } from './discovery-repository.ts'
import { deleteCollection, findCollectionPage, listCollections, saveCollection } from './collections-repository.ts'

function parseDiscoveryPage(value: string | null): number {
  if (value === null) { return 1 }

  const page = Number(value)

  if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(page) || page > 1_000_000) {
    throw new CatalogHttpError('INVALID_REQUEST', 400, { fields: { page: 'Use a positive page number.' } })
  }

  return page
}

function parseInput<Schema extends v.GenericSchema>(schema: Schema, value: unknown): v.InferOutput<Schema> {
  const result = v.safeParse(schema, value)

  if (!result.success) { throw new CatalogHttpError('INVALID_REQUEST', 400) }

  return result.output
}

async function readJson(request: Request): Promise<unknown> {
  try { return await request.json() } catch { throw new CatalogHttpError('INVALID_REQUEST', 400) }
}

// All statements contributing to a response must see the same published collection version.
async function readCatalogSnapshot<Result>(database: Database, operation: (reader: Pick<Database, 'select'>) => Promise<Result>): Promise<Result> {
  return database.transaction(operation, {
    isolationLevel: 'repeatable read',
    accessMode: 'read only'
  })
}

function registerCatalogDiscoveryRoutes(app: Hono<CatalogEnvironment>, dependencies: CatalogDependencies): void {
  app.get('/api/catalog/discovery', async (context) => {
    const titleLocale = context.req.query('titleLocale') ?? null
    const locale = canonicalizeTitleLocale(titleLocale)

    const result = await withCatalogDatabase(context, dependencies.connectDatabase, async (database) => readCatalogSnapshot(database, async (reader) => {
      const recent = await findDiscoveryPage(reader, {
        kind: 'recent',
        locale,
        size: DISCOVERY_PREVIEW_SIZE
      })

      const topRated = await findDiscoveryPage(reader, {
        kind: 'top-rated',
        locale,
        size: DISCOVERY_PREVIEW_SIZE
      })

      const collections = await findCollectionPreviews(reader, locale)

      return {
        recent: recent.items,
        topRated: topRated.items,
        collections
      }
    }))

    return context.json(result)
  })

  app.get('/api/catalog/discovery/:kind', async (context) => {
    const rawKind = context.req.param('kind')
    const kind = parseInput(discoveryKindSchema, rawKind)
    const titleLocale = context.req.query('titleLocale') ?? null
    const locale = canonicalizeTitleLocale(titleLocale)
    const rawPage = context.req.query('page') ?? null
    const page = parseDiscoveryPage(rawPage)

    const result = await withCatalogDatabase(context, dependencies.connectDatabase, async database => readCatalogSnapshot(database, async reader => findDiscoveryPage(reader, {
      kind,
      locale,
      page
    })))

    return context.json(result)
  })

  app.get('/api/catalog/collections/:id', async (context) => {
    const rawId = context.req.param('id')
    const id = parseInput(collectionIdSchema, rawId)
    const titleLocale = context.req.query('titleLocale') ?? null
    const locale = canonicalizeTitleLocale(titleLocale)
    const rawPage = context.req.query('page') ?? null
    const page = parseDiscoveryPage(rawPage)

    const result = await withCatalogDatabase(context, dependencies.connectDatabase, async database => readCatalogSnapshot(database, async reader => findCollectionPage(reader, id, {
      locale,
      page
    })))

    return context.json(result)
  })

  app.get('/api/catalog/items/:id/collections', async (context) => {
    const rawId = context.req.param('id')
    const id = parseInput(collectionIdSchema, rawId)
    const titleLocale = context.req.query('titleLocale') ?? null
    const locale = canonicalizeTitleLocale(titleLocale)

    const collections = await withCatalogDatabase(context, dependencies.connectDatabase, async (database) => readCatalogSnapshot(database, async (reader) => {
      const items = await reader.select({ id: catalogItems.id }).from(catalogItems)
        .where(
          eq(catalogItems.id, id)
        )

      if (items.length === 0) { throw new CatalogHttpError('NOT_FOUND', 404) }

      return findCollectionPreviews(reader, locale, id)
    }))

    return context.json({ collections })
  })

  const collectionBodyLimit = bodyLimit({
    maxSize: 65_536,

    onError: () => {
      throw new CatalogHttpError('INVALID_REQUEST', 413)
    }
  })

  app.use('/api/catalog/manage/collections/*', collectionBodyLimit)
  app.use('/api/catalog/manage/collections', collectionBodyLimit)

  app.get('/api/catalog/manage/collections', async (context) => {
    const result = await withCatalogImportAccess(context, dependencies.connectDatabase, async (session) => {
      const rawPage = context.req.query('page') ?? null
      const page = parseDiscoveryPage(rawPage)

      return listCollections(session.database, page)
    })

    return context.json(result)
  })

  app.get('/api/catalog/manage/collections/:id', async (context) => {
    const result = await withCatalogImportAccess(context, dependencies.connectDatabase, async (session) => {
      const rawId = context.req.param('id')
      const id = parseInput(collectionIdSchema, rawId)
      const titleLocale = context.req.query('titleLocale') ?? null
      const locale = canonicalizeTitleLocale(titleLocale)

      return readCatalogSnapshot(session.database, async reader => findCollectionPage(reader, id, {
        locale,
        editor: true
      }))
    })

    return context.json(result)
  })

  app.post('/api/catalog/manage/collections', async (context) => {
    const collection = await withCatalogImportAccess(context, dependencies.connectDatabase, async (session) => {
      const raw = await readJson(context.req.raw)
      const input = parseInput(collectionInputSchema, raw)

      return saveCollection(session.database, input)
    })

    return context.json({ collection }, 201)
  })

  app.put('/api/catalog/manage/collections/:id', async (context) => {
    const collection = await withCatalogImportAccess(context, dependencies.connectDatabase, async (session) => {
      const rawId = context.req.param('id')
      const id = parseInput(collectionIdSchema, rawId)
      const raw = await readJson(context.req.raw)
      const input = parseInput(collectionUpdateSchema, raw)

      return saveCollection(session.database, input, id)
    })

    return context.json({ collection })
  })

  app.delete('/api/catalog/manage/collections/:id', async (context) => {
    await withCatalogImportAccess(context, dependencies.connectDatabase, async (session) => {
      const rawId = context.req.param('id')
      const id = parseInput(collectionIdSchema, rawId)
      const raw = await readJson(context.req.raw)
      const input = parseInput(collectionDeleteSchema, raw)

      await deleteCollection(session.database, id, input.revision)
    })

    return context.body(null, 204)
  })
}

export { registerCatalogDiscoveryRoutes }
