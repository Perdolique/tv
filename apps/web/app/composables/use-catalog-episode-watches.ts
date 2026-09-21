import { useRequestFetch } from '#app'
import { isRecord } from '@tv/shared/type-guards'
import { computed, reactive, ref, watch, type Ref } from 'vue'
import * as v from 'valibot'
import { useRequestCancellation } from '~/composables/use-request-cancellation.ts'
import { catalogEpisodeWatchesResponseSchema, catalogWatchedResponseSchema } from '~/utils/catalog-response.ts'

type EpisodeWatchesStatus = 'idle' | 'loading' | 'loaded' | 'error'
type EpisodeWatchesUnauthorized = 'load' | 'mutation' | null

interface CatalogEpisodeWatchesOptions {
  automaticLoad?: boolean;
}

function useCatalogEpisodeWatches(
  catalogItemId: Readonly<Ref<string | null>>,
  accountId: Readonly<Ref<string | null>>,
  { automaticLoad = import.meta.client }: CatalogEpisodeWatchesOptions = {}
) {
  const requestFetch = useRequestFetch()
  const status = ref<EpisodeWatchesStatus>('idle')
  const watchedEpisodeIds = ref<string[]>([])
  const isSaving = ref(false)
  const savingEpisodeId = ref<string | null>(null)
  const saveErrors = reactive(new Map<string, string>())
  const unauthorized = ref<EpisodeWatchesUnauthorized>(null)
  const requestCancellation = useRequestCancellation()
  const watchedCount = computed(() => watchedEpisodeIds.value.length)

  function reset(): void {
    requestCancellation.cancel()

    watchedEpisodeIds.value = []
    isSaving.value = false
    savingEpisodeId.value = null

    saveErrors.clear()

    status.value = 'idle'
    unauthorized.value = null
  }

  async function load(): Promise<void> {
    const currentAccountId = accountId.value
    const currentCatalogItemId = catalogItemId.value

    if (currentAccountId === null || currentCatalogItemId === null) {
      return
    }

    const request = requestCancellation.start()

    saveErrors.clear()

    status.value = 'loading'
    unauthorized.value = null

    try {
      const response = await requestFetch(
        `/api/catalog/items/${encodeURIComponent(currentCatalogItemId)}/episodes/watched`,
        {
          retry: 0,
          signal: request.signal
        }
      )

      if (!requestCancellation.isCurrent(request)) {
        return
      }

      const parsed = v.safeParse(catalogEpisodeWatchesResponseSchema, response)

      if (!parsed.success) {
        globalThis.console.error('Catalog episode watches response validation failed.', parsed.issues)

        status.value = 'error'

        return
      }

      watchedEpisodeIds.value = parsed.output.watchedEpisodeIds
      status.value = 'loaded'
    } catch (error) {
      if (!requestCancellation.isCurrent(request)) {
        return
      }

      if (isRecord(error) && error.statusCode === 401) {
        watchedEpisodeIds.value = []
        status.value = 'idle'
        unauthorized.value = 'load'

        return
      }

      globalThis.console.warn({
        error,
        message: 'Catalog episode watches request failed.'
      })

      status.value = 'error'
    } finally {
      requestCancellation.finish(request)
    }
  }

  async function toggle(episodeId: string): Promise<void> {
    const currentAccountId = accountId.value
    const currentCatalogItemId = catalogItemId.value

    if (
      currentAccountId === null
      || currentCatalogItemId === null
      || status.value !== 'loaded'
      || isSaving.value
    ) {
      return
    }

    const previousEpisodeIds = watchedEpisodeIds.value
    const wasWatched = previousEpisodeIds.includes(episodeId)
    const nextWatched = !wasWatched
    const request = requestCancellation.start()

    watchedEpisodeIds.value = nextWatched
      ? [...previousEpisodeIds, episodeId]
      : previousEpisodeIds.filter(id => id !== episodeId)

    isSaving.value = true
    savingEpisodeId.value = episodeId

    saveErrors.delete(episodeId)

    unauthorized.value = null

    try {
      const requestUrl = `/api/catalog/episodes/${encodeURIComponent(episodeId)}/watched` as const
      const method = nextWatched ? 'PUT' : 'DELETE'

      const response = await requestFetch(requestUrl, {
        method,
        retry: 0,
        signal: request.signal
      })

      if (!requestCancellation.isCurrent(request)) {
        return
      }

      const parsed = v.safeParse(catalogWatchedResponseSchema, response)

      if (!parsed.success || parsed.output.watched !== nextWatched) {
        if (parsed.success) {
          globalThis.console.error('Catalog episode watched response did not match the requested state.')
        } else {
          globalThis.console.error('Catalog episode watched response validation failed.', parsed.issues)
        }

        watchedEpisodeIds.value = previousEpisodeIds

        saveErrors.set(episodeId, 'We couldn’t update this episode. Try again.')
      }
    } catch (error) {
      if (!requestCancellation.isCurrent(request)) {
        return
      }

      watchedEpisodeIds.value = previousEpisodeIds

      if (isRecord(error) && error.statusCode === 401) {
        unauthorized.value = 'mutation'

        return
      }

      globalThis.console.warn({
        error,
        message: 'Catalog episode watched update request failed.'
      })

      saveErrors.set(episodeId, 'We couldn’t update this episode. Try again.')
    } finally {
      if (requestCancellation.finish(request)) {
        isSaving.value = false
        savingEpisodeId.value = null
      }
    }
  }

  function clearUnauthorized(): void {
    unauthorized.value = null
  }

  function saveErrorFor(episodeId: string): string {
    return saveErrors.get(episodeId) ?? ''
  }

  watch([catalogItemId, accountId], ([currentCatalogItemId, currentAccountId]) => {
    reset()

    if (
      automaticLoad
      && currentCatalogItemId !== null
      && currentAccountId !== null
    ) {
      void load()
    }
  }, {
    flush: 'sync',
    immediate: true
  })

  return {
    clearUnauthorized,
    isSaving,
    load,
    saveErrorFor,
    savingEpisodeId,
    status,
    toggle,
    unauthorized,
    watchedCount,
    watchedEpisodeIds
  }
}

export { useCatalogEpisodeWatches }
