import { describe, expect, it } from 'vitest'
import { empty, harness, id, setup, summary, viewing } from '../../testing/movie-viewings-harness.ts'

const page = {
  items: [viewing],
  summary,
  nextCursor: null
}

const ratedViewing = {
  ...viewing,
  score: 6,
  revision: 2
}

const ratedSummary = {
  ...summary,
  contextVersion: 2,
  currentViewingScore: 6,
  currentVoteScore: 6
}

describe('movie viewing rating requests', () => {
  it('keeps a confirmed score when a point read started during the write returns an older revision', async () => {
    harness.fetch.mockResolvedValueOnce(page)

    const { state, selected } = setup()

    await state.load()

    selected.value = viewing.id

    const write = Promise.withResolvers<unknown>()
    const point = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(write.promise).mockReturnValueOnce(point.promise)

    const saving = state.saveCurrentScore(6)
    const reading = state.loadPoint()

    write.resolve({
      score: 6,
      viewing: ratedViewing,
      summary: ratedSummary
    })

    await expect(saving).resolves.toBe(true)
    point.resolve({ viewing })
    await expect(reading).resolves.toStrictEqual(ratedViewing)
    expect(state.selectedViewing.value).toStrictEqual(ratedViewing)
    expect(state.items.value).toStrictEqual([ratedViewing])
  })

  it('cancels old history and point reads before applying a confirmed current rating', async () => {
    harness.fetch.mockResolvedValueOnce(page)

    const { state, selected } = setup()

    await state.load()

    selected.value = viewing.id

    const history = Promise.withResolvers<unknown>()
    const point = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(history.promise).mockReturnValueOnce(point.promise)

    const loading = state.load()
    const loadingPoint = state.loadPoint()
    const historySignal = harness.fetch.mock.calls[1]?.[1].signal
    const pointSignal = harness.fetch.mock.calls[2]?.[1].signal

    harness.fetch.mockResolvedValueOnce({
      score: 6,
      viewing: ratedViewing,
      summary: ratedSummary
    })

    await expect(state.saveCurrentScore(6)).resolves.toBe(true)
    expect(historySignal?.aborted).toBe(true)
    expect(pointSignal?.aborted).toBe(true)

    expect(harness.fetch.mock.calls[3]).toMatchObject([`/api/catalog/items/${id}/rating`, {
      method: 'PUT',

      body: {
        score: 6,
        currentViewingId: viewing.id,
        contextVersion: 1
      }
    }])

    history.resolve(page)
    point.resolve({ viewing })
    await Promise.all([loading, loadingPoint])
    expect(state.items.value).toStrictEqual([ratedViewing])
    expect(state.selectedViewing.value).toStrictEqual(ratedViewing)
    expect(state.summary.value).toStrictEqual(ratedSummary)
  })

  it('clears a retained vote with an explicit no-viewing context and ignores a late account result', async () => {
    harness.fetch.mockResolvedValueOnce(empty)

    const { state, account } = setup()

    await state.load()

    const response = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(response.promise)

    const saving = state.saveCurrentScore(null)

    await expect(state.saveCurrentScore(8)).resolves.toBe(false)

    expect(harness.fetch.mock.calls[1]).toMatchObject([`/api/catalog/items/${id}/rating`, {
      method: 'DELETE',

      body: {
        currentViewingId: null,
        contextVersion: 0
      }
    }])

    account.value = 'another-account'

    response.resolve({
      score: 6,
      viewing: ratedViewing,
      summary: ratedSummary
    })

    await expect(saving).resolves.toBe(false)
    expect(state.summary.value).toStrictEqual(empty.summary)
  })

  it('does not apply the summary from a response for another historical viewing', async () => {
    harness.fetch.mockResolvedValueOnce(page)

    const { state } = setup()

    await state.load()

    const past = {
      ...viewing,
      id: '01991a00-0000-7000-8000-000000000099'
    }

    harness.fetch.mockResolvedValueOnce({
      viewing: ratedViewing,
      summary: ratedSummary
    })

    await expect(state.saveViewingScore(past, 6)).resolves.toBe(false)
    expect(state.summary.value).toStrictEqual(summary)
    expect(state.items.value).toStrictEqual([viewing])
    expect(state.saveError.value).not.toBe('')
  })

  it('keeps a scored creation immutable until the same uncertain operation is confirmed', async () => {
    harness.fetch.mockResolvedValueOnce(empty)

    const { state } = setup()

    await state.load()
    harness.fetch.mockRejectedValueOnce(new Error('Response lost after commit'))
    await expect(state.create('current', undefined, 6)).resolves.toBe(false)

    const original = harness.fetch.mock.calls[1]?.[1].body

    await expect(state.create('current', undefined, 8)).resolves.toBe(false)
    expect(harness.fetch).toHaveBeenCalledTimes(2)

    harness.fetch.mockResolvedValueOnce({
      viewing: ratedViewing,
      summary: ratedSummary
    }).mockResolvedValueOnce({
      items: [ratedViewing],
      summary: ratedSummary,
      nextCursor: null
    })

    await expect(state.retryCreation()).resolves.toBe(true)
    expect(harness.fetch.mock.calls[2]?.[1].body).toStrictEqual(original)
    expect(state.unconfirmedCreation.value).toBeNull()
    expect(state.items.value).toStrictEqual([ratedViewing])
  })
})
