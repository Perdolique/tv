import { useRequestFetch } from '#app'
import { catalogRatingMutationResponseSchema } from '@tv/shared/catalog-viewings'
import { isRecord } from '@tv/shared/type-guards'
import { shallowRef, toRef, watch, type Ref } from 'vue'
import * as v from 'valibot'
import { useRequestCancellation } from '~/composables/use-request-cancellation.ts'
import type { CatalogViewingsState } from '~/composables/use-catalog-viewings.ts'
import { catalogRatingPath, type CatalogRatingTarget } from '~/utils/catalog-rating-target.ts'

type RatingStatus = 'idle' | 'loading' | 'loaded' | 'error'

function useCatalogRating(target: Readonly<Ref<CatalogRatingTarget | null>>, accountId: Readonly<Ref<string | null>>, viewings: CatalogViewingsState) {
  const requestFetch = useRequestFetch()
  const targetPath = toRef(() => target.value === null ? null : catalogRatingPath(target.value))
  const status = shallowRef<RatingStatus>('idle')
  const score = shallowRef<number | null>(null)
  const saveError = shallowRef('')
  const unauthorized = shallowRef<'load' | 'mutation' | null>(null)
  const reads = useRequestCancellation()
  const { isSaving } = viewings
  const mutationKey = toRef(() => `rating:${targetPath.value}:${viewings.selectedViewingId.value ?? 'current'}`)
  const hasUnconfirmedMutation = toRef(() => viewings.unconfirmedMutation.value?.key === mutationKey.value)
  const isBlocked = toRef(() => viewings.isMutationBlocked(mutationKey.value))
  let writeRequest: object | null = null
  const needsViewing = toRef(() => viewings.summary.value.currentViewingId === null && viewings.selectedViewingId.value === null)

  function reset(): void {
    reads.cancel()

    score.value = null
    saveError.value = ''
    status.value = 'idle'
    unauthorized.value = null
  }
  async function load(): Promise<void> {
    const path = targetPath.value

    if (path === null || accountId.value === null || isSaving.value || viewings.pendingMutation.value !== null) { return }

    const request = reads.start()
    const viewingId = viewings.selectedViewingId.value

    status.value = 'loading'

    try {
      const url = `${path}/rating`

      const response: unknown = await requestFetch(url, {
        query: viewingId === null ? undefined : { viewingId },
        retry: 0,
        signal: request.signal
      })

      if (!reads.isCurrent(request)) { return }

      const result = v.parse(catalogRatingMutationResponseSchema, response)

      if (viewingId !== null && result.viewing?.id !== viewingId) { throw new Error('Rating response viewing mismatch') }

      viewings.applyConfirmed(result)

      score.value = result.score
      status.value = 'loaded'
    } catch (error) {
      if (!reads.isCurrent(request)) { return }

      if (isRecord(error) && error.statusCode === 401) { unauthorized.value = 'load' }
      else {
        globalThis.console.warn({
        error,
        message: 'Catalog rating request failed.'
      })

        status.value = 'error'
      }
    } finally { reads.finish(request) }
  }
  async function save(nextScore: number | null, viewingDate?: string): Promise<boolean> {
    const path = targetPath.value
    const ratingTarget = target.value

    if (path === null || ratingTarget === null || status.value !== 'loaded' || isSaving.value) { return false }

    reads.cancel()

    saveError.value = ''

    const requestAccount = accountId.value
    const requestViewingId = viewings.selectedViewingId.value
    const request = {}

    writeRequest = request

    const selected = viewings.selectedViewing.value
    const historical = viewings.isHistorical.value && selected !== null
    const itemId = encodeURIComponent(ratingTarget.catalogItemId)
    const viewingId = selected === null ? '' : encodeURIComponent(selected.id)
    const suffix = ratingTarget.seasonNumber === null ? '' : `/seasons/${ratingTarget.seasonNumber}`
    const url = historical ? `/api/catalog/items/${itemId}/viewings/${viewingId}${suffix}/rating` : `${path}/rating`
    const ratingViewing = historical ? selected : undefined

    const response = await viewings.saveScore({
      url,
      key: mutationKey.value,
      score: nextScore,
      viewingDate,
      viewing: ratingViewing
    })

    if (writeRequest === request) { writeRequest = null }

    if (path !== targetPath.value || requestAccount !== accountId.value || requestViewingId !== viewings.selectedViewingId.value) { return false }

    if (response === null) {
      saveError.value = viewings.saveError.value
      unauthorized.value = viewings.unauthorized.value

      return false
    }

    const result = v.parse(catalogRatingMutationResponseSchema, response)

    score.value = result.score
    status.value = 'loaded'

    return true
  }
  async function retryMutation(): Promise<boolean> {
    const saved = await viewings.retryMutation()

    if (saved) { await load() }
    else { saveError.value = viewings.saveError.value }

    return saved
  }

  watch([() => targetPath.value, () => accountId.value, () => viewings.selectionKey.value], () => {
    reset()

    if (!import.meta.env.SSR) { void load() }
  }, {
    flush: 'sync',
    immediate: true
  })

  watch(viewings.isSaving, saving => {
    if (saving) { reads.cancel() }
    else if (!import.meta.env.SSR && writeRequest === null && viewings.pendingMutation.value === null && (status.value === 'idle' || status.value === 'loading')) { void load() }
  }, { flush: 'sync' })

  return {
    hasUnconfirmedMutation,
    isBlocked,
    isSaving,
    load,
    needsViewing,
    retryMutation,
    save,
    saveError,
    score,
    status,
    unauthorized
  }
}
export { useCatalogRating }
export type { RatingStatus }
