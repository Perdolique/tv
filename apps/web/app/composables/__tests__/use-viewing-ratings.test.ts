import { describe, expect, it, vi } from 'vitest'
import { empty, harness, id, setup, summary, viewing } from '../../testing/catalog-viewings-harness.ts'

const requestIdPattern: unknown = expect.any(String)

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

describe('viewing rating context and replay', () => {
  it('refreshes server-ordered pages when a backdated first rating creates the current viewing', async () => {
    const historical = {
      ...viewing,
      id: '01991a00-0000-7000-8000-000000000099'
    }

    const before = {
      ...empty.summary,
      completedCount: 1
    }

    const backdated = {
      ...ratedViewing,
      completedOn: '2026-10-01'
    }

    const after = {
      ...ratedSummary,
      completedCount: 2
    }

    harness.fetch.mockResolvedValueOnce({
      items: [historical],
      summary: before,
      nextCursor: null
    }).mockResolvedValueOnce({
      score: 6,
      viewing: backdated,
      summary: after
    }).mockResolvedValueOnce({
      items: [historical],
      summary: after,
      nextCursor: 'backdated-viewing'
    }).mockResolvedValueOnce({
      items: [backdated],
      summary: after,
      nextCursor: null
    })

    const { state } = setup()

    await state.load()
    await expect(state.saveCurrentScore(6, '2026-10-01')).resolves.toBe(true)
    expect(state.items.value).toStrictEqual([historical])
    expect(state.currentViewing.value).toStrictEqual(backdated)
    expect(state.nextCursor.value).toBe('backdated-viewing')
    await expect(state.load(true)).resolves.toBe(true)
    expect(state.items.value).toStrictEqual([historical, backdated])
  })

  it('cancels obsolete history and point reads before applying a confirmed rating', async () => {
    harness.fetch.mockResolvedValueOnce(page)

    const { state } = setup()

    await state.load()

    const history = Promise.withResolvers<unknown>()
    const point = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(history.promise).mockReturnValueOnce(point.promise)

    const loading = state.load()
    const loadingPoint = state.loadPoint(viewing.id)
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
    history.resolve(page)
    point.resolve({ viewing })
    await Promise.all([loading, loadingPoint])
    expect(state.items.value).toStrictEqual([ratedViewing])
    expect(state.summary.value).toStrictEqual(ratedSummary)
  })

  it.each([9, null])('accepts live score %s when an exact retry follows a later correction', async liveScore => {
    harness.fetch.mockResolvedValueOnce(page).mockRejectedValueOnce(new Error('Answer lost'))

    const { state } = setup()

    await state.load()
    await expect(state.saveCurrentScore(8)).resolves.toBe(false)

    const original = globalThis.structuredClone(harness.fetch.mock.calls[1]?.[1].body)

    const liveViewing = {
      ...viewing,
      score: liveScore,
      revision: 3
    }

    const liveSummary = {
      ...summary,
      contextVersion: 3,
      currentViewingScore: liveScore,
      currentVoteScore: liveScore
    }

    harness.fetch.mockResolvedValueOnce({
      score: liveScore,
      viewing: liveViewing,
      summary: liveSummary
    }).mockResolvedValueOnce({
      items: [liveViewing],
      summary: liveSummary,
      nextCursor: null
    })

    await expect(state.retryMutation()).resolves.toBe(true)
    expect(harness.fetch.mock.calls[2]?.[1].body).toStrictEqual(original)
    expect(state.pendingMutation.value).toBeNull()
    expect(state.summary.value.currentViewingScore).toBe(liveScore)
    expect(state.items.value[0]?.score).toBe(liveScore)
  })

  it('keeps first-rating context, date and request immutable through an unsafe refresh and midnight', async () => {
    harness.fetch.mockResolvedValueOnce(empty).mockRejectedValueOnce(new Error('Lost response after commit'))

    const { state } = setup()

    await state.load()
    await expect(state.saveCurrentScore(6, '2026-10-17')).resolves.toBe(false)

    const original = globalThis.structuredClone(harness.fetch.mock.calls[1]?.[1].body)

    state.applyConfirmed({
      score: 6,
      viewing: ratedViewing,
      summary: ratedSummary
    })

    expect(state.summary.value).toStrictEqual(empty.summary)
    expect(state.items.value).toStrictEqual([])
    await expect(state.load()).resolves.toBe(false)
    expect(harness.fetch).toHaveBeenCalledTimes(2)
    vi.setSystemTime(new Date(2026, 9, 18, 12))

    harness.fetch.mockResolvedValueOnce({
      score: 6,
      viewing: ratedViewing,
      summary: ratedSummary
    }).mockResolvedValueOnce({
      items: [ratedViewing],
      summary: ratedSummary,
      nextCursor: null
    })

    await expect(state.retryMutation()).resolves.toBe(true)
    expect(harness.fetch.mock.calls[2]?.[1].body).toStrictEqual(original)

    expect(original).toMatchObject({
      score: 6,
      viewingDate: '2026-10-17',
      requestId: requestIdPattern,
      currentViewingId: null,
      contextVersion: 0,
      timeZone: 'Europe/Tallinn'
    })

    expect(harness.fetch.mock.calls[2]?.[0]).toBe(`/api/catalog/items/${id}/rating`)
  })

  it('rejects another historical viewing before changing its summary', async () => {
    harness.fetch.mockResolvedValueOnce(page)

    const { state } = setup()

    await state.load()

    const past = {
      ...viewing,
      id: '01991a00-0000-7000-8000-000000000099'
    }

    harness.fetch.mockResolvedValueOnce({
      score: 6,
      viewing: ratedViewing,
      summary: ratedSummary
    })

    await expect(state.saveViewingScore(past, 6)).resolves.toBe(false)
    expect(state.summary.value).toStrictEqual(summary)
    expect(state.items.value).toStrictEqual([viewing])
  })

  it('preserves newer confirmed context and scores when an older history response arrives', async () => {
    harness.fetch.mockResolvedValueOnce(page)

    const { state } = setup()

    await state.load()

    const oldPage = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(oldPage.promise)

    const reading = state.load()

    state.applyConfirmed({
      score: 6,
      viewing: ratedViewing,
      summary: ratedSummary
    })

    oldPage.resolve(page)
    await expect(reading).resolves.toBe(true)
    expect(state.summary.value).toStrictEqual(ratedSummary)
    expect(state.items.value).toStrictEqual([ratedViewing])
  })
})
