import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { appBaseUrl } from '../constants.ts'
import { dune } from './details.fixtures.ts'
import { waitForHydration } from './helpers.ts'

const titlePath = `/titles/${dune.id}`
const summaryPath = `/api/catalog/items/${dune.id}/rating-summary`
const summaryRoute = `**${summaryPath}`

async function holdSummary(page: Page) {
  const started = Promise.withResolvers<boolean>()
  const release = Promise.withResolvers<boolean>()
  let aborted = false

  await page.route(summaryRoute, async route => {
    started.resolve(true)

    await release.promise

    if (!aborted) {
      await route.continue()
    }
  }, { times: 1 })

  return {
    started: started.promise,
    release: () => { release.resolve(true) },

    abandon: () => {
      aborted = true

      release.resolve(true)
    }
  }
}

test.describe('viewer rating navigation', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([{
      name: 'tv_session',
      value: 'e2e-session',
      url: appBaseUrl
    }])
  })

  test('loads lazily on client navigation without moving personal actions', async ({ page }) => {
    await page.setViewportSize({
      width: 390,
      height: 844
    })

    const id = '01991a00-0000-7000-8000-000000000001'
    const release = Promise.withResolvers<boolean>()

    await page.route(`**/api/catalog/items/${id}/rating-summary`, async route => {
      await release.promise

      await route.continue()
    })

    try {
      await page.goto('/?query=arrival')
      await waitForHydration(page)

      await page.getByRole('link', {
        name: 'Arrival Movie · 2016',
        exact: true
      }).click()

      await expect(page.getByRole('heading', {
        name: 'Arrival',
        exact: true
      })).toBeVisible()

      await expect(page.getByRole('region', { name: 'TV viewer rating' }).getByText('Loading viewer rating…')).toBeVisible()

      const rate = page.getByRole('button', {
        name: 'Rate',
        exact: true
      })

      await expect(rate).toBeEnabled()

      const follow = page.getByRole('button', {
        name: 'Follow',
        exact: true
      })

      await expect(follow).toBeEnabled()
      await page.evaluate(async () => { await globalThis.document.fonts.ready })

      const loadingBox = await rate.boundingBox()
      const loadingFollowBox = await follow.boundingBox()

      release.resolve(true)
      await expect(page.getByRole('region', { name: 'TV viewer rating' }).getByText('Not rated', { exact: true })).toBeVisible()

      const loadedBox = await rate.boundingBox()
      const loadedFollowBox = await follow.boundingBox()

      expect(loadedBox).toStrictEqual(loadingBox)
      expect(loadedFollowBox).toStrictEqual(loadingFollowBox)
    } finally {
      release.resolve(true)
    }
  })

  test('aborts an abandoned refresh and shows only the next title', async ({ page }) => {
    await page.goto(`${titlePath}?query=a`)
    await waitForHydration(page)

    const held = await holdSummary(page)

    try {
      await page.getByRole('button', {
        name: 'Rate',
        exact: true
      }).click()

      await page.getByRole('button', {
        name: '8 out of 10',
        exact: true
      }).click()

      await held.started

      await expect(page.getByRole('region', { name: 'TV viewer rating' }).getByText('0 ratings', { exact: true })).toBeVisible()

      const failed = page.waitForEvent('requestfailed', {
        predicate: request => request.url().endsWith(summaryPath),
        timeout: 5000
      })

      await page.getByRole('link', { name: 'Back to results' }).click()

      const cancelled = await failed

      held.abandon()
      expect(cancelled.failure()?.errorText).toBe('net::ERR_ABORTED')

      await page.getByRole('link', {
        name: 'Dark Series · 2017',
        exact: true
      }).click()

      await expect(page.getByRole('heading', {
        name: 'Dark',
        exact: true
      })).toBeVisible()

      await expect(page.getByRole('region', { name: 'TV viewer rating' }).getByText('Not rated', { exact: true })).toBeVisible()
      await expect(page.getByRole('region', { name: 'TV viewer rating' }).getByText('8 out of 10', { exact: true })).toHaveCount(0)
    } finally {
      held.release()
    }
  })
})
