/* oxlint-disable eslint/max-lines -- The browser service keeps one state model for viewings, scores, votes and marks. */
import * as v from 'valibot'
import { isRecord } from '../../../packages/shared/src/type-guards.ts'

import {
  catalogRatingSaveSchema,
  catalogRatingRemoveSchema,
  catalogHistoricalRatingSaveSchema,
  catalogHistoricalRatingRemoveSchema,
  catalogViewingCreateSchema,
  catalogViewingDeleteSchema,
  catalogViewingUpdateSchema,
  type CatalogViewing,
  type CatalogRatingMutationResponse
} from '../../../packages/shared/src/catalog-viewings.ts'

import {
  catalogSeriesWatchSchema,
  catalogSeriesUnwatchSchema,
  catalogSeriesCancelRewatchSchema
} from '../../../packages/shared/src/catalog-series.ts'

import { detailsItems } from './details.fixtures.ts'
import { episodeFixtures } from './episodes.fixtures.ts'

interface ViewingContext {
  currentViewingId: string | null;
  contextVersion: number;
}
interface Vote {
  score: number;
  sourceViewingId: string;
}
interface Watch {
  id: string;
  catalogEpisodeId: string;
  viewingId: string;
  markedAt: string;
}
interface Operation {
  action: string;
  input: string;
  viewingId: string | null;
  watchIds: string[];
  tombstoned: boolean;
}
interface RewatchOrigin {
  previousViewingId: string | null;
  previousStatus: 'watching' | 'completed' | null;
  previousCompletedOn: string | null;
  completedByStartOn: string | null;
  completionToken: string | null;
}
interface AccountStore {
  items: CatalogViewing[];
  contexts: Map<string, ViewingContext>;
  ratings: Map<string, number>;
  votes: Map<string, Vote>;
  watches: Watch[];
  operations: Map<string, Operation>;
  origins: Map<string, RewatchOrigin>;
  completionEvents: Map<string, string>;
}
interface BrowserStore {
  accounts: Map<string, AccountStore>;
}
interface Target {
  itemId: string;
  key: string;
  episodeId: string | null;
  seasonNumber: number | null;
}
interface RequestState {
  account: AccountStore;
  context: ViewingContext;
  target: Target;
  current: CatalogViewing | null;
  selected: CatalogViewing | null;
  actionTime: string;
}

const stores = new Map<string, BrowserStore>()
const fixedTime = '2026-09-22T13:00:00.123456Z'

function cookie(request: Request, name: string): string | null {
  const parts = request.headers.get('Cookie')?.split(';') ?? []
  const normalized = parts.map(part => part.trim())
  const prefix = `${name}=`
  const value = normalized.find(part => part.startsWith(prefix))

  return value?.slice(prefix.length) ?? null
}

function accountName(request: Request): string {
  return cookie(request, 'tv_session') === 'e2e-long-email-session' ? 'second' : 'first'
}

function ratingKey(viewingId: string, targetKey: string): string {
  return `${viewingId}:${targetKey}`
}

function contextFor(account: AccountStore, itemId: string): ViewingContext {
  let context = account.contexts.get(itemId)

  if (context === undefined) {
    context = {
      currentViewingId: null,
      contextVersion: 0
    }

    account.contexts.set(itemId, context)
  }

  return context
}

function viewingFor(account: AccountStore, itemId: string, viewingId: string | null): CatalogViewing | null {
  return account.items.find(item => item.catalogItemId === itemId && item.id === viewingId) ?? null
}

function seedViewing(account: AccountStore, itemId: string): CatalogViewing {
  const context = contextFor(account, itemId)
  const current = viewingFor(account, itemId, context.currentViewingId)

  if (current !== null) { return current }

  const title = detailsItems.find(item => item.id === itemId)
  const isMovie = title?.type === 'movie'

  const viewing: CatalogViewing = {
    id: itemId,
    catalogItemId: itemId,
    status: isMovie ? 'completed' : 'watching',
    startedOn: isMovie ? null : '2026-09-22',
    completedOn: isMovie ? '2026-09-22' : null,
    recordedAt: fixedTime,
    revision: 1,
    score: null,
    isRewatch: false,
    canCancelRewatch: false
  }

  account.items.push(viewing)

  context.currentViewingId = viewing.id
  context.contextVersion = 1

  return viewing
}

function seedScore(account: AccountStore, target: Target, score: number): void {
  const viewing = seedViewing(account, target.itemId)
  const key = ratingKey(viewing.id, target.key)

  account.ratings.set(key, score)

  account.votes.set(target.key, {
    score,
    sourceViewingId: viewing.id
  })

  if (target.key === target.itemId) { viewing.score = score }

  if (target.episodeId !== null) {
    account.watches.push({
      id: target.episodeId,
      catalogEpisodeId: target.episodeId,
      viewingId: viewing.id,
      markedAt: fixedTime
    })
  }
}

function cookieIds(request: Request, name: string): string[] {
  const value = cookie(request, name)

  return value === null || value === '' ? [] : value.split(',')
}

function newAccount(request: Request, accountNameValue: string): AccountStore {
  const account: AccountStore = {
    items: [],
    contexts: new Map(),
    ratings: new Map(),
    votes: new Map(),
    watches: [],
    operations: new Map(),
    origins: new Map(),
    completionEvents: new Map()
  }

  const watchedName = accountNameValue === 'second' ? 'tv_long_email_watched_item' : 'tv_watched_item'
  const episodeName = accountNameValue === 'second' ? 'tv_long_email_watched_episode' : 'tv_watched_episode'

  for (const id of cookieIds(request, watchedName)) { seedViewing(account, id) }

  for (const title of detailsItems) {
    const itemScoreCookie = `tv_rating_${accountNameValue}_${title.id}`
    const itemScore = cookie(request, itemScoreCookie)

    const target: Target = {
      itemId: title.id,
      key: title.id,
      seasonNumber: null,
      episodeId: null
    }

    if (itemScore !== null) {
      const score = Number(itemScore)

      seedScore(account, target, score)
    }

    const episodes = episodeFixtures.get(title.id) ?? []
    const seasonNumbers = episodes.map(episode => episode.seasonNumber)
    const seasons = new Set(seasonNumbers)

    for (const season of seasons) {
      const scoreCookie = `tv_season_rating_${accountNameValue}_${title.id}_${season}`
      const score = cookie(request, scoreCookie)
      const key = `${title.id}:season:${season}`

      const seasonTarget: Target = {
        itemId: title.id,
        key,
        seasonNumber: season,
        episodeId: null
      }

      if (score !== null) {
        const seasonScore = Number(score)

        seedScore(account, seasonTarget, seasonScore)
      }
    }

    for (const episode of episodes) {
      const scoreCookie = `tv_episode_rating_${accountNameValue}_${episode.id}`
      const score = cookie(request, scoreCookie)

      const episodeTarget: Target = {
        itemId: title.id,
        key: episode.id,
        seasonNumber: episode.seasonNumber,
        episodeId: episode.id
      }

      if (score !== null) {
        const episodeScore = Number(score)

        seedScore(account, episodeTarget, episodeScore)
      }

      const watched = cookieIds(request, episodeName)
      const hasMark = account.watches.some(watch => watch.catalogEpisodeId === episode.id)

      if (watched.includes(episode.id) && !hasMark) {
        const viewing = seedViewing(account, title.id)

        account.watches.push({
          id: episode.id,
          catalogEpisodeId: episode.id,
          viewingId: viewing.id,
          markedAt: fixedTime
        })
      }
    }
  }

  return account
}

function browserStore(request: Request): BrowserStore {
  const key = cookie(request, 'tv_viewing_state') ?? request.headers.get('Cookie') ?? 'guest'
  let store = stores.get(key)

  if (store === undefined) {
    store = { accounts: new Map() }

    stores.set(key, store)

    for (const account of ['first', 'second']) {
      const initialAccount = newAccount(request, account)

      store.accounts.set(account, initialAccount)
    }
  }

  return store
}

function accountStore(request: Request): AccountStore {
  const store = browserStore(request)
  const name = accountName(request)
  const account = store.accounts.get(name)

  if (account === undefined) { throw new Error('Browser account fixture is missing.') }

  return account
}

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  const result = new Headers(headers)

  result.set('Cache-Control', 'no-store')

  return Response.json(body, {
    status,
    headers: result
  })
}

function failure(status: number, fields?: Record<string, string>, headers?: HeadersInit): Response {
  const codes = new Map([[400, 'INVALID_REQUEST'], [401, 'AUTHENTICATION_REQUIRED'], [404, 'NOT_FOUND'], [409, 'CONFLICT']])
  const code = codes.get(status) ?? 'SERVICE_UNAVAILABLE'

  return response({ error: {
    code,
    message: 'The request could not be completed.',
    ...(fields === undefined ? {} : { fields })
  } }, status, headers)
}

function resolveTarget(url: URL): Target | null {
  const segments = url.pathname.split('/')

  if (segments[3] === 'episodes') {
    const episodeId = segments[4] ?? ''

    for (const [itemId, episodes] of episodeFixtures) {
      const episode = episodes.find(item => item.id === episodeId)

      if (episode !== undefined) {
        return {
        itemId,
        key: episodeId,
        episodeId,
        seasonNumber: episode.seasonNumber
      }
      }
    }

    return null
  }

  const itemId = segments[4] ?? ''
  const title = detailsItems.find(item => item.id === itemId)

  if (title === undefined) { return null }

  const seasonIndex = segments.indexOf('seasons')
  const seasonNumber = seasonIndex === -1 ? null : Number(segments[seasonIndex + 1])
  const episodeIndex = segments.indexOf('episodes', 5)
  const episodeId = segments[5] === 'viewings' && episodeIndex !== -1 ? segments[episodeIndex + 1] ?? null : null
  const episodes = episodeFixtures.get(itemId) ?? []
  const missingSeason = seasonNumber !== null && !episodes.some(episode => episode.seasonNumber === seasonNumber)
  const missingEpisode = episodeId !== null && !episodes.some(episode => episode.id === episodeId)

  if (missingSeason || missingEpisode) { return null }

  const key = episodeId ?? (seasonNumber === null ? itemId : `${itemId}:season:${seasonNumber}`)

  return {
    itemId,
    key,
    episodeId,
    seasonNumber
  }
}

function refreshCancellation(account: AccountStore): void {
  for (const viewing of account.items) {
    const origin = account.origins.get(viewing.id)
    const previousViewing = origin === undefined ? null : viewingFor(account, viewing.catalogItemId, origin.previousViewingId)
    const hasPredecessor = previousViewing !== null
    const hasMarks = account.watches.some(watch => watch.viewingId === viewing.id)
    const prefix = `${viewing.id}:`
    const ratingKeys = [...account.ratings.keys()]
    const hasScores = ratingKeys.some(key => key.startsWith(prefix))
    const current = contextFor(account, viewing.catalogItemId)

    viewing.canCancelRewatch = hasPredecessor && current.currentViewingId === viewing.id && !hasMarks && !hasScores
  }
}

function availableEpisode(state: RequestState, episodeId: string, input: Record<string, unknown>): boolean {
  const existing = state.account.watches.some(watch => watch.viewingId === state.selected?.id && watch.catalogEpisodeId === episodeId)

  if (existing) { return true }

  const episodes = episodeFixtures.get(state.target.itemId) ?? []
  const episode = episodes.find(item => item.id === episodeId)
  const timeZone = typeof input.timeZone === 'string' ? input.timeZone : 'UTC'

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })

  const actionAt = new Date(state.actionTime)
  const date = formatter.format(actionAt)

  return episode?.airDate !== null && episode?.airDate !== undefined && episode.airDate <= date
}

function summary(account: AccountStore, itemId: string) {
  refreshCancellation(account)

  const context = contextFor(account, itemId)
  const current = viewingFor(account, itemId, context.currentViewingId)
  const completed = account.items.filter(item => item.catalogItemId === itemId && item.status === 'completed')

  return {
    completedCount: completed.length,
    currentViewingId: context.currentViewingId,
    contextVersion: context.contextVersion,
    currentViewingScore: current?.score ?? null,
    currentVoteScore: account.votes.get(itemId)?.score ?? null
  }
}

function requestState(request: Request, url: URL, target: Target): RequestState {
  const account = accountStore(request)
  const context = contextFor(account, target.itemId)
  const current = viewingFor(account, target.itemId, context.currentViewingId)
  const segments = url.pathname.split('/')
  const historicalId = segments[5] === 'viewings' ? segments[6] ?? null : null
  const selectedId = historicalId ?? url.searchParams.get('viewingId') ?? context.currentViewingId
  const selected = viewingFor(account, target.itemId, selectedId)
  const fixedNow = cookie(request, 'tv_catalog_now')
  const capturedTime = fixedNow ?? Date.now()
  const captured = new Date(capturedTime)
  const timestamp = captured.toISOString()
  const actionTime = timestamp.replace('Z', '000Z')

  return {
    account,
    context,
    target,
    current,
    selected,
    actionTime
  }
}

function watchesResponse(state: RequestState) {
  const { account, selected } = state
  const watches = account.watches.filter(watch => watch.viewingId === selected?.id)
  const viewingSummary = summary(account, state.target.itemId)

  return {
    viewing: selected,
    watches,
    summary: viewingSummary
  }
}

function ratingResponse(state: RequestState, selected = state.selected): CatalogRatingMutationResponse {
  const { account, target } = state
  const key = selected === null ? null : ratingKey(selected.id, target.key)
  const score = key === null ? null : account.ratings.get(key) ?? null
  const viewingSummary = summary(account, target.itemId)

  const result: CatalogRatingMutationResponse = {
    score,
    viewing: selected,
    summary: viewingSummary
  }

  if (target.episodeId !== null && selected !== null) {
    result.watches = account.watches.filter(watch => watch.viewingId === selected.id)
  }

  return result
}

function publicSummary(request: Request, targetKey: string) {
  const store = browserStore(request)
  const accounts = [...store.accounts.values()]

  const scores = accounts.flatMap(account => {
    const vote = account.votes.get(targetKey)

    return vote === undefined ? [] : [vote.score]
  })

  const total = scores.reduce((sum, score) => sum + score, 0)
  const averageScore = scores.length === 0 ? null : total / scores.length

  return {
    averageScore,
    ratingCount: scores.length
  }
}

function currentContextMatches(state: RequestState, input: Record<string, unknown>): boolean {
  return input.currentViewingId === state.context.currentViewingId && input.contextVersion === state.context.contextVersion
}

function operationReplay(state: RequestState, input: Record<string, unknown>, action: string): 'new' | 'replay' | 'conflict' {
  if (typeof input.requestId !== 'string') { return 'conflict' }

  const previous = state.account.operations.get(input.requestId)

  if (previous === undefined) { return 'new' }

  const encodedInput = JSON.stringify(input)
  const sameInput = previous.input === encodedInput && previous.action === action
  const viewingExists = previous.viewingId === null || state.account.items.some(item => item.id === previous.viewingId)
  const marksExist = previous.watchIds.every(id => state.account.watches.some(watch => watch.id === id))

  return sameInput && !previous.tombstoned && viewingExists && marksExist ? 'replay' : 'conflict'
}

// oxlint-disable-next-line eslint/max-params -- A recorded result binds the request to both viewing and watch identities.
function recordOperation(state: RequestState, input: Record<string, unknown>, action: string, viewingId: string | null, watchIds: string[] = []): void {
  const requestId = String(input.requestId)
  const encoded = JSON.stringify(input)

  state.account.operations.set(requestId, {
    action,
    input: encoded,
    viewingId,
    watchIds,
    tombstoned: false
  })
}

function bump(state: RequestState, viewing: CatalogViewing): void {
  viewing.revision += 1

  if (viewing.id === state.context.currentViewingId) { state.context.contextVersion += 1 }
}

function createViewing(state: RequestState, values: Pick<CatalogViewing, 'status' | 'startedOn' | 'completedOn'>, makeCurrent: boolean): CatalogViewing {
  const title = detailsItems.find(item => item.id === state.target.itemId)
  const isRewatch = makeCurrent && title?.type === 'series' && state.current !== null
  const recordedAt = state.actionTime
  const id = crypto.randomUUID()

  const viewing: CatalogViewing = {
    id,
    catalogItemId: state.target.itemId,
    status: values.status,
    startedOn: values.startedOn,
    completedOn: values.completedOn,
    recordedAt,
    revision: 1,
    score: null,
    isRewatch,
    canCancelRewatch: isRewatch
  }

  state.account.items.push(viewing)

  if (title?.type === 'series' && viewing.status === 'completed') {
    const completionId = crypto.randomUUID()

    state.account.completionEvents.set(viewing.id, completionId)
  }

  if (makeCurrent) {
    state.context.currentViewingId = viewing.id
    state.context.contextVersion += 1
    state.current = viewing
    state.selected = viewing
  }

  return viewing
}

function ensureWatch(state: RequestState, viewing: CatalogViewing, episodeId: string): Watch {
  const previous = state.account.watches.find(watch => watch.viewingId === viewing.id && watch.catalogEpisodeId === episodeId)

  if (previous !== undefined) { return previous }

  const id = crypto.randomUUID()

  const watch = {
    id,
    catalogEpisodeId: episodeId,
    viewingId: viewing.id,
    markedAt: state.actionTime
  }

  state.account.watches.push(watch)

  viewing.canCancelRewatch = false

  return watch
}

function removeViewing(state: RequestState, viewing: CatalogViewing): void {
  for (const operation of state.account.operations.values()) {
    if (operation.viewingId === viewing.id) { operation.tombstoned = true }
  }

  state.account.completionEvents.delete(viewing.id)

  state.account.items = state.account.items.filter(item => item.id !== viewing.id)
  state.account.watches = state.account.watches.filter(watch => watch.viewingId !== viewing.id)

  const ratingPrefix = `${viewing.id}:`

  for (const key of state.account.ratings.keys()) {
    if (key.startsWith(ratingPrefix)) { state.account.ratings.delete(key) }
  }

  for (const [key, vote] of state.account.votes) {
    if (vote.sourceViewingId === viewing.id) { state.account.votes.delete(key) }
  }

  if (state.context.currentViewingId === viewing.id) {
    state.context.currentViewingId = null
    state.context.contextVersion += 1
    state.current = null
    state.selected = null
  } else { state.context.contextVersion += 1 }
}

// oxlint-disable-next-line eslint/complexity -- The fake endpoint keeps atomic first creation and target scoring visible together.
async function ratingMutation(request: Request, url: URL, state: RequestState): Promise<Response> {
  const raw: unknown = await request.json().catch(() => null)

  if (!isRecord(raw)) { return failure(400) }

  const action = `${request.method}:${url.pathname}`
  const replay = operationReplay(state, raw, action)

  if (replay === 'conflict') { return failure(409) }

  if (replay === 'replay') {
    const result = ratingResponse(state)

    return response(result)
  }

  const historical = url.pathname.includes('/viewings/')
  const currentSchema = request.method === 'PUT' ? catalogRatingSaveSchema : catalogRatingRemoveSchema
  const historicalSchema = request.method === 'PUT' ? catalogHistoricalRatingSaveSchema : catalogHistoricalRatingRemoveSchema
  const parsed = historical ? v.safeParse(historicalSchema, raw) : v.safeParse(currentSchema, raw)

  if (!parsed.success) { return failure(400) }

  const validContext = historical ? state.selected?.revision === raw.revision : currentContextMatches(state, raw)

  if (!validContext) { return failure(409) }

  const score = request.method === 'DELETE' ? null : raw.score

  if (score !== null && (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 10)) { return failure(400) }

  let viewing = state.selected

  if (score !== null && state.target.episodeId !== null && !availableEpisode(state, state.target.episodeId, raw)) { return failure(400) }

  if (viewing === null && score !== null) {
    if (historical || typeof raw.viewingDate !== 'string') { return failure(400) }

    const title = detailsItems.find(item => item.id === state.target.itemId)
    const isMovie = title?.type === 'movie'

    viewing = createViewing(state, {
      status: isMovie ? 'completed' : 'watching',
      startedOn: isMovie ? null : raw.viewingDate,
      completedOn: isMovie ? raw.viewingDate : null
    }, true)
  }

  const watch = viewing !== null && state.target.episodeId !== null && score !== null ? ensureWatch(state, viewing, state.target.episodeId) : null

  if (viewing !== null) {
    const key = ratingKey(viewing.id, state.target.key)

    if (score === null) { state.account.ratings.delete(key) } else { state.account.ratings.set(key, score) }

    if (state.target.key === state.target.itemId) { viewing.score = score }

    if (score !== null) { viewing.canCancelRewatch = false }

    bump(state, viewing)
  }

  if (!historical) {
    if (score === null) { state.account.votes.delete(state.target.key) } else if (viewing !== null) {
      state.account.votes.set(state.target.key, {
        score,
        sourceViewingId: viewing.id
      })
    }
  }

  const watchIds = watch === null ? [] : [watch.id]

  recordOperation(state, raw, action, viewing?.id ?? null, watchIds)

  const result = ratingResponse(state, viewing)

  return response(result)
}

// oxlint-disable-next-line eslint/complexity -- One handler mirrors creation, date changes, completion, reopening and deletion.
async function viewingMutation(request: Request, url: URL, state: RequestState): Promise<Response> {
  const raw: unknown = await request.json().catch(() => null)

  if (!isRecord(raw)) { return failure(400) }

  const action = `${request.method}:${url.pathname}`
  const replay = operationReplay(state, raw, action)

  if (replay === 'conflict') { return failure(409) }

  if (replay === 'replay') {
    const requestId = String(raw.requestId)
    const operation = state.account.operations.get(requestId)
    const viewing = viewingFor(state.account, state.target.itemId, operation?.viewingId ?? null)
    const viewingSummary = summary(state.account, state.target.itemId)

    if (request.method === 'DELETE') { return response({ summary: viewingSummary }) }

    return response({
      viewing,
      summary: viewingSummary
    })
  }

  if (request.method === 'POST') {
    const parsed = v.safeParse(catalogViewingCreateSchema, raw)

    if (!parsed.success) { return failure(400) }

    const input = parsed.output

    if (input.mode === 'current' && !currentContextMatches(state, input)) { return failure(409) }

    const title = detailsItems.find(item => item.id === state.target.itemId)
    const invalidMovie = title?.type === 'movie' && (input.status !== 'completed' || input.completedOn === null)
    const invalidSeries = title?.type === 'series' && input.startedOn === null

    if (invalidMovie || invalidSeries || (input.mode === 'history' && input.status === 'watching')) { return failure(400) }

    const previous = input.mode === 'current' ? state.current : null
    const previousPrefix = `${previous?.id}:`
    const hasPreviousMarks = state.account.watches.some(watch => watch.viewingId === previous?.id)
    const previousRatingKeys = [...state.account.ratings.keys()]
    const hasPreviousRatings = previousRatingKeys.some(key => key.startsWith(previousPrefix))
    const requiresActivity = previous !== null && (previous.status === 'watching' || previous.isRewatch)

    if (title?.type === 'series' && requiresActivity && !hasPreviousMarks && !hasPreviousRatings) {
      return failure(409, { currentViewingId: 'Add an episode mark or rating before starting another viewing.' })
    }

    const requiresCompletion = input.mode === 'current' && previous?.status === 'watching'

    if (requiresCompletion && (typeof input.completeCurrentOn !== 'string' || input.completeCurrentOn < (previous.startedOn ?? ''))) { return failure(400) }

    const origin: RewatchOrigin = {
      previousViewingId: previous?.id ?? null,
      previousStatus: previous?.status ?? null,
      previousCompletedOn: previous?.completedOn ?? null,
      completedByStartOn: requiresCompletion ? input.completeCurrentOn ?? null : null,
      completionToken: null
    }

    if (requiresCompletion) {
      previous.status = 'completed'
      previous.completedOn = input.completeCurrentOn ?? null
      previous.revision += 1
      origin.completionToken = crypto.randomUUID()

      state.account.completionEvents.set(previous.id, origin.completionToken)
    }

    const viewing = createViewing(state, input, input.mode === 'current')

    if (viewing.isRewatch && input.mode === 'current') { state.account.origins.set(viewing.id, origin) }

    recordOperation(state, raw, action, viewing.id)

    const viewingSummary = summary(state.account, state.target.itemId)

    return response({
      viewing,
      summary: viewingSummary
    })
  }

  const viewing = state.selected

  if (request.method === 'DELETE') {
    const parsed = v.safeParse(catalogViewingDeleteSchema, raw)

    if (!parsed.success) { return failure(400) }

    if (viewing !== null) {
      if (parsed.output.revision !== viewing.revision) { return failure(409) }

      recordOperation(state, raw, action, viewing.id)
      removeViewing(state, viewing)
    }

    const viewingSummary = summary(state.account, state.target.itemId)

    return response({ summary: viewingSummary })
  }

  if (viewing === null) { return failure(404) }

  const parsed = v.safeParse(catalogViewingUpdateSchema, raw)

  if (!parsed.success) { return failure(400) }

  const input = parsed.output

  if (input.revision !== viewing.revision) { return failure(409) }

  const title = detailsItems.find(item => item.id === state.target.itemId)
  const invalidMovie = title?.type === 'movie' && (input.status !== 'completed' || input.completedOn === null)
  const invalidSeries = title?.type === 'series' && input.startedOn === null

  if (invalidMovie || invalidSeries) { return failure(400) }

  const anotherWatching = state.account.items.some(item => item.catalogItemId === state.target.itemId && item.id !== viewing.id && item.status === 'watching')
  const reopening = viewing.status === 'completed' && input.status === 'watching'

  if (reopening && anotherWatching) { return failure(409) }

  const changed = viewing.status !== input.status || viewing.startedOn !== input.startedOn || viewing.completedOn !== input.completedOn

  if (reopening) {
    state.context.currentViewingId = viewing.id

    state.account.completionEvents.delete(viewing.id)
  }

  if (changed) {
    if (title?.type === 'series' && viewing.status === 'watching' && input.status === 'completed') {
      const completionId = crypto.randomUUID()

      state.account.completionEvents.set(viewing.id, completionId)
    }

    viewing.status = input.status
    viewing.startedOn = input.startedOn
    viewing.completedOn = input.completedOn
    viewing.revision += 1
    state.context.contextVersion += 1
  }

  recordOperation(state, raw, action, viewing.id)

  const viewingSummary = summary(state.account, state.target.itemId)

  return response({
    viewing,
    summary: viewingSummary
  })
}

async function watchesMutation(request: Request, url: URL, state: RequestState): Promise<Response> {
  const raw: unknown = await request.json().catch(() => null)

  if (!isRecord(raw)) { return failure(400) }

  const parsed = request.method === 'DELETE' ? v.safeParse(catalogSeriesUnwatchSchema, raw) : v.safeParse(catalogSeriesWatchSchema, raw)

  if (!parsed.success) { return failure(400) }

  const action = `${request.method}:${url.pathname}`
  const replay = operationReplay(state, raw, action)

  if (replay === 'conflict') { return failure(409) }

  if (replay === 'replay') {
    const result = watchesResponse(state)

    return response(result)
  }

  if (!currentContextMatches(state, raw)) { return failure(409) }

  let viewing = state.current

  if (request.method === 'DELETE') {
    const watch = state.account.watches.find(item => item.id === raw.watchId && item.viewingId === viewing?.id && item.catalogEpisodeId === state.target.episodeId)

    if (watch === undefined || viewing === null) { return failure(409) }

    const key = ratingKey(viewing.id, watch.catalogEpisodeId)
    const hasScore = state.account.ratings.has(key)

    if (hasScore && raw.confirmRatingRemoval !== true) { return failure(409, { confirmRatingRemoval: 'Confirm removing this rating.' }) }

    state.account.watches = state.account.watches.filter(item => item.id !== watch.id)

    state.account.ratings.delete(key)

    const vote = state.account.votes.get(watch.catalogEpisodeId)

    if (vote?.sourceViewingId === viewing.id) { state.account.votes.delete(watch.catalogEpisodeId) }

    bump(state, viewing)
    recordOperation(state, raw, action, viewing.id)

    const result = watchesResponse(state)

    return response(result)
  }

  if (viewing === null) {
    if (typeof raw.viewingDate !== 'string') { return failure(400) }

    viewing = createViewing(state, {
      status: 'watching',
      startedOn: raw.viewingDate,
      completedOn: null
    }, true)
  }

  const episodes = episodeFixtures.get(state.target.itemId) ?? []
  const inScope = state.target.episodeId === null ? episodes.filter(episode => state.target.seasonNumber === null || episode.seasonNumber === state.target.seasonNumber) : episodes.filter(episode => episode.id === state.target.episodeId)
  const targets = inScope.filter(episode => availableEpisode(state, episode.id, raw))
  const watches = targets.map(episode => ensureWatch(state, viewing, episode.id))
  const watchIds = watches.map(watch => watch.id)

  bump(state, viewing)
  recordOperation(state, raw, action, viewing.id, watchIds)

  const result = watchesResponse(state)

  return response(result)
}

async function cancelRewatch(request: Request, url: URL, state: RequestState): Promise<Response> {
  const raw: unknown = await request.json().catch(() => null)

  if (!isRecord(raw)) { return failure(400) }

  const parsed = v.safeParse(catalogSeriesCancelRewatchSchema, raw)

  if (!parsed.success) { return failure(400) }

  const action = `${request.method}:${url.pathname}`
  const replay = operationReplay(state, raw, action)

  if (replay === 'conflict') { return failure(409) }

  if (replay === 'replay') {
    const viewingSummary = summary(state.account, state.target.itemId)

    return response({ summary: viewingSummary })
  }

  if (!currentContextMatches(state, raw) || state.current?.canCancelRewatch !== true) { return failure(409) }

  const origin = state.account.origins.get(state.current.id)

  if (origin === undefined) { return failure(409) }

  const previous = viewingFor(state.account, state.target.itemId, origin.previousViewingId)

  if (previous === null) { return failure(409) }

  if (origin.completionToken !== null) {
    const event = state.account.completionEvents.get(previous.id)
    const corrected = previous.status !== 'completed' || previous.completedOn !== origin.completedByStartOn || event !== origin.completionToken

    if (corrected) { return failure(409, { currentViewingId: 'The previous viewing was corrected after this rewatch started.' }) }
  }

  removeViewing(state, state.current)

  state.context.currentViewingId = previous.id

  if (origin.completionToken !== null && origin.previousStatus !== null) {
    previous.status = origin.previousStatus
    previous.completedOn = origin.previousCompletedOn
    previous.revision += 1

    state.account.completionEvents.delete(previous.id)
  }

  recordOperation(state, raw, action, previous.id)

  const viewingSummary = summary(state.account, state.target.itemId)

  return response({ summary: viewingSummary })
}

function timelineItems(state: RequestState): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = []
  const title = detailsItems.find(item => item.id === state.target.itemId)
  const viewings = state.account.items.filter(item => item.catalogItemId === state.target.itemId)

  for (const viewing of viewings) {
    const isMovie = title?.type === 'movie'
    const date = isMovie ? viewing.completedOn : viewing.startedOn
    const occurredAt = `${date}T12:00:00.000Z`

    if (isMovie) {
      items.push({
        id: viewing.id,
        kind: 'movie_viewing',
        viewingId: viewing.id,
        occurredAt,
        startedOn: viewing.startedOn,
        completedOn: viewing.completedOn,
        score: viewing.score
      })
    } else {
      items.push({
        id: viewing.id,
        kind: viewing.isRewatch ? 'rewatch_started' : 'series_started',
        viewingId: viewing.id,
        occurredAt,
        startedOn: viewing.startedOn,
        score: viewing.score
      })

      if (viewing.status === 'completed') {
        const completionId = state.account.completionEvents.get(viewing.id)

        if (completionId === undefined) { throw new Error('A completed series viewing needs a completion event.') }

        const completionOccurredAt = `${viewing.completedOn}T12:00:00.000Z`

        items.push({
          id: completionId,
          kind: 'series_completed',
          viewingId: viewing.id,
          occurredAt: completionOccurredAt,
          completedOn: viewing.completedOn
        })
      }

      const watches = state.account.watches.filter(watch => watch.viewingId === viewing.id)
      const watchDates = watches.map(watch => watch.markedAt.slice(0, 10))
      const dates = new Set(watchDates)

      for (const localDate of dates) {
        const day = watches.filter(watch => watch.markedAt.startsWith(localDate))
        const episodes = episodeFixtures.get(state.target.itemId) ?? []
        const dayEpisodeIds = day.map(watch => watch.catalogEpisodeId)
        const episodeIds = new Set(dayEpisodeIds)
        const marked = episodes.filter(episode => episodeIds.has(episode.id))
        const markedSeasons = marked.map(episode => episode.seasonNumber)
        const seasonNumbers = new Set(markedSeasons)
        const uniqueSeasons = [...seasonNumbers]

        const seasons = uniqueSeasons.map(seasonNumber => {
          const matching = marked.filter(episode => episode.seasonNumber === seasonNumber)

          const ranges = matching.map(episode => {
            return {
            firstEpisodeNumber: episode.episodeNumber,
            lastEpisodeNumber: episode.episodeNumber
          }
          })

          return {
            seasonNumber,
            ranges
          }
        })

        const id = `episode_group:${viewing.id}:${localDate}`
        const groupOccurredAt = `${localDate}T12:00:00.000Z`

        items.push({
          id,
          kind: 'episode_group',
          viewingId: viewing.id,
          occurredAt: groupOccurredAt,
          localDate,
          totalCount: day.length,
          seasons
        })
      }
    }
  }

  return items.toSorted((left, right) => {
    const rightDate = String(right.occurredAt)
    const leftDate = String(left.occurredAt)
    const dateOrder = rightDate.localeCompare(leftDate)

    if (dateOrder !== 0) { return dateOrder }

    const rightId = String(right.id)
    const leftId = String(left.id)

    return rightId.localeCompare(leftId)
  })
}

async function failureCookie(request: Request, url: URL, authenticated: boolean): Promise<Response | null> {
  if (url.pathname.includes('/timeline')) { return authenticated ? null : failure(401) }

  const isPublic = /rating-summar(?:y|ies)$/u.test(url.pathname)
  const isRead = request.method === 'GET'
  const isWatches = url.pathname.includes('/watched')
  const isRating = url.pathname.endsWith('/rating')
  let expire = isRead ? 'expire_watched' : 'expire_watched_mutation'

  if (isWatches) { expire = isRead ? 'expire_episode_watches' : 'expire_episode_watched_mutation' }

  if (!isPublic && (!authenticated || cookie(request, expire) === '1')) {
    return failure(401, undefined, { 'Set-Cookie': 'tv_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax' })
  }

  let name = isRead ? 'fail_watched_load' : 'fail_watched'

  if (isWatches) { name = isRead ? 'fail_episode_watches_load' : 'fail_episode_watched' }

  if (isPublic) { name = 'fail_rating_summary' }

  const canFail = !isRating || !isRead

  if (canFail && cookie(request, name) === '1') {
    if (!isRead) {
      // oxlint-disable-next-line promise/avoid-new -- The service delay exposes the real pending UI before rollback.
      await new Promise(resolve => { globalThis.setTimeout(resolve, 500) })
    }

    const expiredCookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`

    return failure(503, undefined, { 'Set-Cookie': expiredCookie })
  }

  return null
}

// One browser diary owns all target scores and their source votes; HTTP handlers never keep independent ratings.
// oxlint-disable-next-line eslint/complexity -- The explicit dispatcher preserves all diary endpoint response shapes.
async function handleDiaryRequest(request: Request, url: URL, authenticated: boolean): Promise<Response | null> {
  const isDiaryRoute = /^\/api\/catalog\/(?:items\/[^/]+\/(?:viewings(?:\/[^/]+)?(?:\/(?:rating|seasons\/[^/]+\/rating|episodes\/[^/]+\/rating))?|rating(?:-summary)?|seasons\/[^/]+\/(?:rating(?:-summary)?|episodes\/rating(?:s|-summaries)|watched)|episodes\/watched|rewatch|timeline)|episodes\/[^/]+\/(?:rating(?:-summary)?|watched))$/u.test(url.pathname)

  if (!isDiaryRoute) { return null }

  const controlledFailure = await failureCookie(request, url, authenticated)

  if (controlledFailure !== null) { return controlledFailure }

  const target = resolveTarget(url)

  if (target === null) { return failure(404) }

  const state = requestState(request, url, target)
  const path = url.pathname

  if (url.searchParams.has('viewingId') && state.selected === null) { return failure(404) }

  if (/rating-summar(?:y|ies)$/u.test(path)) {
    if (cookie(request, 'large_rating_summary') === '1' && path.endsWith('/rating-summary')) {
      return response({
        averageScore: 10_798 / 1234,
        ratingCount: 1234
      })
    }

    if (path.endsWith('/rating-summaries')) {
      const episodes = episodeFixtures.get(target.itemId) ?? []
      const matching = episodes.filter(episode => episode.seasonNumber === target.seasonNumber)

      const items = matching.map(episode => {
        const publicRating = publicSummary(request, episode.id)

        return {
          episodeId: episode.id,
          averageScore: publicRating.averageScore,
          ratingCount: publicRating.ratingCount
        }
      })

      return response({ items })
    }

    const result = publicSummary(request, target.key)

    return response(result)
  }

  if (path.endsWith('/ratings')) {
    const episodes = episodeFixtures.get(target.itemId) ?? []
    const matching = episodes.filter(episode => episode.seasonNumber === target.seasonNumber)

    const items = matching.map(episode => {
      const key = state.selected === null ? null : ratingKey(state.selected.id, episode.id)
      const score = key === null ? null : state.account.ratings.get(key) ?? null

      return {
        episodeId: episode.id,
        score
      }
    })

    const viewingSummary = summary(state.account, target.itemId)

    return response({
      items,
      viewing: state.selected,
      summary: viewingSummary
    })
  }

  if (path.includes('/timeline')) {
    const items = timelineItems(state)

    return response({
      items,
      nextCursor: null
    })
  }

  if (path.endsWith('/rating')) {
    if (request.method === 'GET') {
      const result = ratingResponse(state)

      return response(result)
    }

    return ratingMutation(request, url, state)
  }

  if (path.endsWith('/watched')) {
    if (request.method === 'GET') {
      const result = watchesResponse(state)

      return response(result)
    }

    return watchesMutation(request, url, state)
  }

  if (path.endsWith('/rewatch')) { return cancelRewatch(request, url, state) }

  if (request.method !== 'GET') { return viewingMutation(request, url, state) }

  const pathSegments = url.pathname.split('/')

  if (pathSegments[6] !== undefined) {
    return state.selected === null ? failure(404) : response({ viewing: state.selected })
  }

  const matching = state.account.items.filter(item => item.catalogItemId === target.itemId)

  const all = matching.toSorted((left, right) => {
    const rightDate = right.completedOn ?? right.startedOn ?? ''
    const leftDate = left.completedOn ?? left.startedOn ?? ''
    const dateOrder = rightDate.localeCompare(leftDate)

    if (dateOrder !== 0) { return dateOrder }

    return right.id.localeCompare(left.id)
  })

  const cursor = url.searchParams.get('cursor')
  const offset = cursor === null ? 0 : all.findIndex(item => item.id === cursor) + 1
  const items = all.slice(offset, offset + 20)
  const nextCursor = offset + 20 < all.length ? items.at(-1)?.id ?? null : null
  const viewingSummary = summary(state.account, target.itemId)

  return response({
    items,
    summary: viewingSummary,
    nextCursor
  })
}

function movieViewings(request: Request): CatalogViewing[] {
  const account = accountStore(request)
  const movieIds = new Set<string>()

  for (const item of detailsItems) {
    if (item.type === 'movie') { movieIds.add(item.id) }
  }

  return account.items.filter(item => movieIds.has(item.catalogItemId))
}

function episodeWatches(request: Request): Watch[] {
  const account = accountStore(request)

  return account.watches
}

export { handleDiaryRequest, movieViewings, episodeWatches }
