import { useRequestFetch } from '#app'
import { isRecord } from '@tv/shared/type-guards'
import { computed, ref, watch, type Ref } from 'vue'
import * as v from 'valibot'
import { useRequestCancellation } from '~/composables/use-request-cancellation.ts'
import { catalogRatingResponseSchema } from '~/utils/catalog-response.ts'
import { catalogRatingPath, type CatalogRatingTarget } from '~/utils/catalog-rating-target.ts'

type RatingStatus = 'idle' | 'loading' | 'loaded' | 'error'
type RatingUnauthorized = 'load' | 'mutation' | null

function useCatalogRating(
  target: Readonly<Ref<CatalogRatingTarget | null>>,
  accountId: Readonly<Ref<string | null>>
) {
  const requestFetch = useRequestFetch()
  const targetPath = computed(() => target.value === null ? null : catalogRatingPath(target.value))
  const status = ref<RatingStatus>('idle')
  const score = ref<number | null>(null)
  const isSaving = ref(false)
  const saveError = ref('')
  const unauthorized = ref<RatingUnauthorized>(null)
  const requestCancellation = useRequestCancellation()

  function reset(): void {
    requestCancellation.cancel()

    score.value = null
    isSaving.value = false
    saveError.value = ''
    status.value = 'idle'
    unauthorized.value = null
  }

  async function load(): Promise<void> {
    const currentPath = targetPath.value
    const cannotLoad = accountId.value === null || currentPath === null || isSaving.value

    if (cannotLoad) {
      return
    }

    const request = requestCancellation.start()

    saveError.value = ''
    status.value = 'loading'
    unauthorized.value = null

    try {
      const requestUrl = `${currentPath}/rating`

      const response = await requestFetch(
        requestUrl,
        {
          retry: 0,
          signal: request.signal
        }
      )

      if (!requestCancellation.isCurrent(request)) {
        return
      }

      const parsed = v.safeParse(catalogRatingResponseSchema, response)

      if (!parsed.success) {
        globalThis.console.error('Catalog rating response validation failed.', parsed.issues)

        status.value = 'error'

        return
      }

      score.value = parsed.output.score
      status.value = 'loaded'
    } catch (error) {
      if (!requestCancellation.isCurrent(request)) {
        return
      }

      const isUnauthorized = isRecord(error) && error.statusCode === 401

      if (isUnauthorized) {
        unauthorized.value = 'load'

        return
      }

      globalThis.console.warn({
        error,
        message: 'Catalog rating request failed.'
      })

      status.value = 'error'
    } finally {
      requestCancellation.finish(request)
    }
  }

  async function save(nextScore: number | null): Promise<boolean> {
    const currentPath = targetPath.value
    const cannotSave = accountId.value === null || currentPath === null || status.value !== 'loaded' || isSaving.value

    if (cannotSave) {
      return false
    }

    const request = requestCancellation.start()

    isSaving.value = true
    saveError.value = ''
    unauthorized.value = null

    try {
      const requestUrl = `${currentPath}/rating`
      const method = nextScore === null ? 'DELETE' : 'PUT'
      const body = nextScore === null ? undefined : { score: nextScore }

      const response = await requestFetch(requestUrl, {
        method,
        body,
        retry: 0,
        signal: request.signal
      })

      if (!requestCancellation.isCurrent(request)) {
        return false
      }

      const parsed = v.safeParse(catalogRatingResponseSchema, response)
      const isInvalidResponse = !parsed.success || parsed.output.score !== nextScore

      if (isInvalidResponse) {
        if (parsed.success) {
          globalThis.console.error('Catalog rating response did not match the requested score.')
        } else {
          globalThis.console.error('Catalog rating response validation failed.', parsed.issues)
        }

        saveError.value = 'We couldn’t save your rating. Try again.'

        return false
      }

      score.value = parsed.output.score

      return true
    } catch (error) {
      if (!requestCancellation.isCurrent(request)) {
        return false
      }

      const isUnauthorized = isRecord(error) && error.statusCode === 401

      if (isUnauthorized) {
        unauthorized.value = 'mutation'

        return false
      }

      globalThis.console.warn({
        error,
        message: 'Catalog rating update request failed.'
      })

      saveError.value = 'We couldn’t save your rating. Try again.'

      return false
    } finally {
      if (requestCancellation.finish(request)) {
        isSaving.value = false
      }
    }
  }

  watch([targetPath, accountId], ([currentPath, currentAccountId]) => {
    reset()

    const shouldLoad = !import.meta.env.SSR && currentPath !== null && currentAccountId !== null

    if (shouldLoad) {
      void load()
    }
  }, {
    flush: 'sync',
    immediate: true
  })

  return {
    isSaving,
    load,
    save,
    saveError,
    score,
    status,
    unauthorized
  }
}

export { useCatalogRating }
export type { RatingStatus }
