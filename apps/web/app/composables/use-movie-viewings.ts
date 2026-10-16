/* oxlint-disable eslint/max-lines -- One owner coordinates history, linked records, mutations and account cancellation. */
import { useRequestFetch } from '#app'

import {
  catalogMovieViewingsResponseSchema,
  catalogMovieRatingResponseSchema,
  type CatalogMovieRatingContext,
  catalogViewingDeletionResponseSchema,
  catalogViewingMutationResponseSchema,
  catalogViewingResponseSchema,
  type CatalogMovieViewingSummary,
  type CatalogViewing,
  type CatalogViewingCreateInput,
  type CatalogViewingDates,
  type CatalogViewingUpdateInput
} from '@tv/shared/catalog-viewings'

import { isRecord } from '@tv/shared/type-guards'
import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import * as v from 'valibot'
import { viewingErrorFields } from '~/utils/viewing-error-fields.ts'
import { useRequestCancellation } from '~/composables/use-request-cancellation.ts'

interface MovieViewingsOptions {
  automaticLoad?: boolean;
  selectedId: Readonly<Ref<string | null>>;
}

const emptySummary: CatalogMovieViewingSummary = {
  completedCount: 0,
  currentViewingId: null,
  contextVersion: 0,
  currentViewingScore: null,
  currentVoteScore: null
}

const unknownDates: CatalogViewingDates = {
  startedOn: null,
  completedOn: null
}

type ViewingStatus = 'idle' | 'loading' | 'loaded' | 'error'
type RatingOperation = 'viewing' | 'current-rating' | 'history-rating'

interface MutationTarget {
  id: string | null;
  operation?: RatingOperation;
}

interface ConfirmedTarget extends MutationTarget {
  score: number | null;
}

type MutationInput = CatalogViewingCreateInput | CatalogViewingUpdateInput | { revision: number; score?: number } | CatalogMovieRatingContext | (CatalogMovieRatingContext & { score: number })

function mutationUrl(url: string, target: MutationTarget): string {
  if (target.operation === 'current-rating') { return `${url.slice(0, -'/viewings'.length)}/rating` }

  const encodedId = target.id === null ? null : encodeURIComponent(target.id)
  const viewingUrl = encodedId === null ? url : `${url}/${encodedId}`

  return target.operation === 'history-rating' ? `${viewingUrl}/rating` : viewingUrl
}

function creationKey(mode: 'current' | 'history', dates: CatalogViewingDates, score?: number): string {
  return JSON.stringify({
    mode,
    startedOn: dates.startedOn,
    completedOn: dates.completedOn,
    score
  })
}

function useMovieViewings(
  catalogItemId: Readonly<Ref<string | null>>,
  accountId: Readonly<Ref<string | null>>,
  { automaticLoad = import.meta.client, selectedId }: MovieViewingsOptions
) {
  const requestFetch = useRequestFetch()
  const reads = useRequestCancellation()
  const points = useRequestCancellation()
  const writes = useRequestCancellation()
  const items = ref<CatalogViewing[]>([])
  const selectedViewing = ref<CatalogViewing | null>(null)
  const confirmedViewing = ref<CatalogViewing | null>(null)
  const summary = ref({ ...emptySummary })
  const status = shallowRef<ViewingStatus>('idle')
  const nextCursor = shallowRef<string | null>(null)
  const isLoadingMore = shallowRef(false)
  const isSaving = shallowRef(false)
  const readError = shallowRef('')
  const pointError = shallowRef('')
  const saveError = shallowRef('')
  const saveOperation = shallowRef<RatingOperation | 'combined-rating'>('viewing')
  const fields = ref<Record<string, string>>({})
  const unauthorized = shallowRef<'load' | 'mutation' | null>(null)
  let generation = 0
  let disposed = false
  const pendingCreations = new Map<string, CatalogViewingCreateInput>()
  const unconfirmedCreation = shallowRef<CatalogViewingCreateInput | null>(null)

  function path(): string | null {
    if (disposed || accountId.value === null || catalogItemId.value === null) { return null }

    const encodedId = encodeURIComponent(catalogItemId.value)

    return `/api/catalog/items/${encodedId}/viewings`
  }

  function reset(): void {
    generation += 1

    reads.cancel()
    points.cancel()
    writes.cancel()

    items.value = []
    selectedViewing.value = null
    confirmedViewing.value = null
    summary.value = { ...emptySummary }
    status.value = 'idle'
    nextCursor.value = null
    isLoadingMore.value = false
    isSaving.value = false
    readError.value = ''
    pointError.value = ''
    saveError.value = ''
    fields.value = {}
    unauthorized.value = null

    pendingCreations.clear()

    unconfirmedCreation.value = null
  }

  async function loadPoint(id = selectedId.value): Promise<CatalogViewing | null> {
    const url = path()

    points.cancel()

    if (id === selectedId.value) { selectedViewing.value = null }

    pointError.value = ''

    if (url === null || id === null) {
      return null
    }

    const request = points.start()

    try {
      const encodedId = encodeURIComponent(id)
      const targetUrl = `${url}/${encodedId}`

      const response: unknown = await requestFetch(targetUrl, {
        retry: 0,
        signal: request.signal
      })

      const isCurrent = points.isCurrent(request)

      if (!isCurrent) {
        return null
      }

      const parsed = v.parse(catalogViewingResponseSchema, response)

      if (parsed.viewing.id !== id || parsed.viewing.catalogItemId !== catalogItemId.value) { throw new Error('Movie viewing response target mismatch') }

      const confirmed = confirmedViewing.value
      const hasNewerConfirmation = confirmed?.id === id && confirmed.revision > parsed.viewing.revision
      const viewing = hasNewerConfirmation ? confirmed : parsed.viewing

      if (id === selectedId.value) { selectedViewing.value = viewing }

      return viewing
    } catch (error) {
      const isCurrent = points.isCurrent(request)

      if (!isCurrent) {
        return null
      }

      const isErrorRecord = isRecord(error)

      if (isErrorRecord && error.statusCode === 401) {
        unauthorized.value = 'load'
      } else {
        globalThis.console.warn({
          error,
          message: 'Movie viewing link request failed.'
        })

        pointError.value = 'This viewing could not be loaded. Check the link or try again.'
      }

      return null
    } finally {
      points.finish(request)
    }
  }

  async function fetchHistory(more = false): Promise<boolean> {
    const url = path()

    if (url === null || (more && (isLoadingMore.value || nextCursor.value === null))) {
      return false
    }

    const request = reads.start()
    const cursor = more ? nextCursor.value : null
    const hadData = status.value === 'loaded'

    isLoadingMore.value = more
    readError.value = ''

    if (!more && !hadData) {
      status.value = 'loading'
    }

    try {
      const response: unknown = await requestFetch(url, {
        query: cursor === null ? undefined : { cursor },
        retry: 0,
        signal: request.signal
      })

      const isCurrent = reads.isCurrent(request)

      if (!isCurrent) {
        return false
      }

      const page = v.parse(catalogMovieViewingsResponseSchema, response)
      const existingIds = items.value.map(item => item.id)
      const known = new Set(existingIds)
      const addedItems = page.items.filter(item => !known.has(item.id))

      items.value = more ? [...items.value, ...addedItems] : page.items
      summary.value = page.summary
      nextCursor.value = page.nextCursor
      status.value = 'loaded'

      return true
    } catch (error) {
      const isCurrent = reads.isCurrent(request)

      if (!isCurrent) {
        return false
      }

      const isErrorRecord = isRecord(error)

      if (isErrorRecord && error.statusCode === 401) {
        unauthorized.value = 'load'
      } else {
        globalThis.console.warn({
          error,
          message: 'Movie viewing history request failed.'
        })

        readError.value = more ? 'We couldn’t load more viewings. Try again.' : 'We couldn’t refresh your viewings. Try again.'

        if (!hadData) {
          status.value = 'error'
        }
      }

      return false
    } finally {
      const isFinished = reads.finish(request)

      if (isFinished) {
        isLoadingMore.value = false
      }
    }
  }

  async function load(more = false): Promise<boolean> {
    if (isSaving.value) { return false }

    return fetchHistory(more)
  }

  function settleCreation(body: MutationInput): void {
    if ('requestId' in body) {
      const key = creationKey(body.mode, body, body.score)

      pendingCreations.delete(key)

      if (unconfirmedCreation.value?.requestId === body.requestId) { unconfirmedCreation.value = null }
    }
  }

  function applyViewing(viewing: CatalogViewing, add = false): void {
    confirmedViewing.value = viewing

    const previous = items.value.findIndex(item => item.id === viewing.id)

    if (previous === -1 && add) { items.value.unshift(viewing) }
    else if (previous !== -1) { items.value[previous] = viewing }

    if (selectedId.value === viewing.id) { selectedViewing.value = viewing }
  }

  function applyConfirmed(method: string, response: unknown, target: ConfirmedTarget): void {
    const { id, operation = 'viewing' } = target

    if (operation === 'current-rating') {
      const result = v.parse(catalogMovieRatingResponseSchema, response)

      if (result.score !== target.score || result.viewing?.id !== (id ?? undefined)) { throw new Error('Movie rating response target or score mismatch') }

      summary.value = result.summary

      if (result.viewing !== null) { applyViewing(result.viewing) }

      return
    }

    if (operation === 'viewing') { points.cancel() }

    if (method === 'DELETE' && operation === 'viewing') {
      const deleted = v.parse(catalogViewingDeletionResponseSchema, response)

      summary.value = deleted.summary
      items.value = items.value.filter(item => item.id !== id)

      if (selectedViewing.value?.id === id) {
        selectedViewing.value = null
        pointError.value = 'This viewing has been deleted.'
      }
    } else {
      const result = v.parse(catalogViewingMutationResponseSchema, response)

      if (operation === 'history-rating' && (result.viewing.id !== id || result.viewing.score !== target.score)) { throw new Error('Viewing rating response target mismatch') }

      summary.value = result.summary

      applyViewing(result.viewing, method === 'POST')
    }

  }

  function handleMutationError(error: unknown, method: string, body: MutationInput): void {
    const isErrorRecord = isRecord(error)
    const code = isErrorRecord ? error.statusCode : undefined

    if (code === 401) {
      unauthorized.value = 'mutation'
    } else {
      globalThis.console.warn({
        error,
        message: 'Movie viewing save request failed.'
      })

      saveError.value = code === 409 ? 'Your viewing changed. Refresh your viewings and try again.' : 'We couldn’t save this viewing. Try again.'

      fields.value = viewingErrorFields(error)

      if (method === 'POST' && 'requestId' in body) {
        if (code === 400 || code === 409) { settleCreation(body) }
        else if (body.score !== undefined) {
          unconfirmedCreation.value = body
          saveError.value = 'We couldn’t confirm whether this viewing was saved. Retry to check the same viewing.'
        }
      }
    }

  }

  function beginMutation(method: string, body: MutationInput, operation: RatingOperation): void {
    isSaving.value = true
    saveOperation.value = operation

    if (method === 'POST' && 'requestId' in body && body.mode === 'current' && body.score !== undefined) { saveOperation.value = 'combined-rating' }

    saveError.value = ''
    fields.value = {}
  }
  async function refreshConfirmedMutation(request: AbortController, requestGeneration: number, id: string | null): Promise<boolean> {
    await fetchHistory()

    const isCurrentAfterRefresh = writes.isCurrent(request)

    if (!isCurrentAfterRefresh || generation !== requestGeneration) { return false }

    if (selectedId.value !== null && selectedId.value !== id && selectedViewing.value === null) { await loadPoint() }

    const isCurrentAfterPoint = writes.isCurrent(request)

    return isCurrentAfterPoint && generation === requestGeneration
  }

  async function mutate(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body: MutationInput, target: MutationTarget): Promise<boolean> {
    const { id, operation = 'viewing' } = target
    const url = path()

    if (url === null || isSaving.value || status.value !== 'loaded') {
      return false
    }

    reads.cancel()
    points.cancel()

    isLoadingMore.value = false

    const requestGeneration = generation
    const request = writes.start()

    beginMutation(method, body, operation)

    try {
      const targetUrl = mutationUrl(url, target)

      const response: unknown = await requestFetch(targetUrl, {
        body,
        method,
        retry: 0,
        signal: request.signal
      })

      const isCurrent = writes.isCurrent(request)

      if (!isCurrent) {
        return false
      }

      const expectedScore = 'score' in body ? body.score ?? null : null

      applyConfirmed(method, response, {
        id,
        operation,
        score: expectedScore
      })

      if (method === 'POST') { settleCreation(body) }

      if (operation !== 'viewing') { return true }

      return await refreshConfirmedMutation(request, requestGeneration, id)
    } catch (error) {
      const isCurrent = writes.isCurrent(request)

      if (!isCurrent) {
        return false
      }

      handleMutationError(error, method, body)

      return false
    } finally {
      const isFinished = writes.finish(request)

      if (isFinished) {
        isSaving.value = false
      }
    }

  }

  async function create(mode: 'current' | 'history', dates: CatalogViewingDates = unknownDates, score?: number): Promise<boolean> {
    if (unconfirmedCreation.value !== null) {
      saveError.value = 'Retry the unconfirmed viewing before recording another one.'

      return false
    }

    const key = creationKey(mode, dates, score)
    let pending = pendingCreations.get(key)

    if (pending === undefined) {
      const requestId = globalThis.crypto.randomUUID()

      pending = mode === 'current'
        ? {
          startedOn: dates.startedOn,
          completedOn: dates.completedOn,
          requestId,
          mode,
          contextVersion: summary.value.contextVersion
        }
        : {
          startedOn: dates.startedOn,
          completedOn: dates.completedOn,
          requestId,
          mode
        }

      if (score !== undefined) { pending.score = score }

      pendingCreations.set(key, pending)
    }

    return mutate('POST', pending, { id: null })
  }

  async function retryCreation(): Promise<boolean> {
    const pending = unconfirmedCreation.value

    return pending === null ? false : mutate('POST', pending, { id: null })
  }

  async function saveCurrentScore(score: number | null): Promise<boolean> {
    const context = summary.value

    const body = score === null
      ? {
        currentViewingId: context.currentViewingId,
        contextVersion: context.contextVersion
      }
      : {
        currentViewingId: context.currentViewingId,
        contextVersion: context.contextVersion,
        score
      }

    const method = score === null ? 'DELETE' : 'PUT'

    return mutate(method, body, {
      id: context.currentViewingId,
      operation: 'current-rating'
    })
  }

  async function saveViewingScore(viewing: CatalogViewing, score: number | null): Promise<boolean> {
    if (viewing.id === summary.value.currentViewingId) { return saveCurrentScore(score) }

    const body = score === null ? { revision: viewing.revision } : {
      revision: viewing.revision,
      score
    }

    const method = score === null ? 'DELETE' : 'PUT'

    return mutate(method, body, {
      id: viewing.id,
      operation: 'history-rating'
    })
  }

  async function update(viewing: CatalogViewing, dates: CatalogViewingDates): Promise<boolean> {
    return mutate('PATCH', {
      startedOn: dates.startedOn,
      completedOn: dates.completedOn,
      revision: viewing.revision
    }, { id: viewing.id })
  }

  async function remove(viewing: CatalogViewing): Promise<boolean> {
    return mutate('DELETE', { revision: viewing.revision }, { id: viewing.id })
  }

  onScopeDispose(() => {
    disposed = true

    reset()
  })

  watch([catalogItemId, accountId], () => {
    reset()

    if (automaticLoad) {
      void load()
      void loadPoint()
    }
  }, {
    flush: 'sync',
    immediate: true
  })

  watch(selectedId, () => { if (automaticLoad) { void loadPoint() } }, { flush: 'sync' })

  return {
    create,
    retryCreation,
    saveCurrentScore,
    saveViewingScore,
    unconfirmedCreation,
    fields,
    isLoadingMore,
    isSaving,
    items,
    load,
    loadPoint,
    nextCursor,
    pointError,
    readError,
    remove,
    saveError,
    saveOperation,
    selectedViewing,
    confirmedViewing,
    status,
    summary,
    unauthorized,
    update
  }
}

export { useMovieViewings }
export type MovieViewingsState = ReturnType<typeof useMovieViewings>
