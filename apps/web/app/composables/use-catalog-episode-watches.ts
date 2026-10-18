import { useRequestFetch } from '#app'
import { catalogSeriesWatchesResponseSchema, type CatalogSeriesEpisodeWatch } from '@tv/shared/catalog-series'
import { isRecord } from '@tv/shared/type-guards'
import { computed, ref, shallowRef, toRef, watch, type Ref } from 'vue'
import * as v from 'valibot'
import type { CatalogViewingsState } from '~/composables/use-catalog-viewings.ts'
import { useRequestCancellation } from '~/composables/use-request-cancellation.ts'
import { getLocalCalendarDate } from '~/utils/calendar-date.ts'

interface CatalogEpisodeWatchesOptions {
  automaticLoad?: boolean;
  timeZone: Readonly<Ref<string | null>>;
  viewings: CatalogViewingsState;
}
interface SeriesMutation {
  action: string;
  url: string;
  method: 'POST' | 'PUT' | 'DELETE';
  body: Record<string, unknown>;
  episodeId: string | null;
}
function useCatalogEpisodeWatches(catalogItemId: Readonly<Ref<string | null>>, accountId: Readonly<Ref<string | null>>, { automaticLoad = import.meta.client, timeZone, viewings }: CatalogEpisodeWatchesOptions) {
  const requestFetch = useRequestFetch()
  const reads = useRequestCancellation()
  const status = shallowRef<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const watches = ref<CatalogSeriesEpisodeWatch[]>([])
  const watchedEpisodeIds = computed(() => watches.value.map(mark => mark.catalogEpisodeId))
  const watchedCount = toRef(() => watches.value.length)
  const { isSaving, currentViewing } = viewings
  const savingEpisodeId = shallowRef<string | null>(null)
  const savingAction = shallowRef<string | null>(null)
  const readError = shallowRef('')
  const actionError = shallowRef('')
  const initialSaveErrors = new Map<string, string>()
  const saveErrors = ref(initialSaveErrors)
  const unauthorized = shallowRef<'load' | 'mutation' | null>(null)
  const confirmationEpisodeId = shallowRef<string | null>(null)
  const currentViewingId = toRef(() => viewings.summary.value.currentViewingId)
  const contextVersion = toRef(() => viewings.summary.value.contextVersion)

  function reset(): void {
    reads.cancel()

    watches.value = []
    status.value = 'idle'
    readError.value = ''
    actionError.value = ''

    saveErrors.value.clear()

    unauthorized.value = null
    confirmationEpisodeId.value = null
    savingEpisodeId.value = null
    savingAction.value = null
  }
  function apply(response: unknown): void {
    const result = v.parse(catalogSeriesWatchesResponseSchema, response)
    const selectedId = viewings.selectedViewingId.value

    if (selectedId !== null && result.viewing?.id !== selectedId) { throw new Error('Episode watches viewing mismatch') }

    viewings.applyConfirmed(result)

    watches.value = result.watches
    status.value = 'loaded'
  }
  async function load(): Promise<boolean> {
    const itemId = catalogItemId.value

    if (accountId.value === null || itemId === null || timeZone.value === null || isSaving.value || viewings.pendingMutation.value !== null) { return false }

    const request = reads.start()
    const hadData = status.value === 'loaded'

    readError.value = ''

    if (!hadData) { status.value = 'loading' }

    try {
      const id = encodeURIComponent(itemId)
      const viewingId = viewings.selectedViewingId.value
      const url = `/api/catalog/items/${id}/episodes/watched`

      const response: unknown = await requestFetch(url, {
        query: viewingId === null ? undefined : { viewingId },
        retry: 0,
        signal: request.signal
      })

      if (!reads.isCurrent(request)) { return false }

      apply(response)

      return true
    } catch (error) {
      if (!reads.isCurrent(request)) { return false }

      if (isRecord(error) && error.statusCode === 401) { unauthorized.value = 'load' }
      else {
        globalThis.console.warn({
          error,
          message: 'Catalog episode watches request failed.'
        })

        readError.value = 'We couldn’t refresh your watched episodes. Try again.'

        if (!hadData) { status.value = 'error' }
      }

      return false
    } finally { reads.finish(request) }
  }
  function newBody(requestId: string): Record<string, unknown> {
    const viewingDate = getLocalCalendarDate()

    return {
      requestId,
      currentViewingId: currentViewingId.value,
      contextVersion: contextVersion.value,
      timeZone: timeZone.value,
      viewingDate
    }
  }
  async function mutate({ action, url, method, body, episodeId }: SeriesMutation): Promise<boolean> {
    if (status.value !== 'loaded' || viewings.isHistorical.value || isSaving.value) { return false }

    reads.cancel()

    savingAction.value = action
    savingEpisodeId.value = episodeId
    actionError.value = ''

    if (episodeId !== null) { saveErrors.value.delete(episodeId) }

    const response = await viewings.mutate({
      key: action,
      url,
      method,
      body,
      operation: 'watches'
    })

    savingAction.value = null
    savingEpisodeId.value = null

    if (response === null) {
      unauthorized.value = viewings.unauthorized.value

      if (viewings.fields.value.confirmRatingRemoval !== undefined && episodeId !== null) {
        confirmationEpisodeId.value = episodeId
        viewings.saveError.value = ''
      } else if (episodeId === null) { actionError.value = viewings.saveError.value }
      else { saveErrors.value.set(episodeId, viewings.saveError.value) }

      return false
    }

    apply(response)

    confirmationEpisodeId.value = null

    return true
  }
  async function toggle(episodeId: string, isRated = false, confirmed = false): Promise<boolean> {
    if (isSaving.value || viewings.isHistorical.value) { return false }

    const existing = watches.value.find(mark => mark.catalogEpisodeId === episodeId)

    if (existing !== undefined && isRated && !confirmed) {
      confirmationEpisodeId.value = episodeId

      return false
    }

    const requestId = globalThis.crypto.randomUUID()

    const body = existing === undefined ? newBody(requestId) : {
      requestId,
      currentViewingId: currentViewingId.value,
      contextVersion: contextVersion.value,
      watchId: existing.id,
      confirmRatingRemoval: confirmed
    }

    const id = encodeURIComponent(episodeId)

    return mutate({
      action: `episode:${episodeId}`,
      url: `/api/catalog/episodes/${id}/watched`,
      method: existing === undefined ? 'PUT' : 'DELETE',
      body,
      episodeId
    })
  }
  async function confirmUnwatch(): Promise<boolean> {
    const id = confirmationEpisodeId.value

    if (id === null) { return false }

    return toggle(id, true, true)
  }
  function cancelUnwatch(): void { if (!isSaving.value) { confirmationEpisodeId.value = null } }
  async function markReleased(seasonNumber: number | null): Promise<boolean> {
    const itemId = catalogItemId.value

    if (itemId === null) { return false }

    const id = encodeURIComponent(itemId)
    const suffix = seasonNumber === null ? 'episodes/watched' : `seasons/${seasonNumber}/watched`
    const action = seasonNumber === null ? 'all' : `season:${seasonNumber}`
    const requestId = globalThis.crypto.randomUUID()
    const body = newBody(requestId)

    return mutate({
      action,
      url: `/api/catalog/items/${id}/${suffix}`,
      method: 'POST',
      body,
      episodeId: null
    })
  }
  function saveErrorFor(id: string): string { return saveErrors.value.get(id) ?? '' }
  function clearUnauthorized(): void { unauthorized.value = null }

  watch([() => catalogItemId.value, () => accountId.value, () => timeZone.value, () => viewings.selectionKey.value], () => {
    reset()

    if (automaticLoad) { void load() }
  }, {
    flush: 'sync',
    immediate: true
  })

  watch(viewings.isSaving, saving => {
    if (saving) { reads.cancel() }
    else if (automaticLoad && viewings.pendingMutation.value === null) { void load() }
  }, { flush: 'sync' })

  watch(viewings.confirmedWatches, marks => {
    const selected = viewings.selectedViewingId.value ?? currentViewingId.value

    if (marks !== null && viewings.watchesViewingId.value === selected) { watches.value = marks; status.value = 'loaded' }
  }, { flush: 'post' })

  return {
    actionError,
    cancelUnwatch,
    clearUnauthorized,
    confirmUnwatch,
    confirmationEpisodeId,
    contextVersion,
    currentViewing,
    currentViewingId,
    isSaving,
    load,
    markReleased,
    readError,
    saveErrorFor,
    savingAction,
    savingEpisodeId,
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
