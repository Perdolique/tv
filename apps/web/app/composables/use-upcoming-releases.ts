import { useRequestFetch } from '#app'
import type { CatalogReleaseItem } from '@tv/shared/catalog'
import { isRecord } from '@tv/shared/type-guards'
import * as v from 'valibot'
import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import { catalogUpcomingReleasesResponseSchema } from '~/utils/catalog-response.ts'

interface UpcomingLoadResult {
  addedItems: CatalogReleaseItem[];
  status: 'error' | 'loaded' | 'unauthorized';
}

interface UpcomingRequestQuery {
  cursor?: string;
  from: string;
}

type UpcomingLoadKind = 'initial' | 'more'

// Owns the private cursor list and guarantees that only the newest account, mode, and local date can update it.
function useUpcomingReleases(
  accountId: Readonly<Ref<string | null>>,
  from: Readonly<Ref<string | null>>,
  active: Readonly<Ref<boolean>>
) {
  const requestFetch = useRequestFetch()
  const items = ref<CatalogReleaseItem[]>([])
  const nextCursor = ref<string | null>(null)
  const hasInitialError = ref(false)
  const hasLoadMoreError = ref(false)
  const isInitialLoading = ref(false)
  const isLoadingMore = ref(false)
  const unauthorized = ref(false)
  let controller: InstanceType<typeof globalThis.AbortController> | null = null
  let generation = 0
  let activeRequest: Promise<UpcomingLoadResult> | null = null
  const hasMore = computed(() => nextCursor.value !== null)

  function resetState(): void {
    items.value = []
    nextCursor.value = null
    hasInitialError.value = false
    hasLoadMoreError.value = false
    isInitialLoading.value = false
    isLoadingMore.value = false
    unauthorized.value = false
  }

  function clear(): void {
    generation += 1

    controller?.abort()

    controller = null
    activeRequest = null

    resetState()
  }

  function appendUniqueItems(newItems: CatalogReleaseItem[]): CatalogReleaseItem[] {
    const knownReleaseIds = new Set(items.value.map(item => item.releaseId))
    const addedItems = newItems.filter(item => !knownReleaseIds.has(item.releaseId))

    if (addedItems.length > 0) {
      items.value = [...items.value, ...addedItems]
    }

    return addedItems
  }

  async function runLoad(kind: UpcomingLoadKind): Promise<UpcomingLoadResult> {
    if (activeRequest !== null) {
      return activeRequest
    }

    const requestedAccountId = accountId.value
    const requestedFrom = from.value
    const requestedCursor = kind === 'more' ? nextCursor.value : null

    if (!active.value || requestedAccountId === null || requestedFrom === null) {
      return {
        addedItems: [],
        status: 'loaded'
      }
    }

    if (kind === 'more' && requestedCursor === null) {
      return {
        addedItems: [],
        status: 'loaded'
      }
    }

    const requestGeneration = generation
    const requestController = new globalThis.AbortController()
    const query: UpcomingRequestQuery = { from: requestedFrom }

    if (requestedCursor !== null) {
      query.cursor = requestedCursor
    }

    controller = requestController
    hasInitialError.value = false
    hasLoadMoreError.value = false

    if (kind === 'initial') {
      isInitialLoading.value = true
    } else {
      isLoadingMore.value = true
    }

    const request = (async (): Promise<UpcomingLoadResult> => {
      try {
        const response = await requestFetch('/api/catalog/releases/upcoming', {
          query,
          retry: 0,
          signal: requestController.signal
        })

        requestController.signal.throwIfAborted()

        const parsed = v.safeParse(catalogUpcomingReleasesResponseSchema, response)

        if (!parsed.success) {
          globalThis.console.error('Catalog upcoming releases response validation failed.', parsed.issues)

          if (requestGeneration === generation) {
            if (kind === 'initial') {
              hasInitialError.value = true
            } else {
              hasLoadMoreError.value = true
            }
          }

          return {
            addedItems: [],
            status: 'error'
          }
        }

        if (requestGeneration !== generation) {
          return {
            addedItems: [],
            status: 'loaded'
          }
        }

        const addedItems = appendUniqueItems(parsed.output.items)

        nextCursor.value = parsed.output.nextCursor

        return {
          addedItems,
          status: 'loaded'
        }
      } catch (error) {
        if (requestController.signal.aborted || requestGeneration !== generation) {
          return {
            addedItems: [],
            status: 'loaded'
          }
        }

        if (isRecord(error) && error.statusCode === 401) {
          resetState()

          unauthorized.value = true

          return {
            addedItems: [],
            status: 'unauthorized'
          }
        }

        globalThis.console.warn({
          error,
          message: 'Catalog upcoming releases request failed.'
        })

        if (kind === 'initial') {
          hasInitialError.value = true
        } else {
          hasLoadMoreError.value = true
        }

        return {
          addedItems: [],
          status: 'error'
        }
      } finally {
        if (requestGeneration === generation) {
          isInitialLoading.value = false
          isLoadingMore.value = false
        }

        if (controller === requestController) {
          controller = null
        }
      }
    })()

    activeRequest = request

    try {
      return await request
    } finally {
      if (activeRequest === request) {
        activeRequest = null
      }
    }
  }

  async function loadMore(): Promise<UpcomingLoadResult> {
    return runLoad('more')
  }

  async function reload(): Promise<UpcomingLoadResult> {
    clear()

    return runLoad('initial')
  }

  watch([accountId, from, active], ([currentAccountId, currentFrom, isActive]) => {
    clear()

    if (isActive && currentAccountId !== null && currentFrom !== null) {
      void runLoad('initial')
    }
  }, {
    flush: 'sync',
    immediate: true
  })

  onScopeDispose(clear)

  return {
    clear,
    hasInitialError,
    hasLoadMoreError,
    hasMore,
    isInitialLoading,
    isLoadingMore,
    items,
    loadMore,
    reload,
    unauthorized
  }
}

export { useUpcomingReleases }
export type { UpcomingLoadResult }
