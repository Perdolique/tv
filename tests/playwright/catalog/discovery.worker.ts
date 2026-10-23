import * as v from 'valibot'

import {
  collectionInputSchema,
  collectionDeleteSchema,
  collectionUpdateSchema,
  type CatalogCollection,
  type CatalogDiscoveryItem
} from '../../../packages/shared/src/catalog-discovery.ts'

import { discoveryCollection, discoveryItems } from './discovery.fixtures.ts'
import { detailsItems } from './details.fixtures.ts'

interface SavedCollection {
  collection: CatalogCollection;
  items: CatalogDiscoveryItem[];
}

const states = new Map<string, SavedCollection[]>()

function cookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('Cookie') ?? ''
  const parts = header.split(';')
  const trimmed = parts.map(part => part.trim())
  const prefix = `${name}=`
  const found = trimmed.find(part => part.startsWith(prefix))

  return found?.slice(prefix.length)
}
function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  })
}
function error(status: number): Response {
  const codes: Record<number, string> = {
    401: 'AUTHENTICATION_REQUIRED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT'
  }

  const code = codes[status] ?? 'INVALID_REQUEST'

  return json({ error: {
    code,
    message: 'The collection request failed.'
  } }, status)
}

// oxlint-disable-next-line eslint/complexity -- This isolated fake Worker dispatches the complete collection HTTP contract for browser tests.
async function handleDiscoveryRequest(request: Request, url: URL, authenticated: boolean): Promise<Response | null> {
  const related = /^\/api\/catalog\/items\/(?<id>[^/]+)\/collections$/u.exec(url.pathname)
  const managed = url.pathname.startsWith('/api/catalog/manage/collections')
  const publicCollection = /^\/api\/catalog\/collections\/(?<id>[^/]+)$/u.exec(url.pathname)
  const discovery = url.pathname.startsWith('/api/catalog/discovery')

  if (!related && !managed && !publicCollection && !discovery) { return null }

  if (managed && !authenticated) { return error(401) }

  const manager = cookie(request, 'catalog_manager') === '1'

  if (managed && !manager) { return error(403) }

  const key = cookie(request, 'tv_viewing_state') ?? 'anonymous'
  const enabled = cookie(request, 'catalog_discovery') === '1'
  let collections = states.get(key)

  if (collections === undefined) {
    const initialCollection = structuredClone(discoveryCollection)
    const initialItems = discoveryItems.map(item => structuredClone(item))

    collections = enabled ? [{
      collection: initialCollection,
      items: initialItems
    }] : []

    states.set(key, collections)
  }

  const cards = enabled ? discoveryItems : []

  if (url.pathname === '/api/catalog/discovery') {
    const topRated = cards.slice(0, 3)
    const featured = collections.filter(entry => entry.collection.isFeatured)

    return json({
      recent: cards,
      topRated,
      collections: featured
    })
  }

  if (discovery) {
    return json({
    items: cards,
    nextPage: null
  })
  }

  if (related) {
    const relatedCollections = collections.filter(entry => entry.items.some(item => item.id === related.groups?.id))

    return json({ collections: relatedCollections })
  }

  if (publicCollection) {
    const found = collections.find(entry => entry.collection.id === publicCollection.groups?.id)

    if (found === undefined) { return error(404) }

    return json({
      collection: found.collection,
      items: found.items,
      nextPage: null
    })
  }

  const segments = url.pathname.split('/')
  const id = segments.at(5)

  if (request.method === 'GET') {
    if (id === undefined) {
      const managedCollections = collections.map(entry => entry.collection)

      return json({
      collections: managedCollections,
      nextPage: null
    })
    }

    const found = collections.find(entry => entry.collection.id === id)

    if (found === undefined) { return error(404) }

    return json({
      collection: found.collection,
      items: found.items,
      nextPage: null
    })
  }

  const raw: unknown = await request.json()
  const existing = collections.find(entry => entry.collection.id === id)

  if (request.method === 'DELETE') {
    const parsed = v.safeParse(collectionDeleteSchema, raw)

    if (!parsed.success || existing === undefined || parsed.output.revision !== existing.collection.revision) { return error(409) }

    const retainedCollections = collections.filter(entry => entry !== existing)

    states.set(key, retainedCollections)

    return new Response(null, { status: 204 })
  }

  const schema = request.method === 'POST' ? collectionInputSchema : collectionUpdateSchema
  const parsed = v.safeParse(schema, raw)

  if (!parsed.success) { return error(400) }

  if (request.method === 'PUT' && (existing === undefined || !('revision' in parsed.output) || parsed.output.revision !== existing.collection.revision)) { return error(409) }

  const input = parsed.output
  const items: CatalogDiscoveryItem[] = []

  for (const itemId of input.itemIds) {
    const item = detailsItems.find(candidate => candidate.id === itemId)

    if (item === undefined) { return error(400) }

    items.push({
      id: item.id,
      title: item.title,
      titleLocale: item.titleLocale,
      originalTitle: item.originalTitle,
      originalTitleLocale: item.originalTitleLocale,
      releaseYear: item.releaseYear,
      type: item.type,
      posterUrl: item.posterUrl,
      averageScore: null,
      ratingCount: 0
    })
  }

  const collection: CatalogCollection = {
    id: existing?.collection.id ?? crypto.randomUUID(),
    title: input.title,
    description: input.description,
    isFeatured: input.isFeatured,
    revision: (existing?.collection.revision ?? 0) + 1
  }

  const entry = {
    collection,
    items
  }

  const retainedCollections = collections.filter(candidate => candidate !== existing)

  states.set(key, [...retainedCollections, entry])

  const status = request.method === 'POST' ? 201 : 200

  return json({ collection }, status)
}

export { handleDiscoveryRequest }
