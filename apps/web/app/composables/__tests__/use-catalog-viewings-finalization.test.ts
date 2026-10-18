import { describe, expect, it } from 'vitest'
import type { CatalogViewing } from '@tv/shared/catalog-viewings'
import { harness, id, setup, summary, viewing } from '../../testing/catalog-viewings-harness.ts'

const current: CatalogViewing = {
  ...viewing,
  status: 'watching',
  startedOn: '2026-10-17',
  completedOn: null
}

const past: CatalogViewing = {
  ...current,
  id: '01991a00-0000-7000-8000-000000000099',
  status: 'completed',
  startedOn: '2026-10-01',
  completedOn: '2026-10-10'
}

const page = {
  items: [current, past],
  summary,
  nextCursor: null
}

describe('confirmed viewing selection finalization', () => {
  it('clears a selected deleted viewing after an exact retry and retains the current viewing', async () => {
    const recoveredSummary = {
      ...summary,
      completedCount: 0,
      contextVersion: 2
    }

    harness.fetch.mockResolvedValueOnce(page).mockRejectedValueOnce(new Error('Lost deletion answer')).mockRejectedValueOnce({ statusCode: 409 }).mockResolvedValueOnce({
      items: [current],
      summary: recoveredSummary,
      nextCursor: null
    }).mockRejectedValueOnce({ statusCode: 404 })

    const { state } = setup(false, 'series')

    await state.load()
    state.select(past)

    const selectedKey = state.selectionKey.value

    await expect(state.remove(past)).resolves.toBe(false)

    const original = harness.fetch.mock.calls[1]?.[1].body

    expect(state.selectedViewing.value).toStrictEqual(past)
    await expect(state.retryMutation()).resolves.toBe(false)
    expect(harness.fetch.mock.calls[2]?.[1].body).toStrictEqual(original)
    expect(state.items.value).toStrictEqual([current])
    expect(state.currentViewing.value).toStrictEqual(current)
    expect(state.summary.value).toStrictEqual(recoveredSummary)
    expect(state.selectedViewingId.value).toBeNull()
    expect(state.selectedViewing.value).toBeNull()
    expect(state.isHistorical.value).toBe(false)
    expect(state.selectionKey.value).not.toBe(selectedKey)
    expect(state.deletedViewingId.value).toBe(past.id)
    expect(harness.fetch.mock.calls[4]?.[0]).toBe(`/api/catalog/items/${id}/viewings/${past.id}`)
  })

  it('preserves a selected viewing outside the first page when its deletion conflicts', async () => {
    const refreshed = {
      ...past,
      revision: 2
    }

    harness.fetch.mockResolvedValueOnce(page).mockRejectedValueOnce({ statusCode: 409 }).mockResolvedValueOnce({
      items: [current],
      summary,
      nextCursor: 'past-viewings'
    }).mockResolvedValueOnce({ viewing: refreshed })

    const { state } = setup(false, 'series')

    await state.load()
    state.select(past)
    await expect(state.remove(past)).resolves.toBe(false)
    expect(state.selectedViewingId.value).toBe(past.id)
    expect(state.selectedViewing.value).toStrictEqual(refreshed)
    expect(state.deletedViewingId.value).toBeNull()
    expect(harness.fetch.mock.calls[3]?.[0]).toBe(`/api/catalog/items/${id}/viewings/${past.id}`)
  })

  it('preserves another selected historical viewing when a different viewing is deleted', async () => {
    const other: CatalogViewing = {
      ...past,
      id: '01991a00-0000-7000-8000-000000000098'
    }

    harness.fetch.mockResolvedValueOnce({
      ...page,
      items: [current, past, other]
    }).mockResolvedValueOnce({ summary }).mockResolvedValueOnce(page)

    const { state } = setup(false, 'series')

    await state.load()
    state.select(past)
    await expect(state.remove(other)).resolves.toBe(true)
    expect(state.items.value).toStrictEqual([current, past])
    expect(state.selectedViewingId.value).toBe(past.id)
    expect(state.selectedViewing.value).toStrictEqual(past)
    expect(state.isHistorical.value).toBe(true)
  })

  it('returns to current context after retrying a creation from a selected historical viewing', async () => {
    const created: CatalogViewing = {
      ...current,
      id: '01991a00-0000-7000-8000-000000000003',
      startedOn: '2026-10-18',
      isRewatch: true,
      canCancelRewatch: true
    }

    const createdSummary = {
      ...summary,
      currentViewingId: created.id,
      contextVersion: 2
    }

    harness.fetch.mockResolvedValueOnce(page).mockRejectedValueOnce(new Error('Lost creation answer')).mockResolvedValueOnce({
      viewing: created,
      summary: createdSummary
    }).mockResolvedValueOnce({
      items: [created, current, past],
      summary: createdSummary,
      nextCursor: null
    })

    const { state } = setup(false, 'series')

    await state.load()
    state.select(past)

    await expect(state.create('current', {
      status: 'watching',
      startedOn: '2026-10-18',
      completedOn: null
    }, '2026-10-17')).resolves.toBe(false)

    const original = harness.fetch.mock.calls[1]?.[1].body

    await expect(state.retryMutation()).resolves.toBe(true)
    expect(harness.fetch.mock.calls[2]?.[1].body).toStrictEqual(original)
    expect(state.selectedViewingId.value).toBeNull()
    expect(state.selectedViewing.value).toBeNull()
    expect(state.isHistorical.value).toBe(false)
    expect(state.currentViewing.value).toStrictEqual(created)
  })

  it('removes the canceled rewatch and its selection after an exact cancellation retry', async () => {
    const rewatch: CatalogViewing = {
      ...current,
      isRewatch: true,
      canCancelRewatch: true
    }

    const restored: CatalogViewing = {
      ...past,
      status: 'watching',
      completedOn: null,
      revision: 2
    }

    const restoredSummary = {
      ...summary,
      currentViewingId: restored.id,
      contextVersion: 2
    }

    harness.fetch.mockResolvedValueOnce({
      ...page,
      items: [rewatch, past]
    }).mockRejectedValueOnce(new Error('Lost cancellation answer')).mockResolvedValueOnce({
      summary: restoredSummary
    }).mockResolvedValueOnce({
      items: [restored],
      summary: restoredSummary,
      nextCursor: null
    })

    const { state } = setup(false, 'series')

    await state.load()
    state.select(rewatch)

    const url = `/api/catalog/items/${id}/rewatch`

    const response = await state.mutate({
      key: 'rewatch:cancel',
      url,
      method: 'DELETE',

      body: {
        requestId: '01991a00-0000-7000-8000-000000000004',
        currentViewingId: rewatch.id,
        contextVersion: 1
      },

      operation: 'viewing'
    })

    expect(response).toBeNull()

    const original = harness.fetch.mock.calls[1]?.[1].body

    await expect(state.retryMutation()).resolves.toBe(true)
    expect(harness.fetch.mock.calls[2]?.[1].body).toStrictEqual(original)
    expect(state.items.value).toStrictEqual([restored])
    expect(state.currentViewing.value).toStrictEqual(restored)
    expect(state.selectedViewingId.value).toBeNull()
    expect(state.selectedViewing.value).toBeNull()
    expect(state.isHistorical.value).toBe(false)
  })
})
