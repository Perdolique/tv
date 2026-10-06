/* oxlint-disable eslint/max-lines -- One owner coordinates history, linked records, mutations and account cancellation. */
import { useRequestFetch } from '#app'

import {
  catalogMovieViewingsResponseSchema,
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
import { onScopeDispose, ref, watch, type Ref } from 'vue'
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
  contextVersion: 0
}

const unknownDates: CatalogViewingDates = {
  startedOn: null,
  completedOn: null
}

type ViewingStatus = 'idle' | 'loading' | 'loaded' | 'error'

function creationKey(mode: 'current' | 'history', dates: CatalogViewingDates): string {
  return JSON.stringify({
    mode,
    startedOn: dates.startedOn,
    completedOn: dates.completedOn
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
  const summary = ref({ ...emptySummary })
  const status = ref<ViewingStatus>('idle')
  const nextCursor = ref<string | null>(null)
  const isLoadingMore = ref(false)
  const isSaving = ref(false)
  const readError = ref('')
  const pointError = ref('')
  const saveError = ref('')
  const fields = ref<Record<string, string>>({})
  const unauthorized = ref<'load' | 'mutation' | null>(null)
  let generation = 0
  let disposed = false
  const pendingCreations = new Map<string, CatalogViewingCreateInput>()

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

      if (!points.isCurrent(request)) {
        return null
      }

      const parsed = v.parse(catalogViewingResponseSchema, response)

      if (id === selectedId.value) { selectedViewing.value = parsed.viewing }

      return parsed.viewing
    } catch (error) {
      if (!points.isCurrent(request)) {
        return null
      }

      if (isRecord(error) && error.statusCode === 401) {
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

      if (!reads.isCurrent(request)) {
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
      if (!reads.isCurrent(request)) {
        return false
      }

      if (isRecord(error) && error.statusCode === 401) {
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
      if (reads.finish(request)) {
        isLoadingMore.value = false
      }
    }
  }

  async function load(more = false): Promise<boolean> {
    if (isSaving.value) { return false }

    return fetchHistory(more)
  }

  function settleCreation(body: CatalogViewingCreateInput | CatalogViewingUpdateInput | { revision: number }): void {
    if ('requestId' in body) {
      const key = creationKey(body.mode, body)

      pendingCreations.delete(key)
    }
  }

  function applyConfirmed(method: string, response: unknown, id: string | null): void {
    if (method === 'DELETE') {
      const deleted = v.parse(catalogViewingDeletionResponseSchema, response)

      summary.value = deleted.summary
      items.value = items.value.filter(item => item.id !== id)

      if (selectedViewing.value?.id === id) {
        selectedViewing.value = null
        pointError.value = 'This viewing has been deleted.'
      }
    } else {
      const result = v.parse(catalogViewingMutationResponseSchema, response)

      summary.value = result.summary

      const previous = items.value.findIndex(item => item.id === result.viewing.id)

      if (previous === -1 && method === 'POST') {
        items.value.unshift(result.viewing)
      } else if (previous !== -1) {
        items.value[previous] = result.viewing
      }

      if (selectedId.value === result.viewing.id) {
        selectedViewing.value = result.viewing
      }
    }

  }

  function handleMutationError(error: unknown, method: string, body: CatalogViewingCreateInput | CatalogViewingUpdateInput | { revision: number }): void {
    const code = isRecord(error) ? error.statusCode : undefined

    if (code === 401) {
      unauthorized.value = 'mutation'
    } else {
      globalThis.console.warn({
        error,
        message: 'Movie viewing save request failed.'
      })

      saveError.value = code === 409 ? 'Your viewing changed. Refresh your viewings and try again.' : 'We couldn’t save this viewing. Try again.'

      fields.value = viewingErrorFields(error)

      if (method === 'POST' && (code === 400 || code === 409)) {
        settleCreation(body)
      }
    }

  }

  async function mutate(method: 'POST' | 'PATCH' | 'DELETE', body: CatalogViewingCreateInput | CatalogViewingUpdateInput | { revision: number }, id: string | null): Promise<boolean> {
    const url = path()

    if (url === null || isSaving.value || status.value !== 'loaded') {
      return false
    }

    reads.cancel()
    points.cancel()

    isLoadingMore.value = false

    const requestGeneration = generation
    const request = writes.start()

    isSaving.value = true
    saveError.value = ''
    fields.value = {}

    try {
      const encodedId = id === null ? null : encodeURIComponent(id)
      const targetUrl = encodedId === null ? url : `${url}/${encodedId}`

      const response: unknown = await requestFetch(targetUrl, {
        body,
        method,
        retry: 0,
        signal: request.signal
      })

      if (!writes.isCurrent(request)) {
        return false
      }

      applyConfirmed(method, response, id)

      if (method === 'POST') { settleCreation(body) }

      await fetchHistory()

      if (!writes.isCurrent(request) || generation !== requestGeneration) { return false }

      if (selectedId.value !== null && selectedId.value !== id && selectedViewing.value === null) {
        await loadPoint()
      }

      return writes.isCurrent(request) && generation === requestGeneration
    } catch (error) {
      if (!writes.isCurrent(request)) {
        return false
      }

      handleMutationError(error, method, body)

      return false
    } finally {
      if (writes.finish(request)) {
        isSaving.value = false
      }
    }

  }

  async function create(mode: 'current' | 'history', dates: CatalogViewingDates = unknownDates): Promise<boolean> {
    const key = creationKey(mode, dates)
    let pending = pendingCreations.get(key)

    if (pending === undefined) {
      pending = mode === 'current'
        ? {
          startedOn: dates.startedOn,
          completedOn: dates.completedOn,
          requestId: globalThis.crypto.randomUUID(),
          mode,
          contextVersion: summary.value.contextVersion
        }
        : {
          startedOn: dates.startedOn,
          completedOn: dates.completedOn,
          requestId: globalThis.crypto.randomUUID(),
          mode
        }

      pendingCreations.set(key, pending)
    }

    return mutate('POST', pending, null)
  }

  async function update(viewing: CatalogViewing, dates: CatalogViewingDates): Promise<boolean> {
    return mutate('PATCH', {
      startedOn: dates.startedOn,
      completedOn: dates.completedOn,
      revision: viewing.revision
    }, viewing.id)
  }

  async function remove(viewing: CatalogViewing): Promise<boolean> {
    return mutate('DELETE', { revision: viewing.revision }, viewing.id)
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
    selectedViewing,
    status,
    summary,
    unauthorized,
    update
  }
}

export { useMovieViewings }
export type MovieViewingsState = ReturnType<typeof useMovieViewings>
