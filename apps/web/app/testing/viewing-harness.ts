import { afterEach, beforeEach, vi } from 'vitest'
import { computed, effectScope, ref, shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { movie, summary } from './viewing-fixtures.ts'

interface RequestOptions {
  signal: AbortSignal;
  query?: Record<'cursor', string>;
}

const harness = vi.hoisted(() => {
  return { fetch: vi.fn<(url: string, options: RequestOptions) => Promise<unknown>>() }
})

// Models reactive Nuxt keys and cancellation in the Node test environment.
vi.mock('#app', () => {
  interface Entry {
    data: ReturnType<typeof shallowRef<unknown>>;
    status: ReturnType<typeof ref<string>>;
    controller: AbortController | null;
  }

  const entries = new Map<string, Entry>()

  function entry(key: string): Entry {
    const existing = entries.get(key)

    if (existing !== undefined) {
      return existing
    }

    const created = {
      data: shallowRef<unknown>(),
      status: ref('idle'),
      controller: null
    }

    entries.set(key, created)

    return created
  }

  function clearNuxtData(key: string): void {
    const current = entry(key)

    current.controller?.abort()

    current.data.value = undefined
    current.status.value = 'idle'
  }

  return {
    clearNuxtData,
    useRequestFetch: () => harness.fetch,

    // oxlint-disable-next-line typescript/promise-function-async -- Nuxt's promise also exposes refs synchronously.
    useAsyncData: (key: MaybeRefOrGetter<string>, handler: (app: unknown, options: RequestOptions) => Promise<unknown>) => {
      const current = computed(() => entry(toValue(key)))

      const execute = async () => {
        const target = current.value
        const controller = new globalThis.AbortController()

        target.controller?.abort()

        target.controller = controller
        target.status.value = 'pending'

        try {
          const result = await handler({}, { signal: controller.signal })

          if (!controller.signal.aborted) {
            target.data.value = result
            target.status.value = 'success'
          }
        } catch {
          if (!controller.signal.aborted) {
            target.status.value = 'error'
          }
        }
      }

      watch(() => toValue(key), execute, { flush: 'sync' })

      const pending = execute()

      return Object.assign(pending, {
        data: computed(() => current.value.data.value),
        status: computed(() => current.value.status.value),
        clear: () => { clearNuxtData(toValue(key)) },
        execute
      })
    }
  }
})

const { useViewingHistory } = await import('~/composables/use-viewing-history.ts')
const { useViewingSummary } = await import('~/composables/use-viewing-summary.ts')
const scopes: ReturnType<typeof effectScope>[] = []

function setup(initialAccount: string | null = 'first') {
  const scope = effectScope()
  const accountId = ref(initialAccount)

  scopes.push(scope)

  const result = scope.run(() => {
    return {
      history: useViewingHistory(accountId),
      summary: useViewingSummary(accountId)
    }
  })

  if (result === undefined) {
    throw new Error('Missing effect scope')
  }

  return {
    accountId,
    history: result.history,
    scope,
    summary: result.summary
  }
}

function initialResponses(): void {
  harness.fetch
    .mockResolvedValueOnce({
      items: [movie],
      nextCursor: 'first-page'
    })
    .mockResolvedValueOnce(summary)
}

beforeEach(() => {
  harness.fetch.mockReset()
})

afterEach(() => {
  for (const scope of scopes.splice(0)) {
    scope.stop()
  }

  vi.restoreAllMocks()
})

export { harness, initialResponses, setup }
