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

function initialUnauthorizedResponse(target: string): void {
  if (target === 'history') {
    harness.fetch.mockRejectedValueOnce({ statusCode: 401 }).mockResolvedValueOnce(summary)
  } else {
    harness.fetch.mockResolvedValueOnce({
      items: [movie],
      nextCursor: 'first-page'
    }).mockRejectedValueOnce({ statusCode: 401 })
  }
}

describe('viewing requests', () => {
  it('loads independent private data and does not request it for guests', async () => {
    initialResponses()

    const guest = setup(null)

    await Promise.all([guest.history.ready, guest.summary.ready])
    expect(harness.fetch).not.toHaveBeenCalled()

    const viewer = setup()

    await Promise.all([viewer.history.ready, viewer.summary.ready])
    expect(harness.fetch).toHaveBeenCalledTimes(2)
    expect(viewer.summary.summary.value).toStrictEqual(summary)
    expect(viewer.history.items.value).toStrictEqual([movie])
  })

  it('deduplicates requests and overlapping pages, then reaches the end', async () => {
    initialResponses()

    const { history } = setup()

    await history.ready

    const pending = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(pending.promise)

    const first = history.loadMore()
    const repeated = history.loadMore()

    expect(history.items.value).toStrictEqual([movie])
    expect(harness.fetch).toHaveBeenCalledTimes(3)

    pending.resolve({
      items: [movie, olderMovie],
      nextCursor: null
    })

    await expect(first).resolves.toStrictEqual([olderMovie])
    await expect(repeated).resolves.toStrictEqual([olderMovie])
    expect(history.items.value).toStrictEqual([movie, olderMovie])
    expect(history.hasMore.value).toBe(false)
    await expect(history.loadMore()).resolves.toStrictEqual([])
    expect(harness.fetch).toHaveBeenCalledTimes(3)
  })

  it('keeps loaded history on failure and retries the same cursor', async () => {
    initialResponses()

    const { history } = setup()

    await history.ready

    vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {
      // Expected request failure.
    })

    harness.fetch.mockRejectedValueOnce({ statusCode: 503 })
    await history.loadMore()
    expect(history.hasLoadMoreError.value).toBe(true)
    expect(history.items.value).toStrictEqual([movie])
    expect(history.hasMore.value).toBe(true)

    harness.fetch.mockResolvedValueOnce({
      items: [olderMovie],
      nextCursor: null
    })

    await history.loadMore()
    expect(history.hasLoadMoreError.value).toBe(false)
    expect(history.items.value).toStrictEqual([movie, olderMovie])
    expect(harness.fetch.mock.calls[2]?.[1].query).toStrictEqual({ cursor: 'first-page' })
    expect(harness.fetch.mock.calls[3]?.[1].query).toStrictEqual({ cursor: 'first-page' })
  })

  it.each(['response', 'unauthorized'])('rejects a stale continuation %s after changing accounts', async (failure) => {
    initialResponses()

    const { accountId, history, summary: summaryState } = setup()

    await Promise.all([history.ready, summaryState.ready])

    const pending = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(pending.promise)

    const request = history.loadMore()
    const signal = harness.fetch.mock.calls[2]?.[1].signal

    harness.fetch
      .mockResolvedValueOnce({
        items: [],
        nextCursor: null
      })
      .mockResolvedValueOnce({
        watchedMovieCount: 0,
        watchedEpisodeCount: 0,
        series: []
      })

    accountId.value = 'second'

    expect(signal?.aborted).toBe(true)
    expect(history.items.value).toStrictEqual([])
    expect(summaryState.summary.value).toBeNull()
    settleStaleRequest(pending, failure)

    await request

    await vi.waitFor(() => { expect(summaryState.summary.value?.watchedMovieCount).toBe(0) })
    expect(history.items.value).toStrictEqual([])
    expect(history.unauthorized.value).toBe(false)
    expect(summaryState.unauthorized.value).toBe(false)
  })

  it('clears private rows after a current continuation 401', async () => {
    initialResponses()

    const { history } = setup()

    await history.ready

    harness.fetch.mockRejectedValueOnce({ statusCode: 401 })
    await history.loadMore()
    expect(history.unauthorized.value).toBe(true)
    expect(history.items.value).toStrictEqual([])
    expect(history.hasMore.value).toBe(false)
  })

  it('rejects initial responses and an initial 401 after an account switch', async () => {
    const pendingHistory = Promise.withResolvers<unknown>()
    const pendingSummary = Promise.withResolvers<unknown>()

    harness.fetch
      .mockReturnValueOnce(pendingHistory.promise)
      .mockReturnValueOnce(pendingSummary.promise)

    const { accountId, history, summary: summaryState } = setup()
    const signals = harness.fetch.mock.calls.map(call => call[1].signal)

    harness.fetch
      .mockResolvedValueOnce({
        items: [olderMovie],
        nextCursor: null
      })
      .mockResolvedValueOnce({
        watchedMovieCount: 1,
        watchedEpisodeCount: 0,
        series: []
      })

    accountId.value = 'second'

    expect(signals.every(signal => signal.aborted)).toBe(true)
    expect(history.items.value).toStrictEqual([])
    expect(summaryState.summary.value).toBeNull()

    pendingHistory.resolve({
      items: [movie],
      nextCursor: null
    })

    pendingSummary.reject({ statusCode: 401 })
    await Promise.all([history.ready, summaryState.ready])
    await vi.waitFor(() => { expect(summaryState.summary.value?.watchedMovieCount).toBe(1) })
    expect(history.items.value).toStrictEqual([olderMovie])
    expect(history.unauthorized.value).toBe(false)
    expect(summaryState.unauthorized.value).toBe(false)
  })

  it.each(['history', 'summary'] as const)('marks a current initial %s 401 as unauthorized', async (target) => {
    initialUnauthorizedResponse(target)

    const { accountId, history, summary: summaryState } = setup()

    await Promise.all([history.ready, summaryState.ready])

    const outcomes = {
      history,
      summary: summaryState
    }

    const failed = outcomes[target]

    expect(failed.unauthorized.value).toBe(true)
    expect(failed.hasError.value).toBe(false)

    accountId.value = null

    expect(history.items.value).toStrictEqual([])
    expect(history.hasMore.value).toBe(false)
    expect(summaryState.summary.value).toBeNull()
  })

  it('rejects malformed continuations without advancing the cursor', async () => {
    initialResponses()

    const { history } = setup()

    await history.ready

    vi.spyOn(globalThis.console, 'error').mockImplementation(() => {
      // Invalid data is reported and remains retryable.
    })

    harness.fetch.mockResolvedValueOnce({
      items: [],
      nextCursor: 'first-page'
    })

    await history.loadMore()
    expect(history.hasLoadMoreError.value).toBe(true)
    expect(history.items.value).toStrictEqual([movie])

    harness.fetch.mockResolvedValueOnce({
      items: [olderMovie],
      nextCursor: null
    })

    await history.loadMore()
    expect(history.items.value).toStrictEqual([movie, olderMovie])
    expect(history.hasMore.value).toBe(false)
  })

  it('cancels initial requests on disposal and ignores their late results', async () => {
    const pending = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValue(pending.promise)

    const { history, scope, summary: summaryState } = setup()
    const signals = harness.fetch.mock.calls.map(call => call[1].signal)

    scope.stop()
    expect(signals.every(signal => signal.aborted)).toBe(true)

    pending.resolve({
      items: [movie],
      nextCursor: null
    })

    await Promise.all([history.ready, summaryState.ready])
    expect(history.items.value).toStrictEqual([])
    expect(summaryState.summary.value).toBeNull()
  })

  it('recovers initial errors and treats malformed data as a retryable failure', async () => {
    vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {
      // Expected request failure.
    })

    vi.spyOn(globalThis.console, 'error').mockImplementation(() => {
      // Expected request failure.
    })

    harness.fetch.mockRejectedValue({ statusCode: 503 })

    const { history, summary: summaryState } = setup()

    await Promise.all([history.ready, summaryState.ready])
    expect(history.hasError.value).toBe(true)
    expect(summaryState.hasError.value).toBe(true)
    harness.fetch.mockResolvedValue({ invalid: true })
    await Promise.all([history.reload(), summaryState.reload()])
    expect(history.hasError.value).toBe(true)
    expect(summaryState.hasError.value).toBe(true)
    initialResponses()
    await Promise.all([history.reload(), summaryState.reload()])
    expect(history.items.value).toStrictEqual([movie])
    expect(summaryState.summary.value).toStrictEqual(summary)
  })
})
