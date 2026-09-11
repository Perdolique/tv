import { useRequestFetch } from '#app'
import { isRecord } from '@tv/shared/type-guards'
import { ref, watch, type Ref } from 'vue'
import * as v from 'valibot'
import { useRequestCancellation } from '~/composables/use-request-cancellation.ts'
import { catalogFollowResponseSchema } from '~/utils/catalog-response.ts'

type FollowStatus = 'idle' | 'loading' | 'loaded' | 'error'
type FollowUnauthorized = 'load' | 'mutation' | null

interface CatalogFollowOptions {
  automaticLoad?: boolean;
}

function useCatalogFollow(
  catalogItemId: Readonly<Ref<string | null>>,
  accountId: Readonly<Ref<string | null>>,
  { automaticLoad = import.meta.client }: CatalogFollowOptions = {}
) {
  const requestFetch = useRequestFetch()
  const status = ref<FollowStatus>('idle')
  const followed = ref(false)
  const isSaving = ref(false)
  const saveError = ref('')
  const unauthorized = ref<FollowUnauthorized>(null)
  const requestCancellation = useRequestCancellation()

  function reset(): void {
    requestCancellation.cancel()

    followed.value = false
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
        `/api/catalog/items/${encodeURIComponent(currentCatalogItemId)}/follow`,
        {
          retry: 0,
          signal: request.signal
        }
      )

      if (!requestCancellation.isCurrent(request)) {
        return
      }

      const parsed = v.safeParse(catalogFollowResponseSchema, response)

      if (!parsed.success) {
        globalThis.console.error('Catalog follow response validation failed.', parsed.issues)

        status.value = 'error'

        return
      }

      followed.value = parsed.output.followed
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
        message: 'Catalog follow status request failed.'
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

    const previousFollowed = followed.value
    const nextFollowed = !previousFollowed
    const method = nextFollowed ? 'PUT' : 'DELETE'
    const request = requestCancellation.start()

    followed.value = nextFollowed
    isSaving.value = true
    saveError.value = ''
    unauthorized.value = null

    try {
      const response = await requestFetch(
        `/api/catalog/items/${encodeURIComponent(currentCatalogItemId)}/follow`,
        {
          method,
          retry: 0,
          signal: request.signal
        }
      )

      if (!requestCancellation.isCurrent(request)) {
        return
      }

      const parsed = v.safeParse(catalogFollowResponseSchema, response)

      if (parsed.success && parsed.output.followed === nextFollowed) {
        followed.value = parsed.output.followed
      } else {
        if (parsed.success) {
          globalThis.console.error('Catalog follow response did not match the requested state.')
        } else {
          globalThis.console.error('Catalog follow response validation failed.', parsed.issues)
        }

        followed.value = previousFollowed
        saveError.value = 'We couldn’t save this change. Try again.'
      }
    } catch (error) {
      if (!requestCancellation.isCurrent(request)) {
        return
      }

      followed.value = previousFollowed

      if (isRecord(error) && error.statusCode === 401) {
        unauthorized.value = 'mutation'

        return
      }

      globalThis.console.warn({
        error,
        message: 'Catalog follow update request failed.'
      })

      saveError.value = 'We couldn’t save this change. Try again.'
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
    followed,
    isSaving,
    load,
    saveError,
    status,
    toggle,
    unauthorized
  }
}

export { useCatalogFollow }
