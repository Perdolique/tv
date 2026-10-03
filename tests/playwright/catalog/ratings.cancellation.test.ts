import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { appBaseUrl } from '../constants.ts'
import { dune } from './details.fixtures.ts'
import { waitForHydration } from './helpers.ts'

const ratingPath = `/api/catalog/items/${dune.id}/rating`
const titlePath = `/titles/${dune.id}?query=a`
const ratingRoute = `**${ratingPath}`

test.beforeEach(async ({ context }) => {
  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])
})

async function expectAbandonedRating(page: Page, method: string, start: () => Promise<unknown>): Promise<void> {
  const release = Promise.withResolvers<boolean>()
  const started = Promise.withResolvers<boolean>()
  const panel = page.getByRole('region', { name: 'Your rating' })
  let aborted = false

  await page.route(ratingRoute, async route => {
    started.resolve(true)

    await release.promise

    if (!aborted) {
      await route.continue()
    }
  }, { times: 1 })

  try {
    await start()

    await started.promise

    const failed = page.waitForEvent('requestfailed', {
      predicate: request => {
        const rawUrl = request.url()
        const requestUrl = new URL(rawUrl)
        const isOldRating = requestUrl.pathname === ratingPath && request.method() === method

        return isOldRating
      },

      timeout: 5000
    })

    await page.getByRole('link', { name: 'Back to results' }).click()

    const cancelled = await failed

    aborted = true

    expect(cancelled.failure()?.errorText).toBe('net::ERR_ABORTED')
    release.resolve(true)

    await page.getByRole('link', {
      name: 'Dark Series · 2017',
      exact: true
    }).click()

    await expect(page.getByRole('heading', {
      name: 'Dark',
      exact: true
    })).toBeVisible()

    await expect(panel.getByRole('button', {
      name: 'Rate',
      exact: true
    })).toBeVisible()

    await expect(panel.getByText('8 / 10', { exact: true })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: /^\d+ out of 10$/u })).toHaveCount(0)
    await expect(panel.getByRole('status')).toBeEmpty()
  } finally {
    release.resolve(true)
  }
}

test('aborts an abandoned rating GET request and shows only the next title', async ({ page }) => {
  await expectAbandonedRating(page, 'GET', async () => page.goto(titlePath))
})

test('aborts an abandoned rating PUT request and shows only the next title', async ({ page }) => {
  await page.goto(titlePath)
  await waitForHydration(page)

  await page.getByRole('button', {
    name: 'Rate',
    exact: true
  }).click()

  const chosenScore = page.getByRole('button', {
    name: '8 out of 10',
    exact: true
  })

  await expectAbandonedRating(page, 'PUT', async () => chosenScore.click())
})
