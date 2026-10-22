/* oxlint-disable vitest/prefer-each -- Playwright parameterizes browser cases with loops. */
import assert from 'node:assert/strict'
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { chernobyl } from './details.fixtures.ts'
import { openEpisodes, waitForHydration } from './helpers.ts'

const path = `/titles/${chernobyl.id}`

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

async function startSeries(page: Page): Promise<void> {
  await page.goto(path)
  await waitForHydration(page)

  const rating = page.getByRole('region', {
    name: 'Your rating',
    exact: true
  })

  await rating.getByRole('button', {
    name: 'Rate',
    exact: true
  }).click()

  await rating.getByRole('button', {
    name: '7 out of 10',
    exact: true
  }).click()

  await expect(badge(page)).toHaveText('Watching')
}

test.beforeEach(async ({ context, page }) => {
  await addCookie(context, 'tv_session', 'e2e-session')

  const now = new Date('2026-10-22T12:00:00Z')

  await page.clock.setFixedTime(now)
})

for (const theme of ['light', 'dark'] as const) {
  for (const [width, height] of [[390, 844], [768, 1024], [1440, 1024]] as const) {
    test(`keeps explicit series status, keyboard focus and usable controls in ${theme} at ${width}px`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })

      await page.setViewportSize({
        width,
        height
      })

      await startSeries(page)
      await statusTrigger(page).focus()
      await page.keyboard.press('Enter')

      const panel = page.getByRole('dialog', {
        name: 'Viewing status',
        exact: true
      })

      await expect(panel).toBeVisible()

      await panel.getByRole('button', {
        name: 'Paused',
        exact: true
      }).focus()

      await page.keyboard.press('Enter')
      await expect(badge(page)).toHaveText('Paused')
      await expect(badge(page).locator('svg')).toBeVisible()
      await expect(statusTrigger(page)).toBeFocused()
      await openEpisodes(page)

      const mark = page.getByRole('button', {
        name: 'Watched',
        exact: true
      }).first()

      await mark.click()
      await expect(badge(page)).toHaveText('Paused')
      await expect(page.getByText('1 watched episode', { exact: true })).toBeVisible()
      await chooseStatus(page, 'Dropped')
      await expect(badge(page)).toHaveText('Dropped')

      const history = page.getByRole('list', {
        name: 'Series viewings',
        exact: true
      })

      await expect(history.getByRole('listitem')).toHaveCount(1)
      await expect(history.getByRole('heading', { name: /^Dropped viewing/u })).toBeVisible()
      await statusTrigger(page).click()

      await expect(panel.getByRole('button', {
        name: 'Dropped',
        exact: true
      })).toHaveAttribute('aria-pressed', 'true')

      const box = await panel.boundingBox()

      assert.ok(box !== null, 'The status panel needs a visible layout box')
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(height)

      await page.screenshot({
        path: `/tmp/tv-gh91/status-${theme}-${width}.png`
      })

      await expect(panel).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(panel).not.toBeVisible()
      await expect(statusTrigger(page)).toBeFocused()
      await chooseStatus(page, 'Watching')
      await expect(badge(page)).toHaveText('Watching')
      await expect(history.getByRole('listitem')).toHaveCount(1)
      await expect(page.getByText('1 watched episode', { exact: true })).toBeVisible()
    })
  }
}

test('requires a completion date, preserves the confirmed status and supports cancelling completion', async ({ page }) => {
  await startSeries(page)
  await chooseStatus(page, 'Paused')
  await chooseStatus(page, 'Completed')

  const panel = page.getByRole('dialog', {
    name: 'Viewing status',
    exact: true
  })

  await expect(panel.getByLabel('Completed on', { exact: true })).toHaveValue('2026-10-22')
  await expect(badge(page)).toHaveText('Paused')

  await panel.getByRole('button', {
    name: 'Close viewing status',
    exact: true
  }).click()

  await expect(badge(page)).toHaveText('Paused')
  await chooseStatus(page, 'Completed')
  await panel.getByLabel('Completed on', { exact: true }).fill('2026-10-21')

  await panel.getByRole('button', {
    name: 'Complete viewing',
    exact: true
  }).click()

  await expect(badge(page)).toHaveText('Paused')
  await panel.getByLabel('Completed on', { exact: true }).fill('2026-10-22')

  await panel.getByRole('button', {
    name: 'Complete viewing',
    exact: true
  }).click()

  await expect(badge(page)).toHaveText('Completed')
  await chooseStatus(page, 'Dropped')
  await expect(badge(page)).toHaveText('Dropped')

  await expect(page.getByRole('list', {
    name: 'Series viewings',
    exact: true
  }).getByText('Completed on', { exact: true })).toHaveCount(0)
})

test('keeps the status editor open when a delayed progress read replaces the same viewing', async ({ page }) => {
  await startSeries(page)
  await chooseStatus(page, 'Paused')
  await expect(statusTrigger(page)).toBeEnabled()
  await openEpisodes(page)

  const started = Promise.withResolvers<boolean>()
  const release = Promise.withResolvers<boolean>()
  const readPath = `/api/catalog/items/${chernobyl.id}/episodes/watched`

  await page.route(`**${readPath}`, async route => {
    const response = await route.fetch()

    started.resolve(true)

    await release.promise

    await route.fulfill({ response })
  }, { times: 1 })

  try {
    await page.getByRole('button', {
      name: 'Watched',
      exact: true
    }).first().click()

    await started.promise

    await statusTrigger(page).click()

    const panel = page.getByRole('dialog', {
      name: 'Viewing status',
      exact: true
    })

    await expect(panel).toBeVisible()

    const received = page.waitForResponse(response => response.url().endsWith(readPath))

    release.resolve(true)

    await received

    await page.evaluate(async () => {
      const painted = Promise.withResolvers<boolean>()

      globalThis.requestAnimationFrame(() => { painted.resolve(true) })

      await painted.promise
    })

    await expect(panel).toBeVisible()

    await panel.getByRole('button', {
      name: 'Dropped',
      exact: true
    }).click()

    await expect(badge(page)).toHaveText('Dropped')
  } finally {
    release.resolve(true)
  }
})

test('retries the exact committed status request after response loss without displaying an unconfirmed change', async ({ page }) => {
  await startSeries(page)

  const payloads: unknown[] = []
  const routePattern = `**/api/catalog/items/${chernobyl.id}/viewings/*`

  await page.route(routePattern, async route => {
    const request = route.request()
    const input: unknown = request.postDataJSON()

    payloads.push(input)

    const response = await route.fetch()
    const responseStatus = response.status()

    expect(responseStatus).toBe(200)
    await route.fulfill({ response })
  })

  await page.route(routePattern, async route => {
    const request = route.request()
    const input: unknown = request.postDataJSON()

    payloads.push(input)

    const response = await route.fetch()
    const responseStatus = response.status()

    expect(responseStatus).toBe(200)

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{'
    })
  }, { times: 1 })

  await chooseStatus(page, 'Paused')

  const panel = page.getByRole('dialog', {
    name: 'Viewing status',
    exact: true
  })

  await expect(panel.getByRole('alert')).toContainText('Retry')
  await expect(badge(page)).toHaveText('Watching')

  await expect(panel.getByRole('button', {
    name: 'Dropped',
    exact: true
  })).toBeDisabled()

  await panel.getByRole('button', {
    name: 'Retry status change',
    exact: true
  }).click()

  await expect(badge(page)).toHaveText('Paused')
  expect(payloads).toHaveLength(2)
  expect(payloads[1]).toStrictEqual(payloads[0])
  await expect(statusTrigger(page)).toBeFocused()
})

for (const status of ['Paused', 'Dropped']) {
  test(`filters ${status} viewing history without including it in Currently watching`, async ({ page }) => {
    await startSeries(page)
    await chooseStatus(page, status)

    const value = status.toLowerCase()
    const location = `/dashboard?status=${value}`

    await page.goto(location)
    await waitForHydration(page)

    await expect(page.getByRole('radio', {
      name: status,
      exact: true
    })).toBeChecked()

    const entries = page.getByRole('list', {
      name: 'Viewing entries',
      exact: true
    })

    await expect(entries.getByRole('listitem')).toHaveCount(1)
    await expect(entries.getByText(status, { exact: true })).toBeVisible()
    await expect(entries.getByText(status, { exact: true }).locator('svg')).toBeVisible()
    await expect(page.locator('dd')).toHaveText(['0', '0', '0', '0'])

    await expect(page.getByRole('list', {
      name: 'Currently watching series',
      exact: true
    })).toHaveCount(0)

    await page.reload()
    await waitForHydration(page)
    await expect(entries.getByRole('listitem')).toHaveCount(1)
  })
}
