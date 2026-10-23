import { useAsyncData, useRequestFetch } from '#app'
import { isRecord } from '@tv/shared/type-guards'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import * as v from 'valibot'

type ReadOutcome<Data> = { status: 'loaded'; data: Data } | { status: 'error' | 'not-found' }

interface CatalogReadOptions<Schema extends v.GenericSchema> {
  schema: Schema;
  immediate?: boolean;
}

// Owns SSR payload reuse, cancellation, and confirmed content. Callers own access checks.
function useCatalogRead<Schema extends v.GenericSchema>(key: string, url: string, { schema, immediate = true }: CatalogReadOptions<Schema>) {
  const requestFetch = useRequestFetch()
  const data = shallowRef<v.InferOutput<Schema>>()

  const ready = useAsyncData(key, async (_app, { signal }): Promise<ReadOutcome<v.InferOutput<Schema>>> => {
    try {
      const response = await requestFetch(url, {
        retry: 0,
        signal
      })

      const parsed = v.safeParse(schema, response)

      if (!parsed.success) {
        globalThis.console.error('Public catalog response validation failed.', parsed.issues)

        return { status: 'error' }
      }

      return {
        status: 'loaded',
        data: parsed.output
      }
    } catch (error) {
      if (signal.aborted) { throw error }

      const notFound = isRecord(error) && (error.statusCode === 404 || error.statusCode === 400)

      return { status: notFound ? 'not-found' : 'error' }
    }
  }, {
    immediate,
    lazy: true,
    dedupe: 'cancel'
  })

  watch(ready.data, result => {
    if (result?.status === 'loaded') { data.value = result.data }

    if (result?.status === 'not-found') { data.value = undefined }
  }, {
    immediate: true,
    flush: 'sync'
  })

  const hasError = computed(() => ready.data.value?.status === 'error' || ready.status.value === 'error')
  const isNotFound = computed(() => ready.data.value?.status === 'not-found')
  const isLoading = computed(() => ready.status.value === 'pending' || ready.status.value === 'idle')

  onScopeDispose(() => { ready.clear() })

  return {
    data,
    ready,
    hasError,
    isNotFound,
    isLoading
  }
}

export { useCatalogRead }
