/* oxlint-disable eslint/max-lines -- The fake Worker keeps the complete browser auth contract in one auditable test service. */
import { handleDiscoveryRequest } from '../catalog/discovery.worker.ts'
import { catalogItems } from '../catalog/fixtures.ts'
import { detailsItems, dune, russianDune } from '../catalog/details.fixtures.ts'
import { episodeFixtures } from '../catalog/episodes.fixtures.ts'
import { calendarReleases } from '../calendar/fixtures.ts'
import { watchlistItems } from '../watchlist/fixtures.ts'
import { paginatedHistory } from '../dashboard/fixtures.ts'
import { handleDiaryRequest, diaryViewings, episodeWatches } from '../catalog/viewings.worker.ts'
import { createViewingItems, createViewingSummary } from '../dashboard/service.ts'
import { longEmail } from './constants.ts'
import { handleImportRequest, OPERATOR_ID, POSTER_ID } from '../imports/worker.ts'

import {
  TURNSTILE_ACTIONS,
  TURNSTILE_RESPONSE_FIELD,
  type TurnstileAction
} from '../../../packages/shared/src/turnstile.ts'

import { isRecord } from '../../../packages/shared/src/type-guards.ts'

interface Credentials {
  email: string;
  password: string;
  turnstileToken: unknown;
}

interface RegistrationRequest {
  email: string;
  redirectTo: string;
  turnstileToken: unknown;
}

interface RegistrationCompletionRequest {
  password: string;
  token: string;
}

interface SafeErrorOptions {
  code:
    | 'BOT_VERIFICATION_FAILED'
    | 'INVALID_CREDENTIALS'
    | 'INVALID_REQUEST'
    | 'INVALID_VERIFICATION'
    | 'PASSWORD_COMPROMISED'
    | 'SERVICE_UNAVAILABLE';
  fields?: Record<string, string>;
  headers?: HeadersInit;
  message: string;
  status: number;
}

const AUTHENTICATED_USER = {
  email: 'viewer@example.com',
  id: OPERATOR_ID
} as const

const VALID_VERIFICATION_TOKEN = 'v'.repeat(43)
const CATALOG_VERIFICATION_TOKEN = 's'.repeat(43)
const COMPROMISED_VERIFICATION_TOKEN = 'c'.repeat(43)
const UNAVAILABLE_VERIFICATION_TOKEN = 'u'.repeat(43)
const SESSION_COOKIE = 'tv_session=e2e-session'
const LONG_EMAIL_SESSION_COOKIE = 'tv_session=e2e-long-email-session'
const FOLLOW_COOKIE_NAME = 'tv_followed_item'
const LONG_EMAIL_EMPTY_RELEASE_DATE = '2026-09-12'

const LONG_EMAIL_USER = {
  email: longEmail,
  id: 'user-e2e-long-email'
} as const

const usedTurnstileTokens = new Set<string>()
const expiredCatalogSessions = new Set<string>()

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers)

  responseHeaders.set('Cache-Control', 'no-store')
  responseHeaders.set('Content-Type', 'application/json')

  return Response.json(body, {
    headers: responseHeaders,
    status
  })
}

function safeError(options: SafeErrorOptions): Response {
  return json({
    error: {
      code: options.code,
      message: options.message,
      ...(options.fields === undefined ? {} : { fields: options.fields })
    }
  }, options.status, options.headers)
}

function hasCookie(request: Request, cookie: string): boolean {
  const cookieHeader = request.headers.get('Cookie') ?? ''

  return cookieHeader.split(';').some(value => value.trim() === cookie)
}

async function readCredentials(request: Request): Promise<Credentials | null> {
  // oxlint-disable-next-line eslint/init-declarations -- Invalid JSON is handled as a malformed request.
  let value: unknown

  try {
    value = await request.json()
  } catch {
    return null
  }

  if (
    !isRecord(value)
    || !('email' in value)
    || !('password' in value)
    || typeof value.email !== 'string'
    || typeof value.password !== 'string'
  ) {
    return null
  }

  return {
    email: value.email,
    password: value.password,
    turnstileToken: value[TURNSTILE_RESPONSE_FIELD]
  }
}

async function readRegistrationRequest(request: Request): Promise<RegistrationRequest | null> {
  const value: unknown = await request.json().catch(() => null)

  if (
    !isRecord(value)
    || !('email' in value)
    || !('redirectTo' in value)
    || typeof value.email !== 'string'
    || typeof value.redirectTo !== 'string'
  ) {
    return null
  }

  return {
    email: value.email,
    redirectTo: value.redirectTo,
    turnstileToken: value[TURNSTILE_RESPONSE_FIELD]
  }
}

async function readRegistrationCompletionRequest(
  request: Request
): Promise<RegistrationCompletionRequest | null> {
  const value: unknown = await request.json().catch(() => null)

  if (
    typeof value !== 'object'
    || value === null
    || !('password' in value)
    || !('token' in value)
    || typeof value.password !== 'string'
    || typeof value.token !== 'string'
  ) {
    return null
  }

  return {
    password: value.password,
    token: value.token
  }
}

function consumeTurnstileToken(
  value: unknown,
  expectedAction: TurnstileAction
): boolean {
  const expectedPrefix = `test-turnstile-${expectedAction}-`

  if (
    typeof value !== 'string'
    || !value.startsWith(expectedPrefix)
    || usedTurnstileTokens.has(value)
  ) {
    return false
  }

  usedTurnstileTokens.add(value)

  return true
}

function botVerificationError(): Response {
  return safeError({
    code: 'BOT_VERIFICATION_FAILED',
    message: 'Complete the security check and try again.',
    status: 403
  })
}

async function handleRegister(request: Request): Promise<Response> {
  const registration = await readRegistrationRequest(request)

  if (registration === null) {
    return safeError({
      code: 'INVALID_REQUEST',
      message: 'The request is invalid.',
      status: 400
    })
  }

  if (!consumeTurnstileToken(
    registration.turnstileToken,
    TURNSTILE_ACTIONS.register
  )) {
    return botVerificationError()
  }

  if (registration.email === 'registration-unavailable@example.com') {
    return safeError({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Authentication is temporarily unavailable.',
      status: 503
    })
  }

  return json({ status: 'accepted' }, 202)
}

async function handleRegistrationCompletion(request: Request): Promise<Response> {
  const completion = await readRegistrationCompletionRequest(request)

  if (completion === null) {
    return safeError({
      code: 'INVALID_REQUEST',
      message: 'The request is invalid.',
      status: 400
    })
  }

  if (completion.token === COMPROMISED_VERIFICATION_TOKEN) {
    return safeError({
      code: 'PASSWORD_COMPROMISED',

      fields: {
        password: 'Choose a password that has not appeared in a known data breach.'
      },

      message: 'Choose a password that has not appeared in a known data breach.',
      status: 400
    })
  }

  if (completion.token === UNAVAILABLE_VERIFICATION_TOKEN) {
    return safeError({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Authentication is temporarily unavailable.',
      status: 503
    })
  }

  if (completion.token !== VALID_VERIFICATION_TOKEN && completion.token !== CATALOG_VERIFICATION_TOKEN) {
    return safeError({
      code: 'INVALID_VERIFICATION',
      message: 'This verification link is invalid or has expired.',
      status: 400
    })
  }

  const redirectTo = completion.token === CATALOG_VERIFICATION_TOKEN ? '/?query=Dark' : '/?view=recent'

  return json({
    email: AUTHENTICATED_USER.email,
    redirectTo,
    status: 'created'
  }, 201)
}

async function handleSignIn(request: Request): Promise<Response> {
  const credentials = await readCredentials(request)

  if (
    credentials !== null
    && !consumeTurnstileToken(
      credentials.turnstileToken,
      TURNSTILE_ACTIONS.signIn
    )
  ) {
    return botVerificationError()
  }

  if (credentials?.email === 'unavailable@example.com') {
    return safeError({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Authentication is temporarily unavailable.',
      status: 503
    })
  }

  const isKnownEmail = credentials?.email === AUTHENTICATED_USER.email
    || credentials?.email === LONG_EMAIL_USER.email

  if (!isKnownEmail || credentials.password !== 'correct horse battery staple') {
    return safeError({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password.',
      status: 401
    })
  }

  const user = credentials.email === LONG_EMAIL_USER.email
    ? LONG_EMAIL_USER
    : AUTHENTICATED_USER

  const sessionCookie = credentials.email === LONG_EMAIL_USER.email
    ? LONG_EMAIL_SESSION_COOKIE
    : SESSION_COOKIE

  return json({ user }, 200, {
    'Set-Cookie': `${sessionCookie}; Path=/; HttpOnly; SameSite=Lax`
  })
}

function getExpiringSession(request: Request): string | undefined {
  const cookies = request.headers.get('Cookie') ?? ''

  return cookies.split(';').map(cookie => cookie.trim()).find(cookie => cookie.startsWith('tv_session=e2e-expiring-'))
}

function handleSession(request: Request): Response {
  const expiringSession = getExpiringSession(request)

  if (expiringSession !== undefined) {
    if (hasCookie(request, 'expire_catalog=1')) {
      expiredCatalogSessions.add(expiringSession)
    }

    const user = expiredCatalogSessions.has(expiringSession) ? null : AUTHENTICATED_USER

    return json({ user })
  }

  if (hasCookie(request, 'fail_session=2')) {
    return safeError({
      code: 'SERVICE_UNAVAILABLE',

      headers: {
        'Set-Cookie': 'fail_session=1; Path=/; SameSite=Lax'
      },

      message: 'Authentication is temporarily unavailable.',
      status: 503
    })
  }

  if (hasCookie(request, 'fail_session=1')) {
    return safeError({
      code: 'SERVICE_UNAVAILABLE',

      headers: {
        'Set-Cookie': 'fail_session=; Max-Age=0; Path=/; SameSite=Lax'
      },

      message: 'Authentication is temporarily unavailable.',
      status: 503
    })
  }

  if (hasCookie(request, LONG_EMAIL_SESSION_COOKIE)) {
    return json({ user: LONG_EMAIL_USER })
  }

  const user = hasCookie(request, SESSION_COOKIE) ? AUTHENTICATED_USER : null

  return json({ user })
}

function handleSignOut(request: Request): Response {
  if (hasCookie(request, 'fail_sign_out=1')) {
    return safeError({
      code: 'SERVICE_UNAVAILABLE',

      headers: {
        'Set-Cookie': 'fail_sign_out=; Max-Age=0; Path=/; SameSite=Lax'
      },

      message: 'Authentication is temporarily unavailable.',
      status: 503
    })
  }

  return new Response(null, {
    headers: {
      'Cache-Control': 'no-store',
      'Set-Cookie': 'tv_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax'
    },

    status: 204
  })
}

function hasAuthenticatedCatalogSession(request: Request): boolean {
  const expiringSession = getExpiringSession(request)

  return hasCookie(request, SESSION_COOKIE)
    || hasCookie(request, LONG_EMAIL_SESSION_COOKIE)
    || (expiringSession !== undefined && !expiredCatalogSessions.has(expiringSession))
}

async function handleCatalogSearch(request: Request, url: URL): Promise<Response> {
  if (hasCookie(request, 'fail_catalog=1')) {
    return json({ error: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'private database connection details'
    } }, 503, {
      'Set-Cookie': 'fail_catalog=; Max-Age=0; Path=/; SameSite=Lax'
    })
  }

  if (hasCookie(request, 'slow_catalog=1')) {
    // oxlint-disable-next-line promise/avoid-new -- Browser tests exercise real request cancellation against a delayed service.
    await new Promise(resolve => { globalThis.setTimeout(resolve, 1200) })
  }

  const query = (url.searchParams.get('query') ?? '').trim().normalize('NFC').toLowerCase()
  const items = catalogItems.filter(item => item.title.toLowerCase().includes(query))

  return json({ items })
}

async function handleCatalogWatchlist(request: Request): Promise<Response> {
  const expiringSession = getExpiringSession(request)
  const authenticated = hasAuthenticatedCatalogSession(request)

  if (!authenticated || hasCookie(request, 'expire_watchlist=1')) {
    if (expiringSession !== undefined) {
      expiredCatalogSessions.add(expiringSession)
    }

    return json({ error: {
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Authentication is required.'
    } }, 401, {
      'Set-Cookie': 'tv_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax'
    })
  }

  if (hasCookie(request, 'fail_watchlist=2')) {
    return json({ error: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'private database connection details'
    } }, 503, {
      'Set-Cookie': 'fail_watchlist=1; Path=/; SameSite=Lax'
    })
  }

  if (hasCookie(request, 'fail_watchlist=1')) {
    return json({ error: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'private database connection details'
    } }, 503, {
      'Set-Cookie': 'fail_watchlist=; Max-Age=0; Path=/; SameSite=Lax'
    })
  }

  if (hasCookie(request, 'slow_watchlist=1')) {
    // oxlint-disable-next-line promise/avoid-new -- Browser tests need a real pending private request.
    await new Promise(resolve => { globalThis.setTimeout(resolve, 1200) })
  }

  return json({
    items: hasCookie(request, 'empty_watchlist=1') ? [] : watchlistItems
  })
}

function compareNullableNumbers(left: number | null, right: number | null): number {
  if (left === null) {
    return right === null ? 0 : 1
  }

  return right === null ? -1 : left - right
}

function compareCalendarReleaseOrder(
  left: (typeof calendarReleases)[number],
  right: (typeof calendarReleases)[number]
): number {
  return left.releaseDate.localeCompare(right.releaseDate)
    || left.id.localeCompare(right.id)
    || compareNullableNumbers(left.seasonNumber, right.seasonNumber)
    || compareNullableNumbers(left.episodeNumber, right.episodeNumber)
    || left.releaseId.localeCompare(right.releaseId)
}

async function handleCatalogReleases(request: Request, url: URL): Promise<Response> {
  const expiringSession = getExpiringSession(request)
  const authenticated = hasAuthenticatedCatalogSession(request)

  if (!authenticated || hasCookie(request, 'expire_calendar=1')) {
    if (expiringSession !== undefined) {
      expiredCatalogSessions.add(expiringSession)
    }

    return json({ error: {
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Authentication is required.'
    } }, 401, {
      'Set-Cookie': 'tv_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax'
    })
  }

  if (hasCookie(request, 'fail_calendar=2')) {
    return json({ error: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'private database connection details'
    } }, 503, {
      'Set-Cookie': 'fail_calendar=1; Path=/; SameSite=Lax'
    })
  }

  if (hasCookie(request, 'fail_calendar=1')) {
    return json({ error: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'private database connection details'
    } }, 503, {
      'Set-Cookie': 'fail_calendar=; Max-Age=0; Path=/; SameSite=Lax'
    })
  }

  if (hasCookie(request, 'slow_calendar=1')) {
    // oxlint-disable-next-line promise/avoid-new -- Browser tests need a real pending calendar request.
    await new Promise(resolve => { globalThis.setTimeout(resolve, 1200) })
  }

  const from = url.searchParams.get('from') ?? ''
  const to = url.searchParams.get('to') ?? ''

  const accountReleases = hasCookie(request, LONG_EMAIL_SESSION_COOKIE)
    ? calendarReleases.filter(item => item.releaseDate !== LONG_EMAIL_EMPTY_RELEASE_DATE)
    : calendarReleases

  const items = hasCookie(request, 'empty_calendar=1')
    ? []
    : accountReleases
      .filter(item => item.releaseDate >= from && item.releaseDate <= to)
      .toSorted(compareCalendarReleaseOrder)

  return json({ items })
}

async function handleCatalogUpcomingReleases(request: Request, url: URL): Promise<Response> {
  const authenticated = hasAuthenticatedCatalogSession(request)

  if (!authenticated || hasCookie(request, 'expire_upcoming=1')) {
    return json({ error: {
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Authentication is required.'
    } }, 401, {
      'Set-Cookie': 'tv_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax'
    })
  }

  if (hasCookie(request, 'fail_upcoming=2')) {
    return json({ error: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'private database connection details'
    } }, 503, {
      'Set-Cookie': 'fail_upcoming=1; Path=/; SameSite=Lax'
    })
  }

  if (hasCookie(request, 'fail_upcoming=1')) {
    return json({ error: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'private database connection details'
    } }, 503, {
      'Set-Cookie': 'fail_upcoming=; Max-Age=0; Path=/; SameSite=Lax'
    })
  }

  const cursor = url.searchParams.get('cursor')

  if (cursor !== null && hasCookie(request, 'fail_upcoming_more=1')) {
    return json({ error: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'private database connection details'
    } }, 503, {
      'Set-Cookie': 'fail_upcoming_more=; Max-Age=0; Path=/; SameSite=Lax'
    })
  }

  if (hasCookie(request, 'slow_upcoming=1')) {
    // oxlint-disable-next-line promise/avoid-new -- Browser tests need a pending upcoming request for cancellation checks.
    await new Promise(resolve => { globalThis.setTimeout(resolve, 1200) })
  }

  if (hasCookie(request, 'empty_upcoming=1')) {
    return json({
      items: [],
      nextCursor: null
    })
  }

  const from = url.searchParams.get('from') ?? ''
  const startIndex = cursor === null ? 0 : Number(cursor)

  const matchingItems = calendarReleases
    .filter(item => item.releaseDate >= from)
    .toSorted(compareCalendarReleaseOrder)

  const pageItems = matchingItems.slice(startIndex, startIndex + 20)
  const nextIndex = startIndex + pageItems.length

  return json({
    items: pageItems,
    nextCursor: nextIndex < matchingItems.length ? String(nextIndex) : null
  })
}

function getCookieValue(request: Request, name: string): string | undefined {
  const cookies = request.headers.get('Cookie') ?? ''
  const prefix = `${name}=`
  const cookie = cookies.split(';').map(value => value.trim()).find(value => value.startsWith(prefix))

  return cookie?.slice(prefix.length)
}

async function handleCatalogFollow(request: Request, url: URL): Promise<Response> {
  const expiresDuringMutation = request.method !== 'GET' && hasCookie(request, 'expire_follow_mutation=1')

  if (!hasAuthenticatedCatalogSession(request) || hasCookie(request, 'expire_follow=1') || expiresDuringMutation) {
    return json({ error: {
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Authentication is required.'
    } }, 401, {
      'Set-Cookie': 'tv_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax'
    })
  }

  if (hasCookie(request, 'fail_follow_load=1')) {
    return json({ error: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'private database connection details'
    } }, 503, {
      'Set-Cookie': 'fail_follow_load=; Max-Age=0; Path=/; SameSite=Lax'
    })
  }

  if (hasCookie(request, 'fail_follow=1')) {
    // oxlint-disable-next-line promise/avoid-new -- The visible optimistic rollback requires a real pending request.
    await new Promise(resolve => { globalThis.setTimeout(resolve, 500) })

    return json({ error: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'private database connection details'
    } }, 503, {
      'Set-Cookie': 'fail_follow=; Max-Age=0; Path=/; SameSite=Lax'
    })
  }

  const id = url.pathname.split('/').at(-2)
  const item = detailsItems.find(candidate => candidate.id === id)

  if (item === undefined || id === undefined) {
    return json({ error: {
      code: 'NOT_FOUND',
      message: 'This title could not be found.'
    } }, 404)
  }

  if (request.method === 'PUT') {
    return json({ followed: true }, 200, {
      'Set-Cookie': `${FOLLOW_COOKIE_NAME}=${id}; Path=/; SameSite=Lax`
    })
  }

  if (request.method === 'DELETE') {
    return json({ followed: false }, 200, {
      'Set-Cookie': `${FOLLOW_COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax`
    })
  }

  return json({ followed: getCookieValue(request, FOLLOW_COOKIE_NAME) === id })
}

async function handleCatalogEpisodes(request: Request, url: URL): Promise<Response> {
  if (hasCookie(request, 'fail_episodes=1')) {
    return json({ error: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'private database connection details'
    } }, 503, {
      'Set-Cookie': 'fail_episodes=; Max-Age=0; Path=/; SameSite=Lax'
    })
  }

  if (hasCookie(request, 'slow_episodes=1')) {
    // oxlint-disable-next-line promise/avoid-new -- Browser tests exercise the independent public loading state.
    await new Promise(resolve => { globalThis.setTimeout(resolve, 1200) })
  }

  const id = url.pathname.split('/').at(-2)
  const item = detailsItems.find(candidate => candidate.id === id)

  if (item === undefined || id === undefined) {
    return json({ error: {
      code: 'NOT_FOUND',
      message: 'This title could not be found.'
    } }, 404)
  }

  return json({ items: episodeFixtures.get(id) ?? [] })
}

async function handleCatalogViewing(request: Request, url: URL): Promise<Response> {
  if (!hasAuthenticatedCatalogSession(request) || hasCookie(request, 'expire_viewing=1')) {
    return json({ error: {
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Authentication is required.'
    } }, 401, {
      'Set-Cookie': 'tv_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax'
    })
  }

  const isSummary = url.pathname.endsWith('viewing-summary')
  const failureCookie = isSummary ? 'fail_viewing_summary' : 'fail_viewing_history'
  const isMore = url.searchParams.has('cursor')
  const failMore = isMore && hasCookie(request, 'fail_viewing_more=1')

  if (hasCookie(request, `${failureCookie}=1`) || failMore) {
    const name = failMore ? 'fail_viewing_more' : failureCookie

    return json({ error: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'private database details'
    } }, 503, {
      'Set-Cookie': `${name}=; Max-Age=0; Path=/; SameSite=Lax`
    })
  }

  if (hasCookie(request, 'slow_viewing=1')) {
    // oxlint-disable-next-line promise/avoid-new -- A delayed service response exercises loading and cancellation.
    await new Promise(resolve => { globalThis.setTimeout(resolve, 1200) })
  }

  const watches = episodeWatches(request)

  // Diary state supplies every repeated mark and its identity to the dashboard.
  const viewings = diaryViewings(request)
  const items = hasCookie(request, 'paginated_viewing=1') ? paginatedHistory : createViewingItems(viewings)

  if (isSummary) {
    const summary = createViewingSummary(items, watches)

    return json(summary)
  }

  const status = url.searchParams.get('status')
  const filtered = status === null ? items : items.filter(item => item.status === status)
  const cursor = url.searchParams.get('cursor')

  const signatureData = JSON.stringify({
    status,
    locale: url.searchParams.get('titleLocale'),
    items: filtered
  })

  const bytes = new TextEncoder().encode(signatureData)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const signature = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  let position = -1

  if (cursor !== null) {
    const [cursorSignature, id] = cursor.split(':')

    position = filtered.findIndex(item => item.viewingId === id)

    if (cursorSignature !== signature || position === -1) {
      return json({ error: {
        code: 'INVALID_REQUEST',
        fields: { cursor: 'Your viewings changed. Refresh history.' }
      } }, 400)
    }
  }

  const page = filtered.slice(position + 1, position + 21)
  const last = page.at(-1)
  const hasMore = position + 21 < filtered.length

  return json({
    items: page,
    nextCursor: hasMore && last !== undefined ? `${signature}:${last.viewingId}` : null
  })
}

async function handleCatalogDetails(request: Request, url: URL): Promise<Response> {
  if (hasCookie(request, 'fail_details=1')) {
    return json({ error: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'private database connection details'
    } }, 503)
  }

  if (hasCookie(request, 'slow_details=1')) {
    // oxlint-disable-next-line promise/avoid-new -- A real delayed service response exercises browser transport cancellation.
    await new Promise(resolve => { globalThis.setTimeout(resolve, 1200) })
  }

  const id = url.pathname.split('/').at(-1)
  const item = detailsItems.find(candidate => candidate.id === id)

  if (item === undefined) {
    return json({ error: {
      code: 'NOT_FOUND',
      message: 'This title could not be found.'
    } }, 404)
  }

  const locale = url.searchParams.get('titleLocale') ?? 'en'
  const localized = id === dune.id && locale.startsWith('ru') ? russianDune : item

  if (id === dune.id && hasCookie(request, 'import_public_poster=1')) {
    return json({ item: {
      ...localized,
      posterUrl: `/api/posters/${POSTER_ID}.webp`,

      sources: [
        {
        provider: 'tmdb',
        url: 'https://www.themoviedb.org/movie/603'
      },
        {
        provider: 'tvmaze',
        url: 'https://www.tvmaze.com/shows/100'
      }
      ]
    } })
  }

  return json({ item: localized })
}

// oxlint-disable-next-line import/no-default-export -- Cloudflare Workers require a default entrypoint.
export default {
  // oxlint-disable-next-line eslint/complexity -- One explicit dispatcher keeps the fake service routes auditable.
  async fetch(request): Promise<Response> {
    const url = new URL(request.url)
    const authenticated = hasAuthenticatedCatalogSession(request)
    const importResponse = await handleImportRequest(request, url, authenticated)

    if (importResponse !== null) {return importResponse}

    const discoveryResponse = await handleDiscoveryRequest(request, url, authenticated)

    if (discoveryResponse !== null) { return discoveryResponse }

    const diaryResponse = await handleDiaryRequest(request, url, authenticated)

    if (diaryResponse !== null) { return diaryResponse }

    if (request.method === 'GET' && url.pathname.startsWith('/api/catalog/items/') && url.pathname.endsWith('/episodes')) {
      return handleCatalogEpisodes(request, url)
    }

    if (['GET', 'PUT', 'DELETE'].includes(request.method) && url.pathname.startsWith('/api/catalog/items/') && url.pathname.endsWith('/follow')) {
      return handleCatalogFollow(request, url)
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/catalog/items/')) {
      return handleCatalogDetails(request, url)
    }

    if (request.method === 'GET' && url.pathname === '/api/catalog/search') {
      return handleCatalogSearch(request, url)
    }

    if (request.method === 'GET' && ['/api/catalog/viewing-history', '/api/catalog/viewing-summary'].includes(url.pathname)) {
      return handleCatalogViewing(request, url)
    }

    if (request.method === 'GET' && url.pathname === '/api/catalog/watchlist') {
      return handleCatalogWatchlist(request)
    }

    if (request.method === 'GET' && url.pathname === '/api/catalog/releases/upcoming') {
      return handleCatalogUpcomingReleases(request, url)
    }

    if (request.method === 'GET' && url.pathname === '/api/catalog/releases') {
      return handleCatalogReleases(request, url)
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/register') {
      return handleRegister(request)
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/register/complete') {
      return handleRegistrationCompletion(request)
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/sign-in') {
      return handleSignIn(request)
    }

    if (request.method === 'GET' && url.pathname === '/api/auth/session') {
      return handleSession(request)
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/sign-out') {
      return handleSignOut(request)
    }

    return json({ error: 'Not found' }, 404)
  }
} satisfies ExportedHandler
