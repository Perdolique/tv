import * as v from 'valibot'

import {
  titleRequestInputSchema,
  type RequestCard,
  type TitleRequest
} from '../../../packages/shared/src/catalog-requests.ts'

import { dune } from '../catalog/details.fixtures.ts'

import {
  exactMovie,
  longMovie,
  posterMovie,
  requestedMovie,
  requestedSeries,
  similarMovie,
  sourceCards,
  unbrokenMovie
} from './fixtures.ts'

interface RequestState {
  targets: Map<string, TitleRequest>;
  members: Map<string, Set<string>>;
}

const saved = new Map<string, RequestState>()

function cookieValue(request: Request, name: string): string | null {
  const cookies = request.headers.get('cookie') ?? ''
  const cookiePrefix = `${name}=`
  const entries = cookies.split(';')

  const cookie = entries.find(value => {
    const trimmed = value.trim()

    return trimmed.startsWith(cookiePrefix)
  })

  const trimmed = cookie?.trim()
  const value = trimmed?.slice(cookiePrefix.length)

  return value ?? null
}

function account(request: Request): string | null {
  const session = cookieValue(request, 'tv_session')
  const authenticated = session === 'e2e-session' || session === 'e2e-long-email-session'

  return authenticated ? session : null
}

function getState(request: Request): RequestState {
  const key = cookieValue(request, 'tv_viewing_state') ?? 'default'
  const existing = saved.get(key)

  if (existing !== undefined) { return existing }

  const targets = new Map<string, TitleRequest>()
  const members = new Map<string, Set<string>>()

  const state: RequestState = {
    targets,
    members
  }

  saved.set(key, state)

  return state
}

function getCard(type: 'movie' | 'series', tmdbId: number): RequestCard {
  const match = sourceCards.find(card => card.type === type && card.tmdbId === tmdbId)
  const fallback = type === 'movie' ? requestedMovie : requestedSeries

  return match ?? fallback
}

function searchCards(query: string, type: 'movie' | 'series'): readonly RequestCard[] {
  if (type === 'series') { return [requestedSeries] }

  if (query === 'Exact title') { return [exactMovie] }

  if (query === 'Similar title') { return [similarMovie] }

  if (query === 'Long source titles') { return [longMovie, unbrokenMovie] }

  if (query === 'Source artwork') { return [posterMovie, requestedMovie] }

  return [requestedMovie]
}

function listRequests(request: Request, manager: boolean): TitleRequest[] {
  const state = getState(request)
  const currentAccount = account(request)
  const entries = [...state.targets.values()]

  const visible = entries.filter(entry => {
    const members = state.members.get(entry.id)
    const requestedByAccount = currentAccount !== null && members?.has(currentAccount) === true

    return manager || requestedByAccount
  })

  return visible.map(entry => {
    const requesterCount = state.members.get(entry.id)?.size ?? 0

    return {
      id: entry.id,
      card: entry.card,
      createdAt: entry.createdAt,
      status: entry.status,
      catalogItemId: entry.catalogItemId,
      requesterCount
    }
  })
}

function handleTitleRequests(request: Request): Response | null {
  const url = new URL(request.url)
  const isPersonal = url.pathname.startsWith('/api/catalog/requests')
  const isManager = url.pathname === '/api/catalog/manage/requests'

  if (!isPersonal && !isManager) { return null }

  const currentAccount = account(request)

  if (currentAccount === null) { return Response.json({ error: { code: 'AUTHENTICATION_REQUIRED' } }, { status: 401 }) }

  const sourceType = url.searchParams.get('type')
  const type = sourceType === 'series' ? 'series' : 'movie'
  const isSearch = url.pathname.endsWith('/search')
  const isPreview = url.pathname.endsWith('/preview')

  if (isSearch) {
    const query = url.searchParams.get('query') ?? ''
    const cards = searchCards(query, type)

    const items = cards.map(card => { return {
      id: card.tmdbId,
      type: card.type,
      title: card.title,
      originalTitle: card.originalTitle,
      year: card.year,
      posterUrl: card.posterUrl
    } })

    return Response.json({
      items,
      nextPage: null
    })
  }

  if (isPreview) {
    const sourceId = url.searchParams.get('tmdbId')
    const tmdbId = Number(sourceId)
    const card = getCard(type, tmdbId)
    const catalogItemId = card.tmdbId === exactMovie.tmdbId ? dune.id : null

    const similar = card.tmdbId === similarMovie.tmdbId
      ? [{
        id: dune.id,
        title: dune.title,
        year: dune.releaseYear,
        type: dune.type
      }]
      : []

    return Response.json({
      card,
      similar,
      catalogItemId
    })
  }

  const hasManagerAccess = cookieValue(request, 'catalog_manager') === '1'

  if (isManager && !hasManagerAccess) {
    return Response.json({ error: { code: 'FORBIDDEN' } }, { status: 403 })
  }

  if (request.method === 'POST') { return null }

  const items = listRequests(request, isManager)

  return Response.json({
    items,
    nextPage: null
  })
}

async function submitTitleRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url)

  if (url.pathname !== '/api/catalog/requests' || request.method !== 'POST') { return null }

  const currentAccount = account(request)

  if (currentAccount === null) { return Response.json({}, { status: 401 }) }

  const raw: unknown = await request.json()
  const input = v.parse(titleRequestInputSchema, raw)
  const card = getCard(input.type, input.tmdbId)
  const state = getState(request)
  const identity = `${input.type}:${input.tmdbId}`
  const existing = state.targets.get(identity)
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()

  const entry: TitleRequest = existing ?? {
    id,
    card,
    createdAt,
    status: 'pending',
    catalogItemId: null,
    requesterCount: 1
  }

  const members = state.members.get(entry.id) ?? new Set<string>()
  const alreadyRequested = members.has(currentAccount)

  members.add(currentAccount)
  state.members.set(entry.id, members)
  state.targets.set(identity, entry)

  const status = alreadyRequested ? 200 : 201

  return Response.json({
    request: entry,
    catalogItemId: null
  }, { status })
}

export { handleTitleRequests, submitTitleRequest }
