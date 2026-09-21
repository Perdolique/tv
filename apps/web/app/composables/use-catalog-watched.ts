import { useRequestFetch } from '#app'
import { isRecord } from '@tv/shared/type-guards'
import { ref, watch, type Ref } from 'vue'
import * as v from 'valibot'
import { useRequestCancellation } from '~/composables/use-request-cancellation.ts'
import { catalogWatchedResponseSchema } from '~/utils/catalog-response.ts'

type WatchedStatus = 'idle' | 'loading' | 'loaded' | 'error'
type WatchedUnauthorized = 'load' | 'mutation' | null

interface CatalogWatchedOptions {
  automaticLoad?: boolean;
}

function useCatalogWatched(
  catalogItemId: Readonly<Ref<string | null>>,
  accountId: Readonly<Ref<string | null>>,
  { automaticLoad = import.meta.client }: CatalogWatchedOptions = {}
) {
  const requestFetch = useRequestFetch()
  const status = ref<WatchedStatus>('idle')
  const watched = ref(false)
  const isSaving = ref(false)
  const saveError = ref('')
  const unauthorized = ref<WatchedUnauthorized>(null)
  const requestCancellation = useRequestCancellation()

  function reset(): void {
    requestCancellation.cancel()

    watched.value = false
    isSaving.value = false
    saveError.value = ''
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

    saveError.value = ''
    status.value = 'loading'
    unauthorized.value = null

    try {
      const response = await requestFetch(
        `/api/catalog/items/${encodeURIComponent(currentCatalogItemId)}/watched`,
        {
          retry: 0,
          signal: request.signal
        }
      )

      if (!requestCancellation.isCurrent(request)) {
        return
      }

      const parsed = v.safeParse(catalogWatchedResponseSchema, response)

      if (!parsed.success) {
        globalThis.console.error('Catalog watched response validation failed.', parsed.issues)

        status.value = 'error'

        return
      }

      watched.value = parsed.output.watched
      status.value = 'loaded'
    } catch (error) {
      if (!requestCancellation.isCurrent(request)) {
        return
      }

      if (isRecord(error) && error.statusCode === 401) {
        status.value = 'idle'
        unauthorized.value = 'load'

        return
      }

      globalThis.console.warn({
        error,
        message: 'Catalog watched status request failed.'
      })

      status.value = 'error'
    } finally {
      requestCancellation.finish(request)
    }
  }

  async function toggle(): Promise<void> {
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

    const previousWatched = watched.value
    const nextWatched = !previousWatched
    const request = requestCancellation.start()

    watched.value = nextWatched
    isSaving.value = true
    saveError.value = ''
    unauthorized.value = null

    try {
      const requestUrl = `/api/catalog/items/${encodeURIComponent(currentCatalogItemId)}/watched` as const
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

      if (parsed.success && parsed.output.watched === nextWatched) {
        watched.value = parsed.output.watched
      } else {
        if (parsed.success) {
          globalThis.console.error('Catalog watched response did not match the requested state.')
        } else {
          globalThis.console.error('Catalog watched response validation failed.', parsed.issues)
        }

        watched.value = previousWatched
        saveError.value = 'We couldn’t update your watched status. Try again.'
      }
    } catch (error) {
      if (!requestCancellation.isCurrent(request)) {
        return
      }

      watched.value = previousWatched

      if (isRecord(error) && error.statusCode === 401) {
        unauthorized.value = 'mutation'

        return
      }

      globalThis.console.warn({
        error,
        message: 'Catalog watched update request failed.'
      })

      saveError.value = 'We couldn’t update your watched status. Try again.'
    } finally {
      if (requestCancellation.finish(request)) {
        isSaving.value = false
      }
    }
  }

  function clearUnauthorized(): void {
    unauthorized.value = null
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
    saveError,
    status,
    toggle,
    unauthorized,
    watched
  }
}

export { useCatalogWatched }
