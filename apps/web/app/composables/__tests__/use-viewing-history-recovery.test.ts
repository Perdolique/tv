import { describe, expect, it, vi } from 'vitest'
import { movie, olderMovie, summary } from '../../testing/viewing-fixtures.ts'
import { harness, initialResponses, setup } from '../../testing/viewing-harness.ts'

function settleStaleRequest(pending: ReturnType<typeof Promise.withResolvers<unknown>>, failure: string): void {
  if (failure === 'response') {
    pending.resolve({
      items: [olderMovie],
      nextCursor: null
    })
  } else {
    pending.reject({ statusCode: 401 })
  }
}

describe('viewing history refresh and filters', () => {
  it('requires an explicit refresh for a rejected cursor and preserves the loaded page', async () => {
    initialResponses()

    const { history } = setup()

    await history.ready

    harness.fetch.mockRejectedValueOnce({
      statusCode: 400,

      data: { error: {
        code: 'INVALID_REQUEST',
        fields: { cursor: 'Refresh history.' }
      } }
    })

    await expect(history.loadMore()).resolves.toStrictEqual([])
    expect(history.items.value).toStrictEqual([movie])
    expect(history.hasMore.value).toBe(false)
    expect(history.needsRefresh.value).toBe(true)
    expect(harness.fetch).toHaveBeenCalledTimes(3)

    harness.fetch.mockResolvedValueOnce({
      items: [olderMovie],
      nextCursor: null
    })

    await expect(history.reload()).resolves.toBe(true)
    expect(history.items.value).toStrictEqual([olderMovie])
    expect(history.needsRefresh.value).toBe(false)
    expect(harness.fetch.mock.calls[3]?.[1].query).toBeUndefined()
  })

  it('retains every loaded page and summary during failed refreshes, then replaces both on success', async () => {
    initialResponses()

    const { history, summary: summaryState } = setup()

    await Promise.all([history.ready, summaryState.ready])

    harness.fetch.mockResolvedValueOnce({
      items: [olderMovie],
      nextCursor: 'second-page'
    })

    await history.loadMore()

    const pendingHistory = Promise.withResolvers<unknown>()
    const pendingSummary = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(pendingHistory.promise).mockReturnValueOnce(pendingSummary.promise)

    const refresh = Promise.all([history.reload(), summaryState.reload()])

    expect(history.items.value).toStrictEqual([movie, olderMovie])
    expect(summaryState.summary.value).toStrictEqual(summary)
    expect(history.isRefreshing.value).toBe(true)
    expect(summaryState.isRefreshing.value).toBe(true)

    vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {
      // The refresh failure is expected and asserted below.
    })

    pendingHistory.reject({ statusCode: 503 })
    pendingSummary.reject({ statusCode: 503 })
    await expect(refresh).resolves.toStrictEqual([false, false])
    expect(history.items.value).toStrictEqual([movie, olderMovie])
    expect(summaryState.summary.value).toStrictEqual(summary)
    expect(history.hasError.value).toBe(false)
    expect(summaryState.hasError.value).toBe(false)
    initialResponses()

    const retry = Promise.all([history.reload(), summaryState.reload()])

    await expect(retry).resolves.toStrictEqual([true, true])
    expect(history.items.value).toStrictEqual([movie])
  })

  it.each(['response', 'unauthorized'])('cancels stale continuation %s on a filter change without reloading the summary', async failure => {
    initialResponses()

    const { history, status, summary: summaryState } = setup()

    await Promise.all([history.ready, summaryState.ready])

    const pending = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(pending.promise)

    const request = history.loadMore()
    const signal = harness.fetch.mock.calls[2]?.[1].signal

    harness.fetch.mockResolvedValueOnce({
      items: [],
      nextCursor: null
    })

    status.value = 'watching'

    expect(signal?.aborted).toBe(true)
    expect(history.items.value).toStrictEqual([])
    expect(summaryState.summary.value).toStrictEqual(summary)
    settleStaleRequest(pending, failure)

    await request

    await vi.waitFor(() => { expect(history.isLoading.value).toBe(false) })
    expect(history.items.value).toStrictEqual([])
    expect(history.unauthorized.value).toBe(false)
    expect(harness.fetch.mock.calls[3]?.[1].query).toStrictEqual({ status: 'watching' })
    expect(harness.fetch).toHaveBeenCalledTimes(4)
  })

  it.each([['history', []], ['summary', null]] as const)('clears confirmed %s data after a refresh 401', async (target, expected) => {
    initialResponses()

    const { history, summary: summaryState } = setup()

    await Promise.all([history.ready, summaryState.ready])
    harness.fetch.mockRejectedValueOnce({ statusCode: 401 })

    const requests = {
      history,
      summary: summaryState
    }

    await expect(requests[target].reload()).resolves.toBe(false)
    expect(requests[target].unauthorized.value).toBe(true)

    const retained = {
      history: history.items.value,
      summary: summaryState.summary.value
    }

    expect(retained[target]).toStrictEqual(expected)
  })

  it('cancels a continuation before refresh and ignores its late unauthorized result', async () => {
    initialResponses()

    const { history } = setup()

    await history.ready

    const pending = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(pending.promise)

    const more = history.loadMore()
    const signal = harness.fetch.mock.calls[2]?.[1].signal

    harness.fetch.mockResolvedValueOnce({
      items: [olderMovie],
      nextCursor: null
    })

    await expect(history.reload()).resolves.toBe(true)
    expect(signal?.aborted).toBe(true)
    pending.reject({ statusCode: 401 })

    await more

    expect(history.items.value).toStrictEqual([olderMovie])
    expect(history.unauthorized.value).toBe(false)
  })

  it('cancels an initial request when the filter changes and ignores its late 401', async () => {
    const pending = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(summary)

    const { history, status } = setup()
    const signal = harness.fetch.mock.calls[0]?.[1].signal

    harness.fetch.mockResolvedValueOnce({
      items: [],
      nextCursor: null
    })

    status.value = 'watching'

    expect(signal?.aborted).toBe(true)
    pending.reject({ statusCode: 401 })

    await history.ready

    await vi.waitFor(() => { expect(history.isLoading.value).toBe(false) })
    expect(history.unauthorized.value).toBe(false)
    expect(history.items.value).toStrictEqual([])
  })

})
