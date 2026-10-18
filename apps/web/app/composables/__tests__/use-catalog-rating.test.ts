import { describe, expect, it } from 'vitest'
import { computed, ref } from 'vue'
import { empty, emptySummary, harness, id, setup, summary, viewing } from '../../testing/catalog-viewings-harness.ts'

const requestIdPattern: unknown = expect.any(String)
const { useCatalogRating } = await import('../use-catalog-rating.ts')

const page = {
  items: [viewing],
  summary,
  nextCursor: null
}

function response(score: number | null) {
  return {
    score,

    viewing: {
      ...viewing,
      score
    },

    summary: {
      ...summary,
      currentViewingScore: score,
      currentVoteScore: score
    }
  }
}
function setupRating() {
  const current = setup()
  const season = ref<number | null>(null)

  const target = computed(() => {
    const selection = {
      catalogItemId: id,
      seasonNumber: season.value
    }

    return selection
  })

  const rating = current.scope.run(() => useCatalogRating(target, current.account, current.state))

  if (rating === undefined) { throw new Error('Rating scope did not start') }

  return {
    ...current,
    season,
    rating
  }
}

describe('viewing-aware catalog ratings', () => {
  it('confirms the first season rating when its response creates the current viewing', async () => {
    harness.fetch.mockResolvedValueOnce(empty).mockResolvedValueOnce({
      score: null,
      viewing: null,
      summary: emptySummary
    }).mockResolvedValueOnce(response(8)).mockResolvedValueOnce(page)

    const { state, rating, season } = setupRating()

    await state.load()

    season.value = 1

    await rating.load()
    await expect(rating.save(8, '2026-10-17')).resolves.toBe(true)
    expect(state.summary.value.currentViewingId).toBe(viewing.id)
    expect(rating.score.value).toBe(8)
    expect(rating.status.value).toBe('loaded')
  })

  it('reads the selected viewing and writes its revision without changing the current context', async () => {
    const past = {
      ...viewing,
      id: '01991a00-0000-7000-8000-000000000099',
      revision: 4
    }

    harness.fetch.mockResolvedValueOnce(page)

    const { state, rating, season } = setupRating()

    await state.load()
    state.select(past)

    season.value = 2

    harness.fetch.mockResolvedValueOnce({
      score: 5,
      viewing: past,
      summary
    }).mockResolvedValueOnce({
      score: 8,

      viewing: {
        ...past,
        revision: 5
      },

      summary
    })

    await rating.load()
    await expect(rating.save(8)).resolves.toBe(true)
    expect(harness.fetch.mock.calls[1]?.[1]).toMatchObject({ query: { viewingId: past.id } })
    expect(harness.fetch.mock.calls[2]?.[0]).toBe(`/api/catalog/items/${id}/viewings/${past.id}/seasons/2/rating`)

    expect(harness.fetch.mock.calls[2]?.[1].body).toMatchObject({
      requestId: requestIdPattern,
      revision: 4,
      score: 8,
      timeZone: 'Europe/Tallinn'
    })

    expect(rating.score.value).toBe(8)
    expect(state.summary.value.currentViewingId).toBe(viewing.id)
  })

  it('preserves the confirmed score while saving and serializes nested writes', async () => {
    const pending = Promise.withResolvers<unknown>()

    harness.fetch.mockResolvedValueOnce(page).mockResolvedValueOnce(response(4)).mockReturnValueOnce(pending.promise)

    const { state, rating } = setupRating()

    await state.load()
    await rating.load()

    const saved = rating.save(9)

    expect(rating.score.value).toBe(4)
    expect(rating.isSaving.value).toBe(true)
    await expect(state.remove(viewing)).resolves.toBe(false)
    await expect(rating.save(null)).resolves.toBe(false)
    pending.resolve(response(9))
    await expect(saved).resolves.toBe(true)
    expect(rating.score.value).toBe(9)
  })

  it('keeps failures safe and retries the original rating request', async () => {
    const error = new Error('private transport detail')

    harness.fetch.mockResolvedValueOnce(page).mockResolvedValueOnce(response(6)).mockRejectedValueOnce(error)

    const { state, rating } = setupRating()

    await state.load()
    await rating.load()
    await expect(rating.save(8)).resolves.toBe(false)

    const original = harness.fetch.mock.calls[2]?.[1].body

    expect(rating.score.value).toBe(6)
    expect(rating.hasUnconfirmedMutation.value).toBe(true)
    expect(rating.isBlocked.value).toBe(false)
    expect(rating.saveError.value).not.toContain('private transport detail')

    expect(globalThis.console.warn).toHaveBeenCalledWith({
      error,
      message: 'Viewing update request failed.'
    })

    harness.fetch.mockResolvedValueOnce(response(8))
    await expect(rating.save(8)).resolves.toBe(true)
    expect(harness.fetch.mock.calls[3]?.[1].body).toStrictEqual(original)
    expect(rating.score.value).toBe(8)
  })

  it('distinguishes failed and unauthorized reads from an unrated viewing', async () => {
    harness.fetch.mockResolvedValueOnce(empty).mockRejectedValueOnce(new Error('Unavailable')).mockRejectedValueOnce({ statusCode: 401 })

    const { state, rating } = setupRating()

    await state.load()
    await rating.load()
    expect(rating.status.value).toBe('error')
    await expect(rating.save(7, '2026-10-17')).resolves.toBe(false)
    await rating.load()
    expect(rating.unauthorized.value).toBe('load')
    expect(rating.score.value).toBeNull()
  })

  it('aborts a selected-viewing read and ignores its late result after selection changes', async () => {
    const old = Promise.withResolvers<unknown>()

    harness.fetch.mockResolvedValueOnce(page).mockReturnValueOnce(old.promise)

    const { state, rating } = setupRating()

    await state.load()

    const loading = rating.load()
    const signal = harness.fetch.mock.calls[1]?.[1].signal

    const past = {
      ...viewing,
      id: '01991a00-0000-7000-8000-000000000099'
    }

    state.select(past)
    old.resolve(response(9))

    await loading

    expect(signal?.aborted).toBe(true)
    expect(rating.score.value).toBeNull()
    expect(rating.status.value).toBe('idle')
  })

  it('keeps a write for an old account out of the new account state', async () => {
    const old = Promise.withResolvers<unknown>()

    harness.fetch.mockResolvedValueOnce(page).mockResolvedValueOnce(response(7)).mockReturnValueOnce(old.promise)

    const { state, account, rating } = setupRating()

    await state.load()
    await rating.load()

    const saved = rating.save(9)

    account.value = 'another-account'

    old.resolve(response(9))
    await expect(saved).resolves.toBe(false)
    expect(rating.score.value).toBeNull()
    expect(rating.saveError.value).toBe('')
    expect(state.items.value).toStrictEqual([])
  })

  it('rejects malformed rating context without reporting a saved score', async () => {
    harness.fetch.mockResolvedValueOnce(page).mockResolvedValueOnce({ score: 0 })

    const { state, rating } = setupRating()

    await state.load()
    await rating.load()
    expect(rating.status.value).toBe('error')
    expect(rating.score.value).toBeNull()
  })
})
