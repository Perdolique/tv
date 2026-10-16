import * as v from 'valibot'

import {
  catalogViewingCreateSchema,
  catalogMovieRatingSaveSchema,
  catalogMovieRatingRemoveSchema,
  catalogViewingRatingSaveSchema,
  catalogViewingRatingRemoveSchema,
  catalogViewingDeleteSchema,
  catalogViewingUpdateSchema,
  type CatalogViewing
} from '../../../packages/shared/src/catalog-viewings.ts'

import { detailsItems } from './details.fixtures.ts'

interface ViewingContext {
  currentViewingId: string | null;
  contextVersion: number;
}
interface Creation {
  input: string;
  viewingId: string;
}
interface Store {
  items: CatalogViewing[];
  contexts: Map<string, ViewingContext>;
  creations: Map<string, Creation>;
  votes: Map<string, number | null>;
}

interface ViewingRequestOptions {
  authenticated: boolean;
  movieIds: Set<string>;
}

const stores = new Map<string, Store>()

function cookie(request: Request, name: string): string | null {
  const parts = request.headers.get('Cookie')?.split(';') ?? []
  const normalized = parts.map(part => part.trim())
  const prefix = `${name}=`
  const value = normalized.find(part => part.startsWith(prefix))

  return value?.slice(name.length + 1) ?? null
}
function storeKey(request: Request): string | null {
  const id = cookie(request, 'tv_viewing_state')
  const session = cookie(request, 'tv_session')

  return id === null ? null : `${session}:${id}`
}
function legacyItems(movieIds: Set<string>): CatalogViewing[] {
  return [...movieIds].map(id => {
    return {
      id,
      catalogItemId: id,
      status: 'completed',
      startedOn: null,
      completedOn: null,
      recordedAt: '2026-09-22T13:00:00.123456Z',
      revision: 1,
      score: null
    }
  })
}
function movieViewings(request: Request, movieIds: Set<string>): CatalogViewing[] {
  const key = storeKey(request)

  return (key === null ? undefined : stores.get(key)?.items) ?? legacyItems(movieIds)
}
function movieVote(request: Request, catalogItemId: string): number | null {
  const key = storeKey(request)
  const store = key === null ? undefined : stores.get(key)

  if (store?.votes.has(catalogItemId) === true) { return store.votes.get(catalogItemId) ?? null }

  const account = cookie(request, 'tv_session') === 'e2e-long-email-session' ? 'second' : 'first'
  const value = cookie(request, `tv_rating_${account}_${catalogItemId}`)

  return value === null ? null : Number(value)
}
function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  const result = new Headers(headers)

  result.set('Cache-Control', 'no-store')

  return Response.json(body, {
    status,
    headers: result
  })
}
function failure(status: number, headers?: HeadersInit): Response {
  const code = status === 401 ? 'AUTHENTICATION_REQUIRED' : 'SERVICE_UNAVAILABLE'

  return response({ error: {
    code: status === 409 ? 'CONFLICT' : code,
    message: 'The request could not be completed.'
  } }, status, headers)
}

// oxlint-disable-next-line eslint/complexity -- The test service mirrors five small viewing endpoint branches.
async function handleMovieViewings(request: Request, url: URL, options: ViewingRequestOptions): Promise<Response> {
  const { authenticated, movieIds } = options
  const expiredRead = cookie(request, 'expire_watched')
  const expiredMutation = request.method === 'GET' ? null : cookie(request, 'expire_watched_mutation')

  if (!authenticated || expiredRead === '1' || expiredMutation === '1') {
    return failure(401, { 'Set-Cookie': 'tv_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax' })
  }

  const failureCookie = request.method === 'GET' ? 'fail_watched_load' : 'fail_watched'
  const shouldFail = cookie(request, failureCookie)

  if (shouldFail === '1') {
    return failure(503, { 'Set-Cookie': `${failureCookie}=; Max-Age=0; Path=/; SameSite=Lax` })
  }

  const segments = url.pathname.split('/')
  const catalogItemId = segments[4] ?? ''
  const viewingId = segments.at(6)
  const title = detailsItems.find(item => item.id === catalogItemId && item.type === 'movie')

  if (title === undefined) {
    return failure(404)
  }

  const existingKey = storeKey(request)
  const stateId = cookie(request, 'tv_viewing_state') ?? crypto.randomUUID()
  const session = cookie(request, 'tv_session')
  const key = existingKey ?? `${session}:${stateId}`
  const headers = new Headers({ 'Set-Cookie': `tv_viewing_state=${stateId}; Path=/; SameSite=Lax` })
  let store = stores.get(key)

  if (store === undefined) {
    const items = legacyItems(movieIds)

    const contextEntries = items.map(item => [item.catalogItemId, {
      currentViewingId: item.id,
      contextVersion: 1
    }] as const)

    const contexts = new Map(contextEntries)

    store = {
      items,
      contexts,
      creations: new Map(),
      votes: new Map()
    }

    stores.set(key, store)
  }

  const context = store.contexts.get(catalogItemId) ?? {
    currentViewingId: null,
    contextVersion: 0
  }

  store.contexts.set(catalogItemId, context)

  const items = () => {
    const matching = store.items.filter(item => item.catalogItemId === catalogItemId)

    return matching.toSorted((left, right) => right.recordedAt.localeCompare(left.recordedAt) || right.id.localeCompare(left.id))
  }

  const summary = () => {
    const matching = items()

    return {
      currentViewingId: context.currentViewingId,
      contextVersion: context.contextVersion,
      completedCount: matching.length,
      currentViewingScore: matching.find(item => item.id === context.currentViewingId)?.score ?? null,
      currentVoteScore: store.votes.has(catalogItemId) ? store.votes.get(catalogItemId) ?? null : movieVote(request, catalogItemId)
    }
  }

  const target = store.items.find(item => item.id === viewingId && item.catalogItemId === catalogItemId)

  if (request.method === 'GET') {
    if (viewingId !== undefined) {
      return target === undefined ? failure(404) : response({ viewing: target }, 200, headers)
    }

    const cursor = url.searchParams.get('cursor')
    const all = items()
    const offset = cursor === null ? 0 : all.findIndex(item => item.id === cursor) + 1
    const page = all.slice(offset, offset + 20)

    return response({
      items: page,
      summary: summary(),
      nextCursor: offset + 20 < all.length ? page.at(-1)?.id : null
    }, 200, headers)
  }

  const body: unknown = await request.json().catch(() => null)
  const isCurrentRating = segments[5] === 'rating'
  const isHistoricalRating = segments[7] === 'rating'
  const account = cookie(request, 'tv_session') === 'e2e-long-email-session' ? 'second' : 'first'
  const voteCookie = `tv_rating_${account}_${catalogItemId}`

  const saveVote = (score: number | null) => {
    store.votes.set(catalogItemId, score)

    const value = score === null ? '; Max-Age=0' : String(score)

    headers.append('Set-Cookie', `${voteCookie}=${value}; Path=/; SameSite=Lax`)
  }

  if (isCurrentRating) {
    const parsed = request.method === 'PUT' ? v.safeParse(catalogMovieRatingSaveSchema, body) : v.safeParse(catalogMovieRatingRemoveSchema, body)

    if (!parsed.success) { return failure(400) }

    if (parsed.output.currentViewingId !== context.currentViewingId || parsed.output.contextVersion !== context.contextVersion) { return failure(409) }

    const score = request.method === 'PUT' ? v.parse(catalogMovieRatingSaveSchema, body).score : null
    const current = store.items.find(item => item.id === context.currentViewingId) ?? null
    const previousVote = summary().currentVoteScore
    const changed = (current !== null && current.score !== score) || previousVote !== score

    if (current !== null && current.score !== score) { current.score = score; current.revision += 1 }

    if (changed) { context.contextVersion += 1 }

    saveVote(score)

    return response({
      score,
      viewing: current,
      summary: summary()
    }, 200, headers)
  }

  if (isHistoricalRating) {
    const parsed = request.method === 'PUT' ? v.safeParse(catalogViewingRatingSaveSchema, body) : v.safeParse(catalogViewingRatingRemoveSchema, body)

    if (!parsed.success) { return failure(400) }

    if (target === undefined) { return failure(404) }

    const score = request.method === 'PUT' ? v.parse(catalogViewingRatingSaveSchema, body).score : null

    if (target.id === context.currentViewingId || (target.revision !== parsed.output.revision && target.score !== score)) { return failure(409) }

    if (target.score !== score) { target.score = score; target.revision += 1 }

    return response({
      viewing: target,
      summary: summary()
    }, 200, headers)
  }

  if (request.method === 'POST') {
    const parsed = v.safeParse(catalogViewingCreateSchema, body)

    if (!parsed.success) { return failure(400) }

    const input = parsed.output
    const creation = store.creations.get(input.requestId)

    if (creation !== undefined) {
      const previous = store.items.find(item => item.id === creation.viewingId)
      const encodedInput = JSON.stringify(input)

      return creation.input === encodedInput && previous !== undefined
        ? response({
          viewing: previous,
          summary: summary()
        }, 200, headers) : failure(409)
    }

    if (input.mode === 'current' && input.contextVersion !== context.contextVersion) { return failure(409) }

    const now = new Date()
    const isoTime = now.toISOString()
    const recordedAt = isoTime.replace('Z', '000Z')

    const viewing: CatalogViewing = {
      id: crypto.randomUUID(),
      catalogItemId,
      status: 'completed',
      startedOn: input.startedOn,
      completedOn: input.completedOn,
      recordedAt,
      revision: 1,
      score: input.score ?? null
    }

    store.items.push(viewing)

    store.creations.set(input.requestId, {
      viewingId: viewing.id,
      input: JSON.stringify(input)
    })

    if (input.mode === 'current') {
      context.currentViewingId = viewing.id
      context.contextVersion += 1

      if (input.score !== undefined) { saveVote(input.score) }
    }

    return response({
      viewing,
      summary: summary()
    }, 200, headers)
  }

  if (request.method === 'DELETE') {
    const parsed = v.safeParse(catalogViewingDeleteSchema, body)

    if (!parsed.success) { return failure(400) }

    if (target !== undefined && target.revision !== parsed.output.revision) { return failure(409) }

    store.items = store.items.filter(item => item !== target)

    if (context.currentViewingId === viewingId) {
      context.currentViewingId = null
      context.contextVersion += 1
    }

    return response({ summary: summary() }, 200, headers)
  }

  const parsed = v.safeParse(catalogViewingUpdateSchema, body)

  if (!parsed.success || target === undefined) { return failure(400) }

  if (target.startedOn !== parsed.output.startedOn || target.completedOn !== parsed.output.completedOn) {
    if (target.revision !== parsed.output.revision) { return failure(409) }

    target.startedOn = parsed.output.startedOn
    target.completedOn = parsed.output.completedOn
    target.revision += 1
  }

  return response({
    viewing: target,
    summary: summary()
  }, 200, headers)
}

export { handleMovieViewings, movieViewings, movieVote }
