import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import type { CatalogViewing } from '@tv/shared/catalog-viewings'

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal: AbortSignal;
}

const harness = vi.hoisted(() => {return { fetch: vi.fn<(url: string, options: RequestOptions) => Promise<unknown>>() }})

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Nuxt's virtual alias has no runtime module in this Node test.
vi.mock('#app', () => {return { useRequestFetch: () => harness.fetch }})

const { useMovieViewings } = await import('../use-movie-viewings.ts')
const id = '01991a00-0000-7000-8000-000000000001'

const viewing: CatalogViewing = {
  id: '01991a00-0000-7000-8000-000000000002',
  catalogItemId: id,
  status: 'completed',
  startedOn: null,
  completedOn: null,
  recordedAt: '2020-01-01T12:00:00.123456Z',
  revision: 1
}

const emptySummary = {
  completedCount: 0,
  currentViewingId: null,
  contextVersion: 0
}

const summary = {
  completedCount: 1,
  currentViewingId: viewing.id,
  contextVersion: 1
}

const empty = {
  items: [],
  summary: emptySummary,
  nextCursor: null
}

const scopes: ReturnType<typeof effectScope>[] = []

function setup(automaticLoad = false) {
  const scope = effectScope()
  const account = ref<string | null>('account-one')
  const item = ref<string | null>(id)
  const selected = ref<string | null>(null)

  const state = scope.run(() => useMovieViewings(item, account, {
    automaticLoad,
    selectedId: selected
  }))

  scopes.push(scope)

  if (state === undefined) { throw new Error('Missing viewing state') }

  return {
    account,
    item,
    selected,
    state,
    scope
  }
}

describe('movie viewing lifecycle', () => {
  beforeEach(() => {
    harness.fetch.mockReset()

    vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {
      // Expected failures are inspected through safe state.
    })
  })

  afterEach(() => {
    for (const scope of scopes.splice(0)) { scope.stop() }

    vi.restoreAllMocks()
  })

  it('waits for an account and title and aborts reads on disposal', async () => {
    const response = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValue(response.promise)

    const { account, item, state, scope } = setup()

    account.value = null

    await state.load()
    expect(harness.fetch).not.toHaveBeenCalled()

    account.value = 'account-one'
    item.value = null

    await state.load()
    expect(harness.fetch).not.toHaveBeenCalled()

    item.value = id

    const load = state.load()
    const signal = harness.fetch.mock.calls[0]?.[1].signal

    scope.stop()
    expect(signal?.aborted).toBe(true)
    response.resolve(empty)

    await load

    expect(state.items.value).toStrictEqual([])
  })

  it('creates only confirmed entries, retries the same key, and keeps a confirmed save after refresh fails', async () => {
    harness.fetch.mockResolvedValueOnce(empty)

    const { state } = setup()

    await state.load()

    const pending = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(pending.promise)

    const first = state.create('current')

    expect(state.summary.value.completedCount).toBe(0)
    expect(state.items.value).toStrictEqual([])
    expect(state.isSaving.value).toBe(true)
    pending.reject(new Error('Response lost'))
    await expect(first).resolves.toBe(false)

    const firstBody = harness.fetch.mock.calls[1]?.[1].body

    harness.fetch.mockResolvedValueOnce({
      viewing,
      summary
    }).mockRejectedValueOnce(new Error('Refresh failed'))

    await expect(state.create('current')).resolves.toBe(true)
    expect(harness.fetch.mock.calls[2]?.[1].body).toStrictEqual(firstBody)
    expect(state.summary.value).toStrictEqual(summary)
    expect(state.items.value).toStrictEqual([viewing])
    expect(state.saveError.value).toBe('')
    expect(state.readError.value).not.toBe('')
    expect(state.status.value).toBe('loaded')
  })

  it('keeps a lost creation key while another viewing is edited', async () => {
    const page = {
      items: [viewing],
      summary,
      nextCursor: null
    }

    harness.fetch.mockResolvedValueOnce(page)

    const { state } = setup()

    await state.load()
    harness.fetch.mockRejectedValueOnce(new Error('Response lost'))
    await expect(state.create('current')).resolves.toBe(false)

    const lostBody = harness.fetch.mock.calls[1]?.[1].body

    harness.fetch.mockResolvedValueOnce({
      viewing,
      summary
    }).mockResolvedValueOnce(page)

    await expect(state.update(viewing, {
      startedOn: null,
      completedOn: null
    })).resolves.toBe(true)

    harness.fetch.mockResolvedValueOnce({
      viewing,
      summary
    }).mockResolvedValueOnce(page)

    await expect(state.create('current')).resolves.toBe(true)
    expect(harness.fetch.mock.calls[4]?.[1].body).toStrictEqual(lostBody)
  })

  it('keeps a lost history key across a separate current creation', async () => {
    harness.fetch.mockResolvedValueOnce(empty)

    const { state } = setup()

    const dates = {
      startedOn: '2020-01-01',
      completedOn: null
    }

    await state.load()
    harness.fetch.mockRejectedValueOnce(new Error('History response lost'))
    await expect(state.create('history', dates)).resolves.toBe(false)

    const lostBody = harness.fetch.mock.calls[1]?.[1].body

    const page = {
      items: [viewing],
      summary,
      nextCursor: null
    }

    harness.fetch.mockResolvedValueOnce({
      viewing,
      summary
    }).mockResolvedValueOnce(page)

    await expect(state.create('current')).resolves.toBe(true)

    harness.fetch.mockResolvedValueOnce({
      viewing,
      summary
    }).mockResolvedValueOnce(page)

    await expect(state.create('history', dates)).resolves.toBe(true)
    expect(harness.fetch.mock.calls[4]?.[1].body).toStrictEqual(lostBody)
  })

  it('keeps the save busy until its confirmed refresh finishes', async () => {
    harness.fetch.mockResolvedValueOnce(empty)

    const { state } = setup()
    const refresh = Promise.withResolvers<unknown>()

    await state.load()

    harness.fetch.mockResolvedValueOnce({
      viewing,
      summary
    }).mockReturnValueOnce(refresh.promise)

    const saving = state.create('current')

    await vi.waitFor(() => { expect(harness.fetch).toHaveBeenCalledTimes(3) })
    expect(state.isSaving.value).toBe(true)
    await expect(state.create('history')).resolves.toBe(false)
    expect(harness.fetch).toHaveBeenCalledTimes(3)

    refresh.resolve({
      items: [viewing],
      summary,
      nextCursor: null
    })

    await expect(saving).resolves.toBe(true)
    expect(state.isSaving.value).toBe(false)
  })

  it('does not start a linked request after disposal during a confirmed refresh', async () => {
    harness.fetch.mockResolvedValueOnce(empty)

    const { state, scope, selected } = setup()
    const refresh = Promise.withResolvers<unknown>()

    await state.load()

    selected.value = viewing.id

    harness.fetch.mockResolvedValueOnce({
      viewing,
      summary
    }).mockReturnValueOnce(refresh.promise)

    const saving = state.create('current')

    await vi.waitFor(() => { expect(harness.fetch).toHaveBeenCalledTimes(3) })

    const signal = harness.fetch.mock.calls[2]?.[1].signal

    scope.stop()
    expect(signal?.aborted).toBe(true)

    refresh.resolve({
      items: [viewing],
      summary,
      nextCursor: null
    })

    await expect(saving).resolves.toBe(false)
    expect(harness.fetch).toHaveBeenCalledTimes(3)
    expect(state.items.value).toStrictEqual([])
  })

  it.each(['account', 'title'] as const)('clears personal data and ignores late reads on a %s change', async kind => {
    const old = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(old.promise)

    const { account, item, state } = setup()
    const load = state.load()
    const signal = harness.fetch.mock.calls[0]?.[1].signal

    // oxlint-disable-next-line vitest/no-conditional-in-test -- Each table case changes one identity source.
    if (kind === 'account') { account.value = 'account-two' } else { item.value = '01991a00-0000-7000-8000-000000000003' }

    expect(signal?.aborted).toBe(true)

    old.resolve({
      items: [viewing],
      summary,
      nextCursor: null
    })

    await load

    expect(state.items.value).toStrictEqual([])
    expect(state.summary.value).toStrictEqual(emptySummary)
  })

  it('ignores late mutations after an account change', async () => {
    harness.fetch.mockResolvedValueOnce(empty)

    const { account, state } = setup()

    await state.load()

    const old = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(old.promise)

    const save = state.create('current')

    account.value = 'account-two'

    old.resolve({
      viewing,
      summary
    })

    await expect(save).resolves.toBe(false)
    expect(state.summary.value).toStrictEqual(emptySummary)
    expect(state.items.value).toStrictEqual([])
    expect(state.isSaving.value).toBe(false)
    expect(harness.fetch).toHaveBeenCalledTimes(2)
  })

  it('preserves history after continuation failure and retries without duplicates', async () => {
    harness.fetch.mockResolvedValueOnce({
      items: [viewing],
      summary,
      nextCursor: 'next'
    })

    const { state } = setup()

    await state.load()
    harness.fetch.mockRejectedValueOnce(new Error('Offline'))
    await state.load(true)
    expect(state.items.value).toStrictEqual([viewing])
    expect(state.nextCursor.value).toBe('next')

    harness.fetch.mockResolvedValueOnce({
      items: [viewing],
      summary,
      nextCursor: null
    })

    await state.load(true)
    expect(state.items.value).toStrictEqual([viewing])
    expect(state.readError.value).toBe('')
  })

  it('loads a linked viewing outside the history without changing the context', async () => {
    const { state, selected } = setup()

    selected.value = viewing.id

    harness.fetch.mockResolvedValueOnce({ viewing })
    await state.loadPoint()
    expect(state.selectedViewing.value).toStrictEqual(viewing)
    expect(state.summary.value).toStrictEqual(emptySummary)
    expect(harness.fetch.mock.calls[0]?.[0]).toBe(`/api/catalog/items/${id}/viewings/${viewing.id}`)
  })

  it('handles session expiry and safe conflict errors with field details', async () => {
    harness.fetch.mockResolvedValueOnce(empty)

    const { state } = setup()

    await state.load()

    harness.fetch.mockRejectedValueOnce({
      statusCode: 409,

      data: { error: {
        fields: { completedOn: 'Fix this date.' },
        message: 'private detail'
      } }
    })

    await expect(state.create('current')).resolves.toBe(false)
    expect(state.saveError.value).toContain('Refresh')
    expect(state.saveError.value).not.toContain('private')
    expect(state.fields.value).toStrictEqual({ completedOn: 'Fix this date.' })
    harness.fetch.mockRejectedValueOnce({ statusCode: 401 })
    await state.create('history')
    expect(state.unauthorized.value).toBe('mutation')
  })
})
