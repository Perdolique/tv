import { describe, expect, it, vi } from 'vitest'
import { empty, harness, setup, summary, viewing } from '../../testing/catalog-viewings-harness.ts'

const requestIdPattern: unknown = expect.any(String)

const page = {
  items: [viewing],
  summary,
  nextCursor: null
}

describe('catalog viewing history and writes', () => {
  it('waits for identity and cancels a read on disposal', async () => {
    const response = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(response.promise)

    const { state, scope } = setup()
    const loading = state.load()
    const signal = harness.fetch.mock.calls[0]?.[1].signal

    scope.stop()
    response.resolve(page)
    await expect(loading).resolves.toBe(false)
    expect(signal?.aborted).toBe(true)
    expect(state.items.value).toStrictEqual([])
  })

  it('keeps confirmed history during a page failure and retries without duplicates', async () => {
    const first = {
      ...page,
      nextCursor: 'older'
    }

    const older = {
      ...viewing,
      id: '01991a00-0000-7000-8000-000000000099'
    }

    harness.fetch.mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('Private failure')).mockResolvedValueOnce({
      items: [viewing, older],
      summary,
      nextCursor: null
    })

    const { state } = setup()

    await state.load()
    await expect(state.load(true)).resolves.toBe(false)
    expect(state.items.value).toStrictEqual([viewing])
    expect(state.nextCursor.value).toBe('older')
    await expect(state.load(true)).resolves.toBe(true)
    expect(state.items.value).toStrictEqual([viewing, older])
  })

  it('recovers an invalid cursor while keeping rows visible until the new page arrives', async () => {
    const replacement = Promise.withResolvers<unknown>()

    harness.fetch.mockResolvedValueOnce({
      ...page,
      nextCursor: 'old'
    }).mockRejectedValueOnce({ statusCode: 400 }).mockReturnValueOnce(replacement.promise)

    const { state } = setup()

    await state.load()

    const more = state.load(true)

    await vi.waitFor(() => { expect(harness.fetch).toHaveBeenCalledTimes(3) })
    expect(state.items.value).toStrictEqual([viewing])
    replacement.resolve(empty)
    await expect(more).resolves.toBe(true)
    expect(state.didRecoverCursor.value).toBe(true)
    expect(state.items.value).toStrictEqual([])
  })

  it('reuses the complete creation request across midnight and preserves a confirmed write if refresh fails', async () => {
    harness.fetch.mockResolvedValueOnce(empty).mockRejectedValueOnce(new Error('Lost answer'))

    const { state } = setup()

    await state.load()
    await expect(state.create('current')).resolves.toBe(false)

    const original = globalThis.structuredClone(harness.fetch.mock.calls[1]?.[1].body)

    vi.setSystemTime(new Date(2026, 9, 18, 12))

    harness.fetch.mockResolvedValueOnce({
      viewing,
      summary
    }).mockRejectedValueOnce(new Error('Read failed'))

    await expect(state.retryMutation()).resolves.toBe(true)
    expect(harness.fetch.mock.calls[2]?.[1].body).toStrictEqual(original)

    expect(original).toMatchObject({
      completedOn: '2026-10-17',
      status: 'completed',
      currentViewingId: null,
      contextVersion: 0
    })

    expect(state.items.value).toStrictEqual([viewing])
    expect(state.pendingMutation.value).toBeNull()
    expect(state.readError.value).not.toBe('')
  })

  it('blocks overlapping writes and unrelated changes while an outcome is unknown', async () => {
    const pending = Promise.withResolvers<unknown>()

    harness.fetch.mockResolvedValueOnce(page).mockReturnValueOnce(pending.promise)

    const { state } = setup()

    await state.load()

    const deleting = state.remove(viewing)

    expect(state.unconfirmedMutation.value).toBeNull()
    await expect(state.create('current')).resolves.toBe(false)
    expect(harness.fetch).toHaveBeenCalledTimes(2)
    pending.reject(new Error('Lost delete answer'))
    await expect(deleting).resolves.toBe(false)
    expect(state.unconfirmedMutation.value?.key).toBe(`delete:${viewing.id}`)
    await expect(state.saveCurrentScore(8)).resolves.toBe(false)
    expect(state.items.value).toStrictEqual([viewing])
    expect(harness.fetch).toHaveBeenCalledTimes(2)
  })

  it('keeps editing locked until the confirmed write has refreshed its history', async () => {
    const refresh = Promise.withResolvers<unknown>()

    harness.fetch.mockResolvedValueOnce(empty).mockResolvedValueOnce({
      viewing,
      summary
    }).mockReturnValueOnce(refresh.promise)

    const { state } = setup()

    await state.load()

    const saving = state.create('history', {
      status: 'completed',
      startedOn: null,
      completedOn: '2026-10-17'
    })

    await vi.waitFor(() => { expect(harness.fetch).toHaveBeenCalledTimes(3) })
    expect(state.items.value).toStrictEqual([viewing])
    expect(state.isSaving.value).toBe(true)
    expect(state.unconfirmedMutation.value).toBeNull()

    await expect(state.update(viewing, {
      status: 'completed',
      startedOn: null,
      completedOn: '2026-10-16'
    })).resolves.toBe(false)

    refresh.resolve(page)
    await expect(saving).resolves.toBe(true)
    expect(state.isSaving.value).toBe(false)
  })

  it('keeps the selected historical viewing after a page refresh and uses its revision for edits', async () => {
    const past = {
      ...viewing,
      id: '01991a00-0000-7000-8000-000000000099',
      completedOn: '2026-10-01'
    }

    harness.fetch.mockResolvedValueOnce({
      ...page,
      items: [viewing, past]
    })

    const { state } = setup()

    await state.load()
    state.select(past)

    const updated = {
      ...past,
      completedOn: '2026-09-30',
      revision: 2
    }

    harness.fetch.mockResolvedValueOnce({
      viewing: updated,
      summary
    }).mockResolvedValueOnce(page)

    await expect(state.update(past, {
      status: 'completed',
      startedOn: null,
      completedOn: '2026-09-30'
    })).resolves.toBe(true)

    expect(harness.fetch.mock.calls[1]?.[1].body).toMatchObject({
      revision: 1,
      status: 'completed',
      completedOn: '2026-09-30',
      requestId: requestIdPattern
    })

    expect(state.selectedViewing.value).toStrictEqual(updated)
    expect(state.summary.value.currentViewingId).toBe(viewing.id)
  })

  it('does not regress a confirmed viewing when an older point read finishes', async () => {
    harness.fetch.mockResolvedValueOnce(page)

    const { state } = setup()

    await state.load()

    const pending = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(pending.promise)

    const reading = state.loadPoint(viewing.id)

    const newer = {
      ...viewing,
      score: 8,
      revision: 3
    }

    state.applyConfirmed({
      viewing: newer,
      summary
    })

    pending.resolve({ viewing })
    await expect(reading).resolves.toStrictEqual(newer)
    expect(state.items.value).toStrictEqual([newer])
  })

  it('exposes safe conflict field errors and accepts a fresh request after refresh', async () => {
    harness.fetch.mockResolvedValueOnce(page).mockRejectedValueOnce({
      statusCode: 409,
      data: { error: { fields: { completedOn: 'Choose a later date.' } } }
    })

    const { state } = setup()

    await state.load()

    await expect(state.update(viewing, {
      status: 'completed',
      startedOn: null,
      completedOn: '2026-10-01'
    })).resolves.toBe(false)

    expect(state.fields.value).toStrictEqual({ completedOn: 'Choose a later date.' })
    expect(state.saveError.value).toContain('Refresh')
    expect(state.pendingMutation.value).toBeNull()
  })
})
