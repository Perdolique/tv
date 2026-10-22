/* oxlint-disable eslint/max-lines -- One title owner coordinates confirmed context, immutable retries and historical viewings. */
import { useRequestFetch } from '#app'

import {
  catalogViewingsResponseSchema,
  catalogViewingDeletionResponseSchema,
  catalogViewingResponseSchema,
  catalogViewingMutationResponseSchema,
  catalogRatingMutationResponseSchema,
  catalogEpisodeWatchSchema,
  type CatalogViewing,
  type CatalogViewingDraft,
  type CatalogViewingsResponse,
  type CatalogViewingSummary
} from '@tv/shared/catalog-viewings'

import { catalogSeriesWatchesResponseSchema, type CatalogSeriesEpisodeWatch } from '@tv/shared/catalog-series'
import { isRecord } from '@tv/shared/type-guards'
import { computed, onScopeDispose, ref, shallowRef, toRef, watch, type Ref } from 'vue'
import * as v from 'valibot'
import { useRequestCancellation } from '~/composables/use-request-cancellation.ts'
import { getLocalCalendarDate } from '~/utils/calendar-date.ts'
import { viewingErrorFields } from '~/utils/viewing-error-fields.ts'

type ViewingStatus = 'idle' | 'loading' | 'loaded' | 'error'
type ViewingOperation = 'viewing' | 'rating' | 'watches'

interface ViewingMutation {
  key: string;
  url: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body: Record<string, unknown>;
  operation: ViewingOperation;
}
interface ScoreMutation {
  url: string;
  key: string;
  score: number | null;
  viewingDate?: string;
  viewing?: CatalogViewing;
}
interface CatalogViewingsOptions {
  automaticLoad?: boolean;
  type: Readonly<Ref<'movie' | 'series' | null>>;
  timeZone: Readonly<Ref<string | null>>;
}

const emptySummary: CatalogViewingSummary = {
  completedCount: 0,
  currentViewingId: null,
  contextVersion: 0,
  currentViewingScore: null,
  currentVoteScore: null
}

// Ratings, marks and viewing edits share one confirmed title context and immutable retry boundary.
function useCatalogViewings(catalogItemId: Readonly<Ref<string | null>>, accountId: Readonly<Ref<string | null>>, { automaticLoad = import.meta.client, type, timeZone }: CatalogViewingsOptions) {
  const requestFetch = useRequestFetch()
  const reads = useRequestCancellation()
  const points = useRequestCancellation()
  const writes = useRequestCancellation()
  const items = ref<CatalogViewing[]>([])
  const confirmedViewing = ref<CatalogViewing | null>(null)
  const summary = ref<CatalogViewingSummary>(emptySummary)
  const status = shallowRef<ViewingStatus>('idle')
  const nextCursor = shallowRef<string | null>(null)
  const isLoadingMore = shallowRef(false)
  const isSaving = shallowRef(false)
  const readError = shallowRef('')
  const pointError = shallowRef('')
  const saveError = shallowRef('')
  const saveOperation = shallowRef<ViewingOperation>('viewing')
  const saveKey = shallowRef('')
  const completedMutation = shallowRef<ViewingMutation | null>(null)
  const fields = ref<Record<string, string>>({})
  const unauthorized = shallowRef<'load' | 'mutation' | null>(null)
  const didRecoverCursor = shallowRef(false)
  const pendingMutation = shallowRef<ViewingMutation | null>(null)
  const unconfirmedMutation = toRef(() => isSaving.value ? null : pendingMutation.value)
  const mutationVersion = shallowRef(0)
  const confirmedWatches = ref<CatalogSeriesEpisodeWatch[] | null>(null)
  const watchesViewingId = shallowRef<string | null>(null)
  const selectedViewingId = shallowRef<string | null>(null)
  const selectedViewing = ref<CatalogViewing | null>(null)
  const deletedViewingId = shallowRef<string | null>(null)
  const selectionVersion = shallowRef(0)
  const isHistorical = toRef(() => selectedViewingId.value !== null && selectedViewingId.value !== summary.value.currentViewingId)
  const contextKey = toRef(() => `${summary.value.currentViewingId ?? 'none'}:${summary.value.contextVersion}`)
  const selectionKey = toRef(() => `${selectedViewingId.value ?? summary.value.currentViewingId ?? 'none'}:${selectionVersion.value}`)

  const currentViewing = computed(() => {
    const id = summary.value.currentViewingId

    return items.value.find(item => item.id === id) ?? (confirmedViewing.value?.id === id ? confirmedViewing.value : null)
  })

  let disposed = false
  let generation = 0

  function path(): string | null {
    if (disposed || accountId.value === null || catalogItemId.value === null) { return null }

    const id = encodeURIComponent(catalogItemId.value)

    return `/api/catalog/items/${id}/viewings`
  }
  function reset(): void {
    generation += 1

    reads.cancel()
    points.cancel()
    writes.cancel()

    items.value = []
    confirmedViewing.value = null
    selectedViewingId.value = null
    selectedViewing.value = null
    deletedViewingId.value = null
    summary.value = emptySummary
    status.value = 'idle'
    nextCursor.value = null
    isLoadingMore.value = false
    isSaving.value = false
    readError.value = ''
    pointError.value = ''
    saveError.value = ''
    saveKey.value = ''
    completedMutation.value = null
    fields.value = {}
    unauthorized.value = null
    didRecoverCursor.value = false
    pendingMutation.value = null
    mutationVersion.value = 0
    confirmedWatches.value = null
    watchesViewingId.value = null
    selectionVersion.value = 0
  }
  function newestViewing(viewing: CatalogViewing): CatalogViewing {
    const known = items.value.find(item => item.id === viewing.id)
    const candidates = [confirmedViewing.value, selectedViewing.value, known]
    let newest = viewing

    for (const candidate of candidates) {
      if (candidate?.id === viewing.id && candidate.revision > newest.revision) { newest = candidate }
    }

    return newest
  }
  function applyViewing(viewing: CatalogViewing, add = false): void {
    if (viewing.catalogItemId !== catalogItemId.value) { throw new Error('Viewing response target mismatch') }

    const index = items.value.findIndex(item => item.id === viewing.id)
    const newest = newestViewing(viewing)

    if (newest.revision > viewing.revision) { return }

    confirmedViewing.value = viewing

    if (index !== -1) { items.value[index] = viewing }
    else if (add) { items.value.unshift(viewing) }

    if (selectedViewingId.value === viewing.id) { selectedViewing.value = viewing }
  }
  function applyConfirmed(response: unknown, mutation = false): void {
    if (pendingMutation.value !== null && !mutation) { return }

    if (!isRecord(response)) { throw new Error('Invalid viewing mutation response') }

    if (response.summary !== undefined) {
      const result = v.parse(catalogViewingDeletionResponseSchema, { summary: response.summary })

      if (result.summary.contextVersion >= summary.value.contextVersion) { summary.value = result.summary }
    }

    if (response.viewing !== undefined && response.viewing !== null) {
      const result = v.parse(catalogViewingResponseSchema, { viewing: response.viewing })

      applyViewing(result.viewing, true)
    }

    if (mutation && Array.isArray(response.watches)) {
      const marks = v.parse(v.array(catalogEpisodeWatchSchema), response.watches)
      const viewing = isRecord(response.viewing) ? response.viewing.id : null

      confirmedWatches.value = marks
      watchesViewingId.value = typeof viewing === 'string' ? viewing : null
    }
  }
  function forgetViewing(id: string): void {
    items.value = items.value.filter(item => item.id !== id)

    if (selectedViewingId.value === id) {
      selectedViewingId.value = null
      selectedViewing.value = null
      selectionVersion.value += 1
    }

    if (confirmedViewing.value?.id === id) { confirmedViewing.value = null }

    deletedViewingId.value = id
  }
  async function loadPoint(id: string): Promise<CatalogViewing | null> {
    const url = path()

    if (url === null) { return null }

    const request = points.start()

    pointError.value = ''

    try {
      const encodedId = encodeURIComponent(id)
      const targetUrl = `${url}/${encodedId}`

      const response: unknown = await requestFetch(targetUrl, {
        retry: 0,
        signal: request.signal
      })

      if (!points.isCurrent(request)) { return null }

      const result = v.parse(catalogViewingResponseSchema, response)

      if (result.viewing.id !== id) { throw new Error('Viewing response identity mismatch') }

      const viewing = newestViewing(result.viewing)

      applyViewing(viewing)

      return viewing
    } catch (error) {
      if (!points.isCurrent(request)) { return null }

      if (isRecord(error) && error.statusCode === 404) { forgetViewing(id) }
      else if (isRecord(error) && error.statusCode === 401) { unauthorized.value = 'load' }
      else {
        globalThis.console.warn({
          error,
          message: 'Viewing refresh request failed.'
        })

        pointError.value = 'This viewing could not be refreshed. Try again.'
      }

      return null
    } finally { points.finish(request) }
  }
  async function requestHistoryPage(url: string, cursor: string | null, signal: AbortSignal) {
    try {
      const response: unknown = await requestFetch(url, {
        query: cursor === null ? undefined : { cursor },
        retry: 0,
        signal
      })

      return {
        response,
        recovered: false
      }
    } catch (error) {
      const invalidCursor = cursor !== null && isRecord(error) && error.statusCode === 400

      if (!invalidCursor || signal.aborted) { throw error }

      const response: unknown = await requestFetch(url, {
        retry: 0,
        signal
      })

      return {
        response,
        recovered: true
      }
    }
  }
  function mergeHistoryPage(page: CatalogViewingsResponse, append: boolean): void {
    const entries = append ? items.value.map(item => [item.id, item] as const) : []
    const records = new Map<string, CatalogViewing>(entries)

    for (const item of page.items) {
      const viewing = newestViewing(item)

      records.set(item.id, viewing)
    }

    const recordsIterator = records.values()

    items.value = [...recordsIterator]

    if (page.summary.contextVersion >= summary.value.contextVersion) { summary.value = page.summary }

    nextCursor.value = page.nextCursor
    status.value = 'loaded'

    const selectedId = selectedViewingId.value

    if (selectedId !== null) { selectedViewing.value = items.value.find(item => item.id === selectedId) ?? selectedViewing.value }
  }
  async function refreshCurrentViewing(): Promise<void> {
    const currentId = summary.value.currentViewingId
    const hasCurrent = items.value.some(item => item.id === currentId) || confirmedViewing.value?.id === currentId

    if (currentId !== null && !hasCurrent) { await loadPoint(currentId) }
  }
  async function fetchHistory(more = false): Promise<boolean> {
    const url = path()

    if (url === null || (more && (isLoadingMore.value || nextCursor.value === null))) { return false }

    const request = reads.start()
    const cursor = more ? nextCursor.value : null
    const hadData = status.value === 'loaded'

    isLoadingMore.value = more
    readError.value = ''
    didRecoverCursor.value = false

    if (!more && !hadData) { status.value = 'loading' }

    try {
      const result = await requestHistoryPage(url, cursor, request.signal)

      if (!reads.isCurrent(request)) { return false }

      const page = v.parse(catalogViewingsResponseSchema, result.response)
      const append = more && !result.recovered

      mergeHistoryPage(page, append)

      didRecoverCursor.value = result.recovered

      await refreshCurrentViewing()

      return reads.isCurrent(request)
    } catch (error) {
      if (!reads.isCurrent(request)) { return false }

      if (isRecord(error) && error.statusCode === 401) { unauthorized.value = 'load' }
      else {
        globalThis.console.warn({
          error,
          message: 'Viewing history request failed.'
        })

        readError.value = more ? 'We couldn’t load more viewings. Try again.' : 'We couldn’t refresh your viewings. Try again.'

        if (!hadData) { status.value = 'error' }
      }

      return false
    } finally {
      if (reads.finish(request)) { isLoadingMore.value = false }
    }
  }
  async function load(more = false): Promise<boolean> {
    if (isSaving.value || pendingMutation.value !== null) { return false }

    return fetchHistory(more)
  }
  function validateMutationResponse(mutation: ViewingMutation, response: unknown): void {
    if (mutation.operation === 'rating') {
      const result = v.parse(catalogRatingMutationResponseSchema, response)
      const requestedScore = mutation.body.score ?? null
      const historical = /\/viewings\/(?<viewingId>[^/]+)\//u.exec(mutation.url)
      const expectedId = historical?.groups?.viewingId ?? mutation.body.currentViewingId
      const wrongViewing = typeof expectedId === 'string' && result.viewing?.id !== expectedId
      const missingFirstViewing = requestedScore !== null && result.viewing === null

      if (wrongViewing || missingFirstViewing) { throw new Error('Rating response viewing mismatch') }
    } else if (mutation.operation === 'watches') { v.parse(catalogSeriesWatchesResponseSchema, response) }
    else if (mutation.method === 'DELETE') { v.parse(catalogViewingDeletionResponseSchema, response) }
    else { v.parse(catalogViewingMutationResponseSchema, response) }

  }
  async function handleMutationError(error: unknown, mutation: ViewingMutation): Promise<void> {
    const code = isRecord(error) ? error.statusCode : undefined

    if (code === 401) { unauthorized.value = 'mutation' }
    else {
      globalThis.console.warn({
        error,
        message: 'Viewing update request failed.'
      })

      fields.value = viewingErrorFields(error)

      if (code === 400 || code === 404 || code === 409) {
        pendingMutation.value = null
        saveError.value = code === 409 ? 'Your viewing changed. Refresh your viewings and try again.' : 'We couldn’t save this change. Check the details and try again.'
      } else { saveError.value = 'We couldn’t confirm whether this change was saved. Retry to check the same change.' }

      if (code === 409 && mutation.operation !== 'rating') {
        const recovered = await fetchHistory()
        const deletedId = mutation.method === 'DELETE' && mutation.key.startsWith('delete:') ? mutation.key.slice('delete:'.length) : null

        if (recovered && deletedId !== null) { await loadPoint(deletedId) }
      }
    }

  }
  function finalizeViewingMutation(mutation: ViewingMutation): void {
    if (mutation.operation !== 'viewing') { return }

    const cancelledRewatch = mutation.key === 'rewatch:cancel'
    const createdViewing = mutation.method === 'POST'

    if (mutation.method === 'DELETE') {
      const deletedId = cancelledRewatch ? mutation.body.currentViewingId : mutation.key.slice('delete:'.length)

      items.value = items.value.filter(item => item.id !== deletedId)

      if (selectedViewingId.value === deletedId) { selectedViewingId.value = null; selectedViewing.value = null }

      if (confirmedViewing.value?.id === deletedId) { confirmedViewing.value = null }
    }

    if (createdViewing || cancelledRewatch) { selectedViewingId.value = null; selectedViewing.value = null }

    if (createdViewing || mutation.method === 'DELETE') { selectionVersion.value += 1 }
  }
  async function mutate(input: ViewingMutation): Promise<unknown> {
    if (path() === null || isSaving.value || status.value !== 'loaded') { return null }

    const pending = pendingMutation.value

    if (pending !== null && pending.key !== input.key) {
      saveError.value = 'Retry the unconfirmed change before making another change.'

      return null
    }

    const mutation = pending ?? input
    const request = writes.start()
    const requestGeneration = generation

    pendingMutation.value = mutation

    reads.cancel()
    points.cancel()

    isLoadingMore.value = false
    isSaving.value = true
    saveError.value = ''
    fields.value = {}
    unauthorized.value = null
    saveOperation.value = mutation.operation
    saveKey.value = mutation.key

    try {
      const response: unknown = await requestFetch(mutation.url, {
        body: mutation.body,
        method: mutation.method,
        retry: 0,
        signal: request.signal
      })

      if (!writes.isCurrent(request) || generation !== requestGeneration) { return null }

      validateMutationResponse(mutation, response)
      applyConfirmed(response, true)
      finalizeViewingMutation(mutation)

      pendingMutation.value = null
      completedMutation.value = mutation
      mutationVersion.value += 1

      const createdByRating = mutation.operation === 'rating' && mutation.body.currentViewingId === null && isRecord(response) && response.viewing !== null

      if (mutation.operation === 'viewing' || createdByRating) { await fetchHistory() }

      if (!writes.isCurrent(request) || generation !== requestGeneration) { return null }

      return response
    } catch (error) {
      if (!writes.isCurrent(request)) { return null }

      await handleMutationError(error, mutation)

      return null
    } finally {
      if (writes.finish(request)) { isSaving.value = false }
    }
  }
  async function retryMutation(): Promise<boolean> {
    const pending = pendingMutation.value

    if (pending === null) { return false }

    const response = await mutate(pending)

    if (response === null) { return false }

    return true
  }
  async function create(mode: 'current' | 'history', dates?: CatalogViewingDraft, completeCurrentOn?: string): Promise<boolean> {
    const url = path()

    if (url === null) { return false }

    const today = getLocalCalendarDate()
    const movie = type.value === 'movie'
    const startedOn = dates?.startedOn ?? (movie ? null : today)
    const completedOn = dates?.completedOn ?? (movie ? today : null)
    const viewingStatus = dates?.status ?? (movie ? 'completed' : 'watching')
    const requestId = globalThis.crypto.randomUUID()

    const body: Record<string, unknown> = {
      requestId,
      mode,
      currentViewingId: summary.value.currentViewingId,
      contextVersion: summary.value.contextVersion,
      status: viewingStatus,
      startedOn,
      completedOn
    }

    if (completeCurrentOn !== undefined) { body.completeCurrentOn = completeCurrentOn }

    const response = await mutate({
      key: `create:${mode}`,
      url,
      method: 'POST',
      body,
      operation: 'viewing'
    })

    if (response === null) { return false }

    return true
  }
  async function saveScore({ url, key, score, viewingDate, viewing }: ScoreMutation): Promise<unknown> {
    if (timeZone.value === null) { return null }

    const requestId = globalThis.crypto.randomUUID()

    const body: Record<string, unknown> = viewing !== undefined && viewing.id !== summary.value.currentViewingId
      ? {
        requestId,
        revision: viewing.revision,
        timeZone: timeZone.value
      }
      : {
        requestId,
        currentViewingId: summary.value.currentViewingId,
        contextVersion: summary.value.contextVersion,
        timeZone: timeZone.value
      }

    if (score !== null) { body.score = score }

    if (viewingDate !== undefined) { body.viewingDate = viewingDate }

    return mutate({
      key,
      url,
      method: score === null ? 'DELETE' : 'PUT',
      body,
      operation: 'rating'
    })
  }
  async function saveCurrentScore(score: number | null, viewingDate?: string): Promise<boolean> {
    const url = path()

    if (url === null) { return false }

    const itemUrl = url.slice(0, -'/viewings'.length)
    const targetUrl = `${itemUrl}/rating`

    const response = await saveScore({
      url: targetUrl,
      key: 'rating:item:current',
      score,
      viewingDate
    })

    return response !== null
  }
  async function saveViewingScore(viewing: CatalogViewing, score: number | null): Promise<boolean> {
    if (viewing.id === summary.value.currentViewingId) { return saveCurrentScore(score) }

    const url = path()

    if (url === null) { return false }

    const encodedId = encodeURIComponent(viewing.id)
    const targetUrl = `${url}/${encodedId}/rating`

    const response = await saveScore({
      url: targetUrl,
      key: `rating:item:${viewing.id}`,
      score,
      viewing
    })

    return response !== null
  }
  async function update(viewing: CatalogViewing, dates: CatalogViewingDraft, key = `update:${viewing.id}`): Promise<boolean> {
    const url = path()

    if (url === null) { return false }

    const id = encodeURIComponent(viewing.id)
    const requestId = globalThis.crypto.randomUUID()

    const body = {
      requestId,
      revision: viewing.revision,
      currentViewingId: summary.value.currentViewingId,
      contextVersion: summary.value.contextVersion,
      status: dates.status,
      startedOn: dates.startedOn,
      completedOn: dates.completedOn
    }

    const response = await mutate({
      key,
      url: `${url}/${id}`,
      method: 'PATCH',
      body,
      operation: 'viewing'
    })

    if (response === null) { return false }

    return true
  }
  async function remove(viewing: CatalogViewing): Promise<boolean> {
    const url = path()

    if (url === null) { return false }

    const id = encodeURIComponent(viewing.id)
    const requestId = globalThis.crypto.randomUUID()

    const body = {
      requestId,
      revision: viewing.revision
    }

    const response = await mutate({
      key: `delete:${viewing.id}`,
      url: `${url}/${id}`,
      method: 'DELETE',
      body,
      operation: 'viewing'
    })

    if (response === null) { return false }

    return true
  }
  function isMutationBlocked(key: string): boolean {
    const isHistoryUnavailable = accountId.value !== null && status.value !== 'loaded'

    return isHistoryUnavailable || (pendingMutation.value !== null && pendingMutation.value.key !== key)
  }
  function select(viewing: CatalogViewing | null): void {
    if (isSaving.value || pendingMutation.value !== null) { return }

    selectedViewingId.value = viewing?.id ?? null
    selectedViewing.value = viewing
    selectionVersion.value += 1
  }

  onScopeDispose(() => {
    disposed = true

    reset()
  })

  watch([() => catalogItemId.value, () => accountId.value], () => {
    reset()

    if (automaticLoad) { void load() }
  }, {
    flush: 'sync',
    immediate: true
  })

  return {
    applyConfirmed,
    completedMutation,
    confirmedViewing,
    confirmedWatches,
    watchesViewingId,
    contextKey,
    create,
    currentViewing,
    deletedViewingId,
    didRecoverCursor,
    fields,
    isHistorical,
    isLoadingMore,
    isMutationBlocked,
    isSaving,
    items,
    load,
    loadPoint,
    mutate,
    mutationVersion,
    nextCursor,
    pendingMutation,
    pointError,
    readError,
    remove,
    retryMutation,
    saveCurrentScore,
    saveError,
    saveOperation,
    saveKey,
    saveScore,
    saveViewingScore,
    select,
    selectedViewing,
    selectedViewingId,
    selectionKey,
    selectionVersion,
    status,
    summary,
    unauthorized,
    unconfirmedMutation,
    update
  }
}

type CatalogViewingsState = ReturnType<typeof useCatalogViewings>

export { useCatalogViewings }
export type { CatalogViewingsState, ViewingStatus }
