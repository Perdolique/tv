/* oxlint-disable eslint/max-lines -- The browser fixture models one complete saved import workflow. */
import type {
  ImportEpisode,
  ImportOperationView,
  ImportPreviewView,
  ImportSelection
} from '../../../packages/shared/src/catalog-import.ts'

import { isRecord } from '../../../packages/shared/src/type-guards.ts'

const OPERATOR_ID = '40000000-0000-4000-8000-000000000065'
const PREVIEW_ID = '50000000-0000-4000-8000-000000000065'
const OPERATION_ID = '60000000-0000-4000-8000-000000000065'
const CATALOG_ID = '70000000-0000-4000-8000-000000000065'
const POSTER_ID = `tv-tv-perd-dev-movie-603-${'a'.repeat(64)}`
const POSTER_BYTES = Uint8Array.from(atob('UklGRjwAAABXRUJQVlA4IDAAAAAQAgCdASoBAAEAAgA0JaACdLoB+AH4AAPIAP7mad/7WgODVf5n//vvhRHbr/MUAAA='), character => character.codePointAt(0) ?? 0)
const createdAt = '2026-09-25T10:00:00.000Z'
const expiresAt = '2099-09-26T10:00:00.000Z'

interface ImportCaseState {
  preview: ImportPreviewView | null;
  operation: ImportOperationView | null;
}

const states = new Map<string, ImportCaseState>()

function cookieValue(request: Request, name: string): string | null {
  const entry = (request.headers.get('cookie') ?? '').split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))

  return entry?.slice(name.length + 1) ?? null
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers)

  responseHeaders.set('Cache-Control', 'no-store')

  return Response.json(body, {
    status,
    headers: responseHeaders
  })
}

function sourceIdentity(type: 'movie' | 'series', id: number) {
  return {
    provider: 'tmdb' as const,
    entityType: type === 'movie' ? 'movie' as const : 'tv' as const,
    externalId: String(id)
  }
}

// oxlint-disable-next-line eslint/max-params -- The fixture names the source, source ID, field, and saved value explicitly.
function field<Value>(type: 'movie' | 'series', id: number, name: string, value: Value) {
  return {
    value,

    source: {
      identity: sourceIdentity(type, id),
      field: name,
      locale: null
    }
  }
}

function createEpisode(index: number): ImportEpisode {
  const identity = {
    provider: 'tvmaze' as const,
    entityType: 'episode' as const,
    externalId: String(9001 + index)
  }

  const season = Math.floor(index / 10) + 1
  const number = index % 10 + 1
  const title = index === 0 ? 'Pilot' : `The Bridge: a long episode title for chapter ${index + 1}`

  return {
    identity,

    seasonNumber: {
      value: season,

      source: {
        identity,
        field: 'season',
        locale: null
      }
    },

    episodeNumber: {
      value: number,

      source: {
        identity,
        field: 'number',
        locale: null
      }
    },

    title: {
      value: title,

      source: {
        identity,
        field: 'name',
        locale: null
      }
    },

    airDate: {
      value: '2011-09-21',

      source: {
        identity,
        field: 'airdate',
        locale: null
      }
    }
  }
}

function createPreview(selection: ImportSelection, blocked: boolean, episodeCount: number): ImportPreviewView {
  const {type} = selection
  const hasSelectedShow = type === 'series' && selection.tvmaze.status === 'selected'
  const hasVerifiedAbsence = type === 'series' && selection.tvmaze.status === 'verified_absent'
  const id = selection.tmdbId
  const title = type === 'movie' ? 'The Return' : 'The Bridge'
  const identity = sourceIdentity(type, id)
  const matchingIds: ImportPreviewView['data']['evidence']['matchingIds'] = hasSelectedShow ? ['imdb', 'thetvdb'] : []
  const episodes = hasSelectedShow ? Array.from({ length: episodeCount }, (_value, index) => createEpisode(index)) : []
  const episodeExternalIds = episodes.map(episode => episode.identity.externalId)

  const warnings: ImportPreviewView['data']['warnings'] = hasVerifiedAbsence ? [{
    code: 'show_verified_absent',
    message: 'The operator verified that no matching TVMaze show exists.'
  }] : []

  return {
    id: PREVIEW_ID,
    status: blocked ? 'blocked' : 'ready',
    selection,
    createdAt,
    expiresAt,
    posterUrl: type === 'movie' ? `/api/catalog/imports/previews/${PREVIEW_ID}/poster` : null,

    matches: [{
      id: CATALOG_ID,
      title: 'The Return',
      year: 2003,
      type,
      kind: 'possible_title'
    }],

    data: {
      version: 2,

      card: {
        identity,
        type,
        originalTitle: field(type, id, 'original_title', title),
        originalLanguage: field(type, id, 'original_language', 'en'),
        releaseYear: field(type, id, 'release_year', type === 'movie' ? 2026 : 2011),

        translations: [{
          locale: 'en-US',
          language: 'en',
          title: field(type, id, 'title', title),
          description: field(type, id, 'overview', 'Saved source description')
        }],

        posterPath: field(type, id, 'poster_path', type === 'movie' ? '/poster.webp' : null)
      },

      episodes,

      evidence: {
        tmdb: {
          imdb: 'tt1234567',
          thetvdb: type === 'series' ? 100 : null
        },

        tvmaze: type === 'series' && selection.tvmaze.status === 'selected' ? {
          identity: {
            provider: 'tvmaze',
            entityType: 'show',
            externalId: String(selection.tvmaze.id)
          },

          name: 'The Bridge',
          premiered: '2011-09-21',
          language: 'English',

          externalIds: {
            imdb: 'tt1234567',
            thetvdb: 100
          },

          seasonRestriction: null
        } : null,

        matchingIds
      },

      warnings,

      errors: blocked ? [{
        code: 'catalog_changed',
        message: 'The catalog changed. Create a new preview.'
      }] : [],

      additions: {
        catalogItemId: null,
        createItem: true,
        episodeExternalIds,
        sourceLinks: [identity]
      },

      changes: [{
        target: 'title',
        field: 'title',
        locale: 'en-US',
        episodeExternalId: null,
        action: 'add',
        before: null,
        after: title,
        sourceValue: title,
        sourceHash: null,

        source: {
          identity,
          field: 'title',
          locale: 'en-US'
        }
      }],

      poster: type === 'movie' ? {
        sourceUrl: 'https://image.tmdb.org/t/p/original/poster.webp',
        sourceHash: 'a',
        sha256: 'b',
        contentType: 'image/webp',
        width: 1,
        height: 1,
        byteLength: POSTER_BYTES.byteLength
      } : null
    }
  }
}

function getState(request: Request): ImportCaseState {
  const caseId = cookieValue(request, 'import_case') ?? 'default'
  let state = states.get(caseId)

  if (state === undefined) {
    state = {
      preview: null,
      operation: null
    }

    states.set(caseId, state)
  }

  return state
}

function parseSelection(input: unknown): ImportSelection | null {
  if (!isRecord(input) || !Number.isSafeInteger(input.tmdbId) || Number(input.tmdbId) <= 0) {
    return null
  }

  const tmdbId = Number(input.tmdbId)

  if (input.type === 'movie') {
    return {
      type: 'movie',
      tmdbId
    }
  }

  if (input.type !== 'series' || !isRecord(input.tvmaze)) {
    return null
  }

  if (input.tvmaze.status === 'selected' && Number.isSafeInteger(input.tvmaze.id) && Number(input.tvmaze.id) > 0) {
    return {
      type: 'series',
      tmdbId,

      tvmaze: {
        status: 'selected',
        id: Number(input.tvmaze.id)
      }
    }
  }

  if (input.tvmaze.status === 'verified_absent' && typeof input.tvmaze.reason === 'string') {
    return {
      type: 'series',
      tmdbId,

      tvmaze: {
        status: 'verified_absent',
        reason: input.tvmaze.reason
      }
    }
  }

  return null
}

function createOperation(preview: ImportPreviewView, failed: boolean): ImportOperationView {
  return {
    id: OPERATION_ID,
    previewId: preview.id,
    operatorId: OPERATOR_ID,
    actor: 'viewer@example.com',
    selection: preview.selection,
    title: preview.data.card?.originalTitle.value ?? 'Imported title',
    status: failed ? 'failed' : 'succeeded',
    startedAt: createdAt,
    finishedAt: createdAt,

    result: failed ? null : {
      catalogItemId: CATALOG_ID,
      createdItem: true,
      createdEpisodes: preview.data.episodes.length,
      linkedSources: 1,
      changedFields: 1,
      updatedFields: 0,
      preservedFields: 0,
      posterPath: preview.selection.type === 'movie' ? `/api/posters/${POSTER_ID}.webp` : null
    },

    issue: failed ? {
      code: 'apply_failed',
      message: 'The import could not be completed. Try again.'
    } : null,

    canRetry: failed
  }
}

// oxlint-disable-next-line eslint/complexity -- The fake Worker dispatches the complete browser import contract in one auditable place.
async function handleImportRequest(request: Request, url: URL, authenticated: boolean): Promise<Response | null> {
  if (url.pathname === `/api/posters/${POSTER_ID}.webp`) {
    return new Response(POSTER_BYTES, { headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable'
    } })
  }

  if (!url.pathname.startsWith('/api/catalog/imports/')) {return null}

  if (url.pathname === '/api/catalog/imports/navigation' && request.method === 'GET') {
    return json({ allowed: authenticated && cookieValue(request, 'catalog_manager') === '1' })
  }

  if (!authenticated) {return json({ error: {
    code: 'AUTHENTICATION_REQUIRED',
    message: 'Authentication is required.'
  } }, 401)}

  if (cookieValue(request, 'catalog_manager') !== '1') {return json({ error: {
    code: 'FORBIDDEN',
    message: 'You do not have access to catalog imports.'
  } }, 403)}

  const state = getState(request)

  if (url.pathname === '/api/catalog/imports/access' && request.method === 'GET') {return json({ allowed: true })}

  if (url.pathname === '/api/catalog/imports/search' && request.method === 'GET') {
    if (cookieValue(request, 'import_source_failure') === '1') {
      return json({
        status: 'source_failure',

        issue: {
          code: 'source_unavailable',
          message: 'The source is temporarily unavailable.'
        },

        retryAfterSeconds: 12
      }, 503, { 'Retry-After': '12' })
    }

    const type = url.searchParams.get('type')
    const query = url.searchParams.get('query')?.toLowerCase() ?? ''
    const isFirstPage = url.searchParams.get('page') !== '2'
    const seriesId = isFirstPage ? 105_248 : 105_249
    const seriesYear = isFirstPage ? 2011 : 2013
    const isEmpty = query.includes('empty')
    const nextPage = type === 'series' && isFirstPage && !isEmpty ? 2 : null

    const items = type === 'movie' ? [
      {
        id: 603,
        type: 'movie',
        title: 'The Return',
        originalTitle: 'The Return',
        posterUrl: 'https://image.tmdb.org/t/p/w500/return.jpg',
        year: 2026
      },
      {
        id: 604,
        type: 'movie',
        title: 'The Return',
        originalTitle: 'Возвращение',
        posterUrl: null,
        year: 2003
      }
    ] : [{
      id: seriesId,
      type: 'series',
      title: 'The Bridge',
      originalTitle: isFirstPage ? 'Bron/Broen' : 'The Bridge',
      posterUrl: 'https://image.tmdb.org/t/p/w500/bridge.jpg',
      year: seriesYear
    }]

    const searchItems = isEmpty ? [] : items

    return json({
      items: searchItems,
      nextPage
    })
  }

  if (url.pathname === '/api/catalog/imports/shows' && request.method === 'GET') {
    return json({ items: [
      {
        id: 100,
        title: 'The Bridge',
        year: 2011,
        imdbId: 'tt1234567',
        thetvdbId: 100
      },
      {
        id: 101,
        title: 'The Bridge',
        year: 2013,
        imdbId: 'tt7654321',
        thetvdbId: 101
      }
    ] })
  }

  if (url.pathname === '/api/catalog/imports/previews' && request.method === 'POST') {
    const input: unknown = await request.json()
    const selection = parseSelection(input)

    if (selection === null) {
      return json({ error: { code: 'INVALID_REQUEST' } }, 400)
    }

    const episodeCount = cookieValue(request, 'import_long_series') === '1' ? 40 : 1

    state.preview = createPreview(selection, cookieValue(request, 'import_blocked') === '1', episodeCount)
    state.operation = null

    return json({ preview: state.preview }, 201)
  }

  if (url.pathname === '/api/catalog/imports/operations' && request.method === 'GET') {
    return json({
      items: state.operation === null ? [] : [state.operation],
      nextCursor: null
    })
  }

  if (url.pathname === `/api/catalog/imports/operations/${OPERATION_ID}` && request.method === 'GET') {
    if (state.operation?.status === 'pending' && state.preview !== null) {
      state.operation = createOperation(state.preview, false)
    }

    return state.operation === null ? json({ error: { code: 'NOT_FOUND' } }, 404) : json({ operation: state.operation })
  }

  if (url.pathname === `/api/catalog/imports/previews/${PREVIEW_ID}` && request.method === 'GET') {
    if (cookieValue(request, 'import_expired') === '1' || state.preview === null) {return json({ error: { code: 'NOT_FOUND' } }, 404)}

    return json({ preview: state.preview })
  }

  if (url.pathname === `/api/catalog/imports/previews/${PREVIEW_ID}/poster` && request.method === 'GET') {
    return state.preview === null ? json({ error: { code: 'NOT_FOUND' } }, 404) : new Response(POSTER_BYTES, { headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, no-store'
    } })
  }

  if (url.pathname === `/api/catalog/imports/previews/${PREVIEW_ID}/apply` && request.method === 'POST') {
    if (state.preview === null || cookieValue(request, 'import_conflict') === '1') {
      return json({
        status: 'blocked',
        operation: null,

        issue: {
          code: 'catalog_changed',
          message: 'Create a new preview.'
        }
      }, 409)
    }

    const body: unknown = await request.json()
    const retry = isRecord(body) && body.retry === true

    if (state.operation === null || (state.operation.status === 'failed' && retry)) {
      state.operation = createOperation(state.preview, state.operation === null && cookieValue(request, 'import_fail_once') === '1')

      if (state.operation.status === 'succeeded' && cookieValue(request, 'import_pending') === '1') {
        state.operation = {
          ...state.operation,
          status: 'pending',
          finishedAt: null,
          result: null
        }
      }
    }

    return json({
      status: state.operation.status,
      operation: state.operation,
      issue: state.operation.issue
    })
  }

  return json({ error: { code: 'NOT_FOUND' } }, 404)
}

export { handleImportRequest, OPERATOR_ID, POSTER_ID, PREVIEW_ID }
