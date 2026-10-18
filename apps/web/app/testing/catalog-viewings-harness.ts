import { afterEach, beforeEach, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import type { CatalogViewing } from '@tv/shared/catalog-viewings'

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal: AbortSignal;
}

const harness = vi.hoisted(() => {return { fetch: vi.fn<(url: string, options: RequestOptions) => Promise<unknown>>() }})

vi.mock('#app', () => {return { useRequestFetch: () => harness.fetch }})

const { useCatalogViewings } = await import('~/composables/use-catalog-viewings.ts')
const id = '01991a00-0000-7000-8000-000000000001'

const viewing: CatalogViewing = {
  id: '01991a00-0000-7000-8000-000000000002',
  catalogItemId: id,
  status: 'completed',
  startedOn: null,
  completedOn: '2026-10-17',
  recordedAt: '2020-01-01T12:00:00.123456Z',
  revision: 1,
  score: null,
  isRewatch: false,
  canCancelRewatch: false
}

const emptySummary = {
  completedCount: 0,
  currentViewingId: null,
  contextVersion: 0,
  currentViewingScore: null,
  currentVoteScore: null
}

const summary = {
  completedCount: 1,
  currentViewingId: viewing.id,
  contextVersion: 1,
  currentViewingScore: null,
  currentVoteScore: null
}

const empty = {
  items: [],
  summary: emptySummary,
  nextCursor: null
}

const scopes: ReturnType<typeof effectScope>[] = []

function setup(automaticLoad = false, type: 'movie' | 'series' = 'movie') {
  const scope = effectScope()
  const account = ref<string | null>('account-one')
  const item = ref<string | null>(id)

  const state = scope.run(() => useCatalogViewings(item, account, {
    automaticLoad,
    type: ref<'movie' | 'series' | null>(type),
    timeZone: ref<string | null>('Europe/Tallinn')
  }))

  scopes.push(scope)

  if (state === undefined) { throw new Error('Missing viewing state') }

  return {
    account,
    item,
    state,
    scope
  }
}

  beforeEach(() => {
    harness.fetch.mockReset()
    vi.stubEnv('SSR', true)
    vi.useFakeTimers({ toFake: ['Date'] })

    const today = new Date(2026, 9, 17, 12)

    vi.setSystemTime(today)

    vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {
      // Expected failures are inspected through safe state.
    })
  })

  afterEach(() => {
    for (const scope of scopes.splice(0)) { scope.stop() }

    vi.unstubAllEnvs()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

export { empty, emptySummary, harness, id, setup, summary, viewing }
