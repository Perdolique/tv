import { describe, expect, it, vi } from 'vitest'
import { empty, emptySummary, harness, id, setup, summary, viewing } from '../../testing/movie-viewings-harness.ts'

describe('movie viewing lifecycle', () => {
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
