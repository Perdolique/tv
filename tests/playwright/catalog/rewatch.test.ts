import type { BrowserContext } from '@playwright/test'
import * as v from 'valibot'

import {
  catalogViewingDeletionResponseSchema,
  catalogViewingMutationResponseSchema,
  catalogViewingResponseSchema
} from '../../../packages/shared/src/catalog-viewings.ts'

import { catalogSeriesWatchesResponseSchema } from '../../../packages/shared/src/catalog-series.ts'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { chernobyl } from './details.fixtures.ts'
import { openEpisodes } from './helpers.ts'
import { firstEpisodeId, titlePath } from './timeline.fixtures.ts'

const viewingsPath = `/api/catalog/items/${chernobyl.id}/viewings`
const cancelPath = `/api/catalog/items/${chernobyl.id}/rewatch`
const watchPath = `/api/catalog/episodes/${firstEpisodeId}/watched`

test.use({ timezoneId: 'Europe/Tallinn' })

async function createEmptyRewatch(context: BrowserContext) {
  await addCookie(context, 'tv_session', 'e2e-session')

  const firstRequestId = globalThis.crypto.randomUUID()

  const firstResponse = await context.request.post(viewingsPath, { data: {
    requestId: firstRequestId,
    mode: 'current',
    currentViewingId: null,
    contextVersion: 0,
    status: 'watching',
    startedOn: '2026-10-01',
    completedOn: null
  } })

  const firstRaw: unknown = await firstResponse.json()
  const first = v.parse(catalogViewingMutationResponseSchema, firstRaw)
  const markRequestId = globalThis.crypto.randomUUID()

  const markedResponse = await context.request.put(watchPath, { data: {
    requestId: markRequestId,
    currentViewingId: first.viewing.id,
    contextVersion: first.summary.contextVersion,
    timeZone: 'Europe/Tallinn'
  } })

  const markedRaw: unknown = await markedResponse.json()
  const marked = v.parse(catalogSeriesWatchesResponseSchema, markedRaw)
  const secondRequestId = globalThis.crypto.randomUUID()

  const secondResponse = await context.request.post(viewingsPath, { data: {
    requestId: secondRequestId,
    mode: 'current',
    currentViewingId: first.viewing.id,
    contextVersion: marked.summary.contextVersion,
    status: 'watching',
    startedOn: '2026-10-17',
    completedOn: null,
    completeCurrentOn: '2026-10-16'
  } })

  const secondRaw: unknown = await secondResponse.json()
  const second = v.parse(catalogViewingMutationResponseSchema, secondRaw)

  return {
    first,
    second
  }
}

test('routes empty rewatch cancellation through Nitro with its exact JSON context', async ({ context }) => {
  const { first, second } = await createEmptyRewatch(context)
  const requestId = globalThis.crypto.randomUUID()

  const response = await context.request.delete(cancelPath, { data: {
    requestId,
    currentViewingId: second.viewing.id,
    contextVersion: second.summary.contextVersion
  } })

  expect(response.status()).toBe(200)

  const raw: unknown = await response.json()
  const result = v.parse(catalogViewingDeletionResponseSchema, raw)

  expect(result.summary.currentViewingId).toBe(first.viewing.id)
  expect(result.summary.contextVersion).toBe(second.summary.contextVersion + 1)

  const restoredPath = `${viewingsPath}/${first.viewing.id}`
  const restoredResponse = await context.request.get(restoredPath)
  const restoredRaw: unknown = await restoredResponse.json()
  const restored = v.parse(catalogViewingResponseSchema, restoredRaw)

  expect(restored.viewing).toMatchObject({
    status: 'watching',
    completedOn: null,
    startedOn: '2026-10-01'
  })
})

test('completes the current viewing when starting a rewatch and restores its progress on cancellation', async ({ context, page }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await page.goto(titlePath)
  await openEpisodes(page)

  await page.getByRole('listitem').filter({ hasText: '1:23:45' }).getByRole('button', {
    name: 'Watched',
    exact: true
  }).click()

  await expect(page.getByText('1 watched episode', { exact: true })).toBeVisible()

  await page.getByRole('button', {
    name: 'Mark season 1 watched',
    exact: true
  }).click()

  await expect(page.getByText('5 watched episodes', { exact: true })).toBeVisible()

  const rewatch = page.getByRole('button', {
    name: 'Start rewatch',
    exact: true
  })

  await rewatch.focus()
  await page.keyboard.press('Enter')

  const dialog = page.getByRole('dialog', {
    name: 'Start a rewatch',
    exact: true
  })

  const confirm = dialog.getByRole('button', {
    name: 'Complete current viewing and start rewatch',
    exact: true
  })

  await expect(dialog.getByLabel('Complete current viewing on', { exact: true })).toBeVisible()
  await expect(dialog.getByLabel('Start rewatch on', { exact: true })).toBeVisible()

  await expect(dialog.getByRole('button', {
    name: 'Cancel',
    exact: true
  })).toBeFocused()

  await page.keyboard.press('Shift+Tab')
  await expect(confirm).toBeFocused()
  await page.keyboard.press('Tab')

  await expect(dialog.getByRole('button', {
    name: 'Cancel',
    exact: true
  })).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(rewatch).toBeFocused()
  await page.keyboard.press('Enter')
  await confirm.click()
  await expect(dialog).not.toBeVisible()

  const undo = page.getByRole('button', {
    name: 'Cancel rewatch',
    exact: true
  })

  const history = page.getByRole('list', {
    name: 'Series viewings',
    exact: true
  })

  await expect(undo).toBeFocused()
  await expect(page.getByText('0 watched episodes', { exact: true })).toBeVisible()
  await expect(history.getByRole('listitem')).toHaveCount(2)
  await expect(history.getByRole('heading', { name: /^Completed viewing/u })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Your timeline' }).getByText('Started rewatch', { exact: true })).toBeVisible()
  await undo.click()
  await expect(rewatch).toBeFocused()
  await expect(history.getByRole('listitem')).toHaveCount(1)
  await expect(history.getByRole('heading', { name: /^Watching viewing/u })).toBeVisible()
  await expect(page.getByText('5 watched episodes', { exact: true })).toBeVisible()

  await expect(page.getByRole('button', {
    name: 'Watched',
    exact: true
  }).and(page.locator('[aria-pressed="true"]'))).toHaveCount(5)

  await expect(page.getByRole('region', { name: 'Your timeline' }).getByText('Started rewatch', { exact: true })).toHaveCount(0)

  await page.getByRole('listitem').filter({ hasText: '1:23:45' }).getByRole('button', {
    name: 'Watched',
    exact: true
  }).click()

  await expect(page.getByText('4 watched episodes', { exact: true })).toBeVisible()
})

test('keeps newer outside focus after a delayed rewatch cancellation', async ({ context, page }) => {
  await createEmptyRewatch(context)
  await page.goto(titlePath)
  await openEpisodes(page)

  const pending = Promise.withResolvers<unknown>()
  const started = Promise.withResolvers<unknown>()

  await page.route(`**${cancelPath}`, async route => {
    started.resolve(null)

    await pending.promise

    await route.continue()
  }, { times: 1 })

  try {
    await page.getByRole('button', {
      name: 'Cancel rewatch',
      exact: true
    }).click()

    await started.promise

    const outside = page.getByRole('link', {
      name: 'Catalog',
      exact: true
    })

    await outside.focus()
    pending.resolve(null)

    await expect(page.getByRole('button', {
      name: 'Start rewatch',
      exact: true
    })).toBeEnabled()

    await expect(outside).toBeFocused()
  } finally {
    pending.resolve(null)
  }
})

test('keeps the empty rewatch after deleting its predecessor and removes unavailable cancellation', async ({ context, page }) => {
  await createEmptyRewatch(context)
  await page.goto(titlePath)
  await openEpisodes(page)

  const viewings = page.getByRole('list', {
    name: 'Series viewings',
    exact: true
  })

  const previous = viewings.getByRole('listitem').filter({ has: page.getByRole('heading', { name: /^Completed viewing/u }) })

  const cancel = page.getByRole('button', {
    name: 'Cancel rewatch',
    exact: true
  })

  await expect(cancel).toBeEnabled()

  await previous.getByRole('button', {
    name: 'Delete',
    exact: true
  }).click()

  await previous.getByRole('button', {
    name: 'Delete viewing',
    exact: true
  }).click()

  await expect(viewings.getByRole('listitem')).toHaveCount(1)
  await expect(viewings.getByRole('heading', { name: /^Watching viewing/u })).toBeVisible()
  await expect(viewings.getByText('Current', { exact: true })).toBeVisible()
  await expect(cancel).toHaveCount(0)
  await expect(page.getByText('0 watched episodes', { exact: true })).toBeVisible()
})

test.describe('rewatch cancellation conflicts', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: cancelPath,
    status: 409
  }] } })

  test('keeps the cancellation error visible when another tab has marked an episode', async ({ context, page }) => {
    const { second } = await createEmptyRewatch(context)

    const initialReadPaths = [
      viewingsPath,
      `/api/catalog/items/${chernobyl.id}/episodes/watched`,
      `/api/catalog/items/${chernobyl.id}/seasons/1/rating`,
      `/api/catalog/items/${chernobyl.id}/seasons/1/episodes/ratings`
    ]

    const initialReads = initialReadPaths.map(async path => page.waitForResponse(`**${path}`))

    await page.goto(titlePath)
    await openEpisodes(page)

    // Finish initial private reads before the other-tab mutation leaves this page's context stale.
    const initialResponses = await Promise.all(initialReads)
    const statuses = initialResponses.map(response => response.status())
    const completedReads = await Promise.all(initialResponses.map(async response => response.finished()))

    expect(statuses).toStrictEqual([200, 200, 200, 200])
    expect(completedReads).toStrictEqual([null, null, null, null])

    const cancel = page.getByRole('button', {
      name: 'Cancel rewatch',
      exact: true
    })

    await expect(page.getByText('0 watched episodes', { exact: true })).toBeVisible()

    await expect(page.getByRole('listitem').filter({ hasText: '1:23:45' }).getByRole('button', {
      name: 'Watched',
      exact: true
    })).toHaveAttribute('aria-pressed', 'false')

    await expect(cancel).toBeEnabled()

    const requestId = globalThis.crypto.randomUUID()

    const marked = await context.request.put(watchPath, { data: {
      requestId,
      currentViewingId: second.viewing.id,
      contextVersion: second.summary.contextVersion,
      timeZone: 'Europe/Tallinn'
    } })

    expect(marked.status()).toBe(200)
    await cancel.click()
    await expect(page.getByText('1 watched episode', { exact: true })).toBeVisible()

    await expect(page.getByRole('button', {
      name: 'Cancel rewatch',
      exact: true
    })).toHaveCount(0)

    await expect(page.getByRole('region', {
      name: 'Current series viewing',
      exact: true
    }).getByRole('alert')).toContainText('Your viewing changed.')

    await expect(page.getByRole('alert').filter({ hasText: 'Your viewing changed.' })).toHaveCount(1)

    await expect(page.getByRole('button', {
      name: 'Start rewatch',
      exact: true
    })).toBeFocused()
  })
})
