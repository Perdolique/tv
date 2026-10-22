import assert from 'node:assert/strict'
import * as v from 'valibot'
import type { Page } from '@playwright/test'

import {
  catalogViewingsResponseSchema,
  catalogViewingMutationResponseSchema,
  type CatalogViewing
} from '../../../packages/shared/src/catalog-viewings.ts'

import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { chernobyl } from './details.fixtures.ts'
import { waitForHydration } from './helpers.ts'

const path = `/titles/${chernobyl.id}`
const viewingsApi = `/api/catalog/items/${chernobyl.id}/viewings`

async function seedPastViewings(page: Page): Promise<CatalogViewing[]> {
  const response = await page.request.get(viewingsApi)
  const raw: unknown = await response.json()
  const history = v.parse(catalogViewingsResponseSchema, raw)
  let { summary } = history
  const viewings: CatalogViewing[] = []

  for (let day = 1; day <= 21; day += 1) {
    const requestId = globalThis.crypto.randomUUID()
    const dayText = String(day)
    const paddedDay = dayText.padStart(2, '0')
    const date = `2020-01-${paddedDay}`

    // oxlint-disable-next-line eslint/no-await-in-loop -- Each creation uses the previous confirmed context version.
    const createdResponse = await page.request.post(viewingsApi, { data: {
      requestId,
      mode: 'history',
      currentViewingId: summary.currentViewingId,
      contextVersion: summary.contextVersion,
      status: 'completed',
      startedOn: date,
      completedOn: date
    } })

    const createdStatus = createdResponse.status()

    expect(createdStatus).toBe(200)

    // oxlint-disable-next-line eslint/no-await-in-loop -- Read this response before constructing the next creation.
    const createdRaw: unknown = await createdResponse.json()
    const created = v.parse(catalogViewingMutationResponseSchema, createdRaw)
    const { summary: confirmedSummary } = created

    summary = confirmedSummary

    viewings.push(created.viewing)
  }

  return viewings
}

function statusTrigger(page: Page) {
  // The first status action belongs to the title header; the rest belong to individual history cards.
  return page.getByRole('region', {
    name: 'Viewing status action',
    exact: true
  }).first().getByRole('button', {
    name: 'Viewing status',
    exact: true
  })
}

function badge(page: Page) {
  return page.getByRole('heading', { level: 1 }).locator('..').getByRole('status')
}

async function chooseStatus(page: Page, status: string): Promise<void> {
  await statusTrigger(page).click()

  await page.getByRole('dialog', {
    name: 'Viewing status',
    exact: true
  }).getByRole('button', {
    name: status,
    exact: true
  }).click()
}

test.beforeEach(async ({ context, page }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'tv_watched_item', chernobyl.id)

  const now = new Date('2026-10-22T12:00:00Z')

  await page.clock.setFixedTime(now)
})

test.describe('independent status and date changes', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: `${viewingsApi}/${chernobyl.id}`,
    status: 409
  }] } })

  test('rejects an old date draft after a status change and refreshes its saved status', async ({ page }) => {
    await page.goto(path)
    await waitForHydration(page)

    const history = page.getByRole('region', {
      name: 'Your viewings',
      exact: true
    })

    const current = history.locator('[data-current]')

    await current.getByRole('button', {
      name: 'Edit dates',
      exact: true
    }).click()

    await current.getByLabel('Started on', { exact: true }).fill('2026-09-20')
    await chooseStatus(page, 'Paused')
    await expect(badge(page)).toHaveText('Paused')

    await current.getByRole('button', {
      name: 'Save viewing',
      exact: true
    }).click()

    await expect(history.getByRole('alert')).toContainText('Your viewing changed.')
    await expect(current.getByLabel('Started on', { exact: true })).toHaveValue('2026-09-20')
    await expect(badge(page)).toHaveText('Paused')

    await history.getByRole('button', {
      name: 'Refresh viewings',
      exact: true
    }).click()

    await expect(current.getByLabel('Viewing status', { exact: true })).toHaveValue('paused')
    await expect(current.getByLabel('Started on', { exact: true })).toHaveValue('2026-09-20')
    await current.getByLabel('Started on', { exact: true }).fill('2026-09-20')

    await current.getByRole('button', {
      name: 'Save viewing',
      exact: true
    }).click()

    await expect(current.getByRole('heading')).toContainText('Paused viewing')
    await expect(current.getByText('Sep 20, 2026', { exact: true })).toBeVisible()
    await page.reload()
    await waitForHydration(page)
    await expect(badge(page)).toHaveText('Paused')
  })
})

test('keeps a historical status card and its keyboard focus after refreshing the first history page', async ({ page }) => {
  await page.goto(path)
  await waitForHydration(page)

  const past = await seedPastViewings(page)
  const [oldest] = past

  assert.ok(oldest !== undefined)
  await page.reload()
  await waitForHydration(page)

  const history = page.getByRole('region', {
    name: 'Your viewings',
    exact: true
  })

  await expect(history.getByRole('listitem')).toHaveCount(20)

  await history.getByRole('button', {
    name: 'Load more viewings',
    exact: true
  }).click()

  const card = history.locator(`[id="viewing-${oldest.id}"]`)

  const trigger = card.getByRole('button', {
    name: 'Viewing status',
    exact: true
  })

  await trigger.focus()
  await page.keyboard.press('Enter')

  await card.getByRole('button', {
    name: 'Paused',
    exact: true
  }).click()

  await expect(card.getByRole('heading', { level: 3 })).toContainText('Paused viewing')
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Enter')

  await card.getByRole('button', {
    name: 'Dropped',
    exact: true
  }).focus()

  await page.keyboard.press('Enter')
  await expect(card.getByRole('heading', { level: 3 })).toContainText('Dropped viewing')
  await expect(trigger).toBeFocused()
})
