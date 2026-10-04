import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, effectScope, ref } from 'vue'

interface RequestOptions {
  method?: string;
  body?: unknown;
  retry: number;
  signal: AbortSignal;
}

const harness = vi.hoisted(() => { return { fetch: vi.fn<(url: string, options: RequestOptions) => Promise<unknown>>() } })

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Nuxt's virtual alias has no runtime module in this Node test.
vi.mock('#app', () => { return { useRequestFetch: () => harness.fetch } })

const { useCatalogRating } = await import('../use-catalog-rating.ts')
const scopes: ReturnType<typeof effectScope>[] = []

function setup(accountId: string | null = 'account-one') {
  const scope = effectScope()
  const item = ref<string | null>('title-one')
  const account = ref<string | null>(accountId)
  const season = ref<number | null>(null)

  const target = computed(() => item.value === null ? null : {
    catalogItemId: item.value,
    seasonNumber: season.value
  })

  const rating = scope.run(() => useCatalogRating(target, account))

  scopes.push(scope)

  if (rating === undefined) { throw new Error('The rating scope did not start') }

  return {
    account,
    season,
    item,
    rating,
    scope
  }
}

describe('catalog rating lifecycle', () => {
  beforeEach(() => { harness.fetch.mockReset() })

  afterEach(() => {
    const completedScopes = scopes.splice(0)

    for (const scope of completedScopes) { scope.stop() }

    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('loads only for an account and sends confirmed score changes through PUT and DELETE', async () => {
    const { account, rating } = setup(null)

    await rating.load()
    expect(harness.fetch).not.toHaveBeenCalled()

    account.value = 'account-one'

    harness.fetch.mockResolvedValueOnce({ score: null }).mockResolvedValueOnce({ score: 8 }).mockResolvedValueOnce({ score: null })
    await rating.load()
    expect(rating.status.value).toBe('loaded')
    await expect(rating.save(8)).resolves.toBe(true)
    expect(rating.score.value).toBe(8)

    expect(harness.fetch).toHaveBeenNthCalledWith(2, '/api/catalog/items/title-one/rating', expect.objectContaining({
      method: 'PUT',
      body: { score: 8 },
      retry: 0
    }))

    await expect(rating.save(null)).resolves.toBe(true)
    expect(rating.score.value).toBeNull()

    expect(harness.fetch).toHaveBeenNthCalledWith(3, '/api/catalog/items/title-one/rating', expect.objectContaining({
      method: 'DELETE',
      body: undefined,
      retry: 0
    }))
  })

  it('keeps the confirmed score while saving and blocks overlapping saves and loads', async () => {
    const pending = Promise.withResolvers<unknown>()
    const { rating } = setup()

    harness.fetch.mockResolvedValueOnce({ score: 4 }).mockReturnValueOnce(pending.promise)
    await rating.load()

    const saved = rating.save(9)

    expect(rating.isSaving.value).toBe(true)
    expect(rating.score.value).toBe(4)
    await expect(rating.save(null)).resolves.toBe(false)
    await rating.load()
    expect(harness.fetch).toHaveBeenCalledTimes(2)
    pending.resolve({ score: 9 })
    await expect(saved).resolves.toBe(true)
    expect(rating.score.value).toBe(9)
    expect(rating.isSaving.value).toBe(false)
  })

  it('keeps the confirmed score on failure, logs the cause and allows retry', async () => {
    const error = new Error('private network detail')

    const log = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {
      // Capture the expected request failure.
    })

    const { rating } = setup()

    harness.fetch.mockResolvedValueOnce({ score: 6 }).mockRejectedValueOnce(error).mockResolvedValueOnce({ score: 8 })
    await rating.load()
    await expect(rating.save(8)).resolves.toBe(false)
    expect(rating.score.value).toBe(6)
    expect(rating.saveError.value).not.toContain('private network detail')
    expect(rating.saveError.value).toContain('Try again')

    expect(log).toHaveBeenCalledWith({
      error,
      message: 'Catalog rating update request failed.'
    })

    await expect(rating.save(8)).resolves.toBe(true)
    expect(rating.score.value).toBe(8)
    expect(rating.saveError.value).toBe('')
  })

  it('distinguishes a read failure from an unrated title and recovers', async () => {
    vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {
      // Capture the expected request failure.
    })

    const { rating } = setup()
    const error = new Error('unavailable')

    harness.fetch.mockRejectedValueOnce(error).mockResolvedValueOnce({ score: null })
    await rating.load()
    expect(rating.status.value).toBe('error')
    await expect(rating.save(7)).resolves.toBe(false)
    await rating.load()
    expect(rating.status.value).toBe('loaded')
    expect(rating.score.value).toBeNull()
  })

  it('rejects malformed and mismatched responses without false saved state', async () => {
    const log = vi.spyOn(globalThis.console, 'error').mockImplementation(() => {
      // Capture the expected request failure.
    })

    const { rating } = setup()

    harness.fetch.mockResolvedValueOnce({ score: 0 }).mockResolvedValueOnce({ score: 7 }).mockResolvedValueOnce({ score: 8 }).mockResolvedValueOnce({ score: 11 })
    await rating.load()
    expect(rating.status.value).toBe('error')
    await rating.load()
    await expect(rating.save(9)).resolves.toBe(false)
    expect(rating.score.value).toBe(7)
    await expect(rating.save(9)).resolves.toBe(false)
    expect(rating.score.value).toBe(7)
    expect(log).toHaveBeenCalledTimes(3)
  })

  it('reports an expired read session to the owner', async () => {
    const { account, rating } = setup()

    harness.fetch.mockRejectedValueOnce({ statusCode: 401 })
    await rating.load()
    expect(rating.unauthorized.value).toBe('load')

    account.value = null

    expect(rating.score.value).toBeNull()
    expect(rating.status.value).toBe('idle')
  })

  it('reports an expired write session without showing the draft as saved', async () => {
    const { account, rating } = setup()

    harness.fetch.mockResolvedValueOnce({ score: 7 }).mockRejectedValueOnce({ statusCode: 401 })
    await rating.load()
    await expect(rating.save(9)).resolves.toBe(false)
    expect(rating.unauthorized.value).toBe('mutation')
    expect(rating.score.value).toBe(7)

    account.value = null

    expect(rating.score.value).toBeNull()
  })

  it.each(['account', 'item'] as const)('ignores an old save after the %s changes, including its finally handler', async changed => {
    const oldSave = Promise.withResolvers<unknown>()
    const newSave = Promise.withResolvers<unknown>()
    const state = setup()

    harness.fetch.mockResolvedValueOnce({ score: 7 }).mockReturnValueOnce(oldSave.promise).mockResolvedValueOnce({ score: 3 }).mockReturnValueOnce(newSave.promise)
    await state.rating.load()

    const first = state.rating.save(9)
    const signal = harness.fetch.mock.calls[1]?.[1].signal

    state[changed].value = 'another'

    expect(signal?.aborted).toBe(true)
    await state.rating.load()

    const second = state.rating.save(5)

    oldSave.resolve({ score: 9 })
    await expect(first).resolves.toBe(false)
    expect(state.rating.score.value).toBe(3)
    expect(state.rating.isSaving.value).toBe(true)
    newSave.resolve({ score: 5 })
    await expect(second).resolves.toBe(true)
    expect(state.rating.score.value).toBe(5)
  })

  it.each(['account', 'item'] as const)('automatically reloads for a new %s and ignores the cancelled read', async changed => {
    const old = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ score: 4 })
    vi.stubEnv('SSR', false)

    const state = setup('account-one')
    const { rating } = state
    const signal = harness.fetch.mock.calls[0]?.[1].signal

    state[changed].value = 'another'

    await vi.waitFor(() => { expect(rating.score.value).toBe(4) })
    old.resolve({ score: 10 })

    await old.promise

    expect(signal?.aborted).toBe(true)
    expect(rating.score.value).toBe(4)
  })

  it.each(['load', 'save'] as const)('cancels a season %s and rejects its late response after selecting another season', async operation => {
    const pending = Promise.withResolvers<unknown>()
    const state = setup()

    state.season.value = 1

    harness.fetch.mockResolvedValueOnce({ score: 6 })
    await state.rating.load()
    harness.fetch.mockReturnValueOnce(pending.promise)

    const oldRequest = state.rating[operation](9)
    const signal = harness.fetch.mock.calls[1]?.[1].signal

    state.season.value = 2

    expect(state.rating.score.value).toBeNull()
    expect(signal?.aborted).toBe(true)
    harness.fetch.mockResolvedValueOnce({ score: 3 })
    await state.rating.load()
    pending.resolve({ score: 9 })

    await oldRequest

    expect(state.rating.score.value).toBe(3)
    expect(state.rating.isSaving.value).toBe(false)
    expect(state.rating.saveError.value).toBe('')
    expect(harness.fetch.mock.calls[0]?.[0]).toBe('/api/catalog/items/title-one/seasons/1/rating')
    expect(harness.fetch.mock.calls[2]?.[0]).toBe('/api/catalog/items/title-one/seasons/2/rating')
  })

  it('does not start automatic requests during SSR', () => {
    vi.stubEnv('SSR', true)

    const { account, item, rating } = setup()

    account.value = 'account-two'
    item.value = 'title-two'

    expect(harness.fetch).not.toHaveBeenCalled()
    expect(rating.status.value).toBe('idle')
  })

  it('ignores failures after disposal without reporting an error for another screen', async () => {
    const pending = Promise.withResolvers<unknown>()

    const log = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {
      // Capture the expected request failure.
    })

    const { rating, scope } = setup()

    harness.fetch.mockResolvedValueOnce({ score: 7 }).mockReturnValueOnce(pending.promise)
    await rating.load()

    const saving = rating.save(8)
    const signal = harness.fetch.mock.calls[1]?.[1].signal

    scope.stop()

    const error = new Error('obsolete failure')

    pending.reject(error)
    await expect(saving).resolves.toBe(false)
    expect(signal?.aborted).toBe(true)
    expect(log).not.toHaveBeenCalled()
    expect(rating.score.value).toBe(7)
  })
})
