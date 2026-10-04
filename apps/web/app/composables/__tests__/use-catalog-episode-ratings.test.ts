import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'

interface RequestOptions {
  method?: string;
  body?: unknown;
  retry: number;
  signal: AbortSignal;
}

const harness = vi.hoisted(() => { return { fetch: vi.fn<(url: string, options: RequestOptions) => Promise<unknown>>() } })

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Nuxt's virtual alias has no runtime module in this Node test.
vi.mock('#app', () => { return { useRequestFetch: () => harness.fetch } })

const { useCatalogEpisodeRatings } = await import('../use-catalog-episode-ratings.ts')
const firstId = '30000000-0000-7000-8000-000000000001'
const secondId = '30000000-0000-7000-8000-000000000002'

const season = {
  catalogItemId: '01991a00-0000-7000-8000-000000000006',
  seasonNumber: 1
} as const

const initial = { items: [{
  episodeId: firstId,
  score: 4
}, {
  episodeId: secondId,
  score: null
}] } as const

const scopes: ReturnType<typeof effectScope>[] = []

function setup() {
  const scope = effectScope()
  const account = ref<string | null>('first-account')
  const ratings = scope.run(() => useCatalogEpisodeRatings(season, [firstId, secondId], account))

  scopes.push(scope)

  if (ratings === undefined) {
    throw new Error('The episode ratings scope did not start')
  }

  return {
    scope,
    account,
    ratings
  }
}

describe('private episode ratings lifecycle', () => {
  beforeEach(() => {
    harness.fetch.mockReset()
    vi.stubEnv('SSR', true)
  })

  afterEach(() => {
    for (const scope of scopes.splice(0)) {
      scope.stop()
    }

    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('loads one batch, then writes and removes only the selected episode', async () => {
    const { ratings } = setup()

    expect(harness.fetch).not.toHaveBeenCalled()
    harness.fetch.mockResolvedValueOnce(initial).mockResolvedValueOnce({ score: 8 }).mockResolvedValueOnce({ score: null })
    await ratings.loadBatch()
    expect(ratings.ratingFor(firstId).score).toBe(4)

    expect(ratings.ratingFor(secondId)).toMatchObject({
      score: null,
      status: 'loaded'
    })

    await expect(ratings.save(firstId, 8)).resolves.toBe(true)
    expect(ratings.ratingFor(firstId).score).toBe(8)
    await expect(ratings.save(firstId, null)).resolves.toBe(true)
    expect(ratings.ratingFor(firstId).score).toBeNull()
    expect(harness.fetch).toHaveBeenCalledTimes(3)

    expect(harness.fetch).toHaveBeenNthCalledWith(2, `/api/catalog/episodes/${firstId}/rating`, expect.objectContaining({
      method: 'PUT',
      body: { score: 8 },
      retry: 0
    }))

    expect(harness.fetch).toHaveBeenNthCalledWith(3, `/api/catalog/episodes/${firstId}/rating`, expect.objectContaining({
      method: 'DELETE',
      body: undefined
    }))
  })

  it('allows another episode to save but blocks repeats and stale batches during a write', async () => {
    const pendingSave = Promise.withResolvers<unknown>()
    const pendingBatch = Promise.withResolvers<unknown>()
    const { ratings } = setup()

    harness.fetch.mockResolvedValueOnce(initial).mockReturnValueOnce(pendingSave.promise).mockReturnValueOnce(pendingBatch.promise).mockResolvedValueOnce({ score: 7 })
    await ratings.loadBatch()

    const saved = ratings.save(firstId, 9)
    const reloaded = ratings.loadBatch()

    expect(ratings.ratingFor(firstId)).toMatchObject({
      score: 4,
      isSaving: true
    })

    await expect(ratings.save(firstId, 2)).resolves.toBe(false)
    await ratings.load(firstId)
    await expect(ratings.save(secondId, 7)).resolves.toBe(true)
    pendingSave.resolve({ score: 9 })
    await expect(saved).resolves.toBe(true)
    pendingBatch.resolve(initial)

    await reloaded

    expect(ratings.ratingFor(firstId).score).toBe(9)
    expect(ratings.ratingFor(secondId).score).toBe(7)
    expect(harness.fetch).toHaveBeenCalledTimes(4)
  })

  it('keeps a point recovery newer than an unfinished initial batch', async () => {
    const pending = Promise.withResolvers<unknown>()
    const { ratings } = setup()

    harness.fetch.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ score: 8 })

    const batch = ratings.loadBatch()

    await ratings.load(firstId)
    pending.resolve(initial)

    await batch

    expect(ratings.ratingFor(firstId).score).toBe(8)
    expect(ratings.ratingFor(secondId).status).toBe('loaded')
  })

  it('aborts old-account requests and does not publish their late results', async () => {
    const pendingSave = Promise.withResolvers<unknown>()
    const { ratings, account } = setup()

    harness.fetch.mockResolvedValueOnce(initial).mockReturnValueOnce(pendingSave.promise)
    await ratings.loadBatch()

    const saved = ratings.save(firstId, 9)
    const signal = harness.fetch.mock.calls[1]?.[1].signal

    account.value = 'second-account'

    expect(signal?.aborted).toBe(true)

    expect(ratings.ratingFor(firstId)).toMatchObject({
      score: null,
      status: 'idle',
      isSaving: false
    })

    pendingSave.resolve({ score: 9 })
    await expect(saved).resolves.toBe(false)
    expect(ratings.ratingFor(firstId).score).toBeNull()

    account.value = null

    await ratings.loadBatch()
    expect(harness.fetch).toHaveBeenCalledTimes(2)
  })

  it('preserves confirmed scores on write failure and allows a local retry', async () => {
    const error = new Error('private database detail')
    const log = vi.spyOn(globalThis.console, 'warn').mockReturnValue()
    const { ratings } = setup()

    harness.fetch.mockResolvedValueOnce(initial).mockRejectedValueOnce(error).mockResolvedValueOnce({ score: 8 })
    await ratings.loadBatch()
    await expect(ratings.save(firstId, 8)).resolves.toBe(false)

    expect(ratings.ratingFor(firstId)).toMatchObject({
      score: 4,
      isSaving: false,
      saveError: 'We couldn’t save your rating. Try again.'
    })

    expect(ratings.ratingFor(secondId).saveError).toBe('')

    expect(log).toHaveBeenCalledWith({
      error,
      message: 'Catalog episode rating update request failed.'
    })

    await expect(ratings.save(firstId, 8)).resolves.toBe(true)
    expect(ratings.ratingFor(firstId).saveError).toBe('')
  })

  it.each([
    { items: [] },
    { items: [{
      episodeId: firstId,
      score: 5
    }, {
      episodeId: firstId,
      score: 5
    }] },
    { items: [{
      episodeId: firstId,
      score: 11
    }, {
      episodeId: secondId,
      score: null
    }] }
  ])('does not turn malformed or incomplete batches into unrated states: %j', async response => {
    vi.spyOn(globalThis.console, 'warn').mockReturnValue()

    const { ratings } = setup()

    harness.fetch.mockResolvedValueOnce(response).mockResolvedValueOnce({ score: 6 })
    await ratings.loadBatch()
    expect(ratings.batchError.value).toBe(true)
    expect(ratings.ratingFor(firstId).status).toBe('error')
    await ratings.load(firstId)

    expect(ratings.ratingFor(firstId)).toMatchObject({
      score: 6,
      status: 'loaded'
    })

    expect(ratings.ratingFor(secondId).status).toBe('error')
  })

  it('distinguishes unauthorized reads and mutations', async () => {
    const { ratings } = setup()

    harness.fetch.mockRejectedValueOnce({ statusCode: 401 }).mockResolvedValueOnce(initial).mockRejectedValueOnce({ statusCode: 401 })
    await ratings.loadBatch()
    expect(ratings.unauthorized.value).toBe('load')
    await ratings.loadBatch()
    await expect(ratings.save(firstId, 6)).resolves.toBe(false)
    expect(ratings.unauthorized.value).toBe('mutation')
    expect(ratings.ratingFor(firstId).score).toBe(4)
  })

  it('aborts all episode operations when leaving the season', async () => {
    const pending = Promise.withResolvers<unknown>()
    const { ratings, scope } = setup()

    harness.fetch.mockResolvedValueOnce(initial).mockReturnValue(pending.promise)
    await ratings.loadBatch()

    const first = ratings.save(firstId, 8)
    const second = ratings.save(secondId, 9)

    scope.stop()
    expect(harness.fetch.mock.calls[1]?.[1].signal.aborted).toBe(true)
    expect(harness.fetch.mock.calls[2]?.[1].signal.aborted).toBe(true)
    pending.resolve({ score: 8 })
    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(false)
  })
})
