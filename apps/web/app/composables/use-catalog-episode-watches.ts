import { useRequestFetch } from '#app'

import {
  catalogSeriesWatchesResponseSchema,
  type CatalogSeriesRewatchInput,
  type CatalogSeriesUnwatchInput,
  type CatalogSeriesWatchInput,
  type CatalogSeriesWatchesResponse
} from '@tv/shared/catalog-series'

import { isRecord } from '@tv/shared/type-guards'
import { computed, reactive, ref, watch, type Ref } from 'vue'
import * as v from 'valibot'
import { useRequestCancellation } from '~/composables/use-request-cancellation.ts'

type EpisodeWatchesStatus = 'idle' | 'loading' | 'loaded' | 'error'
type EpisodeWatchesUnauthorized = 'load' | 'mutation' | null
type SeriesMutationBody = CatalogSeriesWatchInput | CatalogSeriesUnwatchInput | CatalogSeriesRewatchInput

interface SeriesMutation {
  action: string;
  url: string;
  method: 'POST' | 'PUT' | 'DELETE';
  body: SeriesMutationBody;
  episodeId: string | null;
}

interface CatalogEpisodeWatchesOptions {
  automaticLoad?: boolean;
  timeZone: Readonly<Ref<string | null>>;
}

function useCatalogEpisodeWatches(
  catalogItemId: Readonly<Ref<string | null>>,
  accountId: Readonly<Ref<string | null>>,
  { automaticLoad = import.meta.client, timeZone }: CatalogEpisodeWatchesOptions
) {
  const requestFetch = useRequestFetch()
  const reads = useRequestCancellation()
  const writes = useRequestCancellation()
  const status = ref<EpisodeWatchesStatus>('idle')
  const watchedEpisodeIds = ref<string[]>([])
  const watches = ref<CatalogSeriesWatchesResponse['watches']>([])
  const currentViewing = ref<CatalogSeriesWatchesResponse['currentViewing']>(null)
  const contextVersion = ref(0)
  const mutationVersion = ref(0)
  const isSaving = ref(false)
  const savingEpisodeId = ref<string | null>(null)
  const savingAction = ref<string | null>(null)
  const saveErrors = reactive(new Map<string, string>())
  const readError = ref('')
  const actionError = ref('')
  const rewatchError = ref('')
  const unauthorized = ref<EpisodeWatchesUnauthorized>(null)
  const pendingRequests = new Map<string, SeriesMutationBody>()
  const watchedCount = computed(() => watchedEpisodeIds.value.length)
  const currentViewingId = computed(() => currentViewing.value?.id ?? null)
  const contextKey = computed(() => `${currentViewingId.value ?? 'none'}:${contextVersion.value}`)

  function reset(): void {
    reads.cancel()
    writes.cancel()

    watchedEpisodeIds.value = []
    watches.value = []
    currentViewing.value = null
    contextVersion.value = 0
    isSaving.value = false
    savingEpisodeId.value = null
    savingAction.value = null

    saveErrors.clear()
    pendingRequests.clear()

    status.value = 'idle'
    readError.value = ''
    actionError.value = ''
    rewatchError.value = ''
    unauthorized.value = null
  }

  function apply(response: unknown): void {
    const result = v.parse(catalogSeriesWatchesResponseSchema, response)

    watchedEpisodeIds.value = result.watchedEpisodeIds
    watches.value = result.watches
    currentViewing.value = result.currentViewing
    contextVersion.value = result.contextVersion
    status.value = 'loaded'
  }

  async function fetchWatches(): Promise<boolean> {
    const itemId = catalogItemId.value

    if (accountId.value === null || itemId === null || timeZone.value === null) { return false }

    const request = reads.start()
    const hadData = status.value === 'loaded'

    readError.value = ''
    unauthorized.value = null

    if (!hadData) { status.value = 'loading' }

    try {
      const encodedId = encodeURIComponent(itemId)
      const url = `/api/catalog/items/${encodedId}/episodes/watched`

      const response: unknown = await requestFetch(url, {
        retry: 0,
        signal: request.signal
      })

      if (!reads.isCurrent(request)) { return false }

      apply(response)

      return true
    } catch (error) {
      if (!reads.isCurrent(request)) { return false }

      if (isRecord(error) && error.statusCode === 401) {
        unauthorized.value = 'load'
      } else {
        globalThis.console.warn({
          error,
          message: 'Catalog episode watches request failed.'
        })

        readError.value = 'We couldn’t refresh your watched episodes. Try again.'

        if (!hadData) { status.value = 'error' }
      }

      return false
    } finally {
      reads.finish(request)
    }
  }

  async function load(): Promise<boolean> {
    if (isSaving.value) { return false }

    return fetchWatches()
  }

  function newBody(): CatalogSeriesWatchInput | null {
    if (timeZone.value === null) { return null }

    const requestId = globalThis.crypto.randomUUID()

    return {
      requestId,
      currentViewingId: currentViewingId.value,
      contextVersion: contextVersion.value,
      timeZone: timeZone.value
    }
  }

  function showSaveError(action: string, episodeId: string | null, message: string): void {
    if (action.startsWith('rewatch:')) {
      rewatchError.value = message
    } else if (episodeId === null) {
      actionError.value = message
    } else {
      saveErrors.set(episodeId, message)
    }
  }


  async function mutate({ action, url, method, body, episodeId }: SeriesMutation): Promise<boolean> {
    if (accountId.value === null || catalogItemId.value === null || status.value !== 'loaded' || isSaving.value) { return false }

    reads.cancel()

    const request = writes.start()

    isSaving.value = true
    savingEpisodeId.value = episodeId
    savingAction.value = action
    actionError.value = ''
    rewatchError.value = ''
    unauthorized.value = null

    if (episodeId !== null) { saveErrors.delete(episodeId) }

    try {
      const response: unknown = await requestFetch(url, {
        body,
        method,
        retry: 0,
        signal: request.signal
      })

      if (!writes.isCurrent(request)) { return false }

      apply(response)
      pendingRequests.delete(action)

      mutationVersion.value += 1

      await fetchWatches()

      return writes.isCurrent(request)
    } catch (error) {
      if (!writes.isCurrent(request)) { return false }

      const code = isRecord(error) ? error.statusCode : undefined

      if (code === 401) {
        unauthorized.value = 'mutation'
      } else {
        globalThis.console.warn({
          error,
          message: 'Catalog series viewing update request failed.'
        })

        let message = 'We couldn’t save this change. Try again.'

        if (code === 409) {
          message = 'Your current viewing changed. Check the updated episodes and try again.'
        } else if (code === 400 && episodeId === null && !action.startsWith('rewatch:')) {
          message = 'No released episodes with a known air date are available for this action.'
        }

        showSaveError(action, episodeId, message)

        if (code === 400 || code === 409) { pendingRequests.delete(action) }

        if (code === 409) { await fetchWatches() }
      }

      return false
    } finally {
      if (writes.finish(request)) {
        isSaving.value = false
        savingEpisodeId.value = null
        savingAction.value = null
      }
    }
  }

  async function toggle(episodeId: string): Promise<boolean> {
    if (isSaving.value || status.value !== 'loaded') { return false }

    const existing = watches.value.find(mark => mark.catalogEpisodeId === episodeId)
    const action = `episode:${episodeId}`
    let body = pendingRequests.get(action)

    if (body === undefined) {
      if (existing !== undefined && currentViewingId.value !== null) {
        body = {
          currentViewingId: currentViewingId.value,
          contextVersion: contextVersion.value,
          watchId: existing.id
        }
      } else {
        body = newBody() ?? undefined
      }

      if (body === undefined) { return false }

      pendingRequests.set(action, body)
    }

    const method = 'watchId' in body ? 'DELETE' : 'PUT'
    const encodedId = encodeURIComponent(episodeId)
    const url = `/api/catalog/episodes/${encodedId}/watched`

    return mutate({
      action,
      url,
      method,
      body,
      episodeId
    })
  }

  async function markReleased(seasonNumber: number | null): Promise<boolean> {
    const itemId = catalogItemId.value

    if (itemId === null || isSaving.value || status.value !== 'loaded') { return false }

    const action = seasonNumber === null ? 'all' : `season:${seasonNumber}`
    let body = pendingRequests.get(action)

    if (body === undefined) {
      body = newBody() ?? undefined

      if (body === undefined) { return false }

      pendingRequests.set(action, body)
    }

    const encodedId = encodeURIComponent(itemId)
    const suffix = seasonNumber === null ? 'episodes/watched' : `seasons/${seasonNumber}/watched`
    const url = `/api/catalog/items/${encodedId}/${suffix}`

    return mutate({
      action,
      url,
      method: 'POST',
      body,
      episodeId: null
    })
  }

  async function startRewatch(closeStatus?: 'paused' | 'completed'): Promise<boolean> {
    const itemId = catalogItemId.value

    if (itemId === null || currentViewingId.value === null || isSaving.value || status.value !== 'loaded') { return false }

    const action = `rewatch:${closeStatus ?? 'closed'}`
    let body = pendingRequests.get(action)

    if (body === undefined) {
      const base = newBody()

      if (base === null) { return false }

      body = closeStatus === undefined ? base : {
        ...base,
        closeStatus
      }

      pendingRequests.set(action, body)
    }

    const encodedId = encodeURIComponent(itemId)
    const url = `/api/catalog/items/${encodedId}/rewatch`

    return mutate({
      action,
      url,
      method: 'POST',
      body,
      episodeId: null
    })
  }

  function clearUnauthorized(): void { unauthorized.value = null }
  function saveErrorFor(episodeId: string): string { return saveErrors.get(episodeId) ?? '' }

  watch([catalogItemId, accountId, timeZone], () => {
    reset()

    if (automaticLoad) { void load() }
  }, {
    flush: 'sync',
    immediate: true
  })

  return {
    actionError,
    rewatchError,
    clearUnauthorized,
    contextKey,
    contextVersion,
    currentViewing,
    currentViewingId,
    isSaving,
    load,
    markReleased,
    mutationVersion,
    readError,
    saveErrorFor,
    savingAction,
    savingEpisodeId,
    startRewatch,
    status,
    toggle,
    unauthorized,
    watchedCount,
    watchedEpisodeIds,
    watches
  }
}

export { useCatalogEpisodeWatches }
export type CatalogEpisodeWatchesState = ReturnType<typeof useCatalogEpisodeWatches>
