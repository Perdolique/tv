/* oxlint-disable vitest/prefer-each -- Playwright uses loops for viewport and color-scheme snapshots. */
import type { Locator } from '@playwright/test'
import { appBaseUrl } from '../constants.ts'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { expectNoHorizontalOverflow, getVisibleLineCount } from '../helpers.ts'
import { watchlistItems } from './fixtures.ts'

const viewports = [
  {
    name: 'mobile',
    width: 390,
    height: 844
  },
  {
    name: 'tablet',
    width: 768,
    height: 1024
  },
  {
    name: 'desktop',
    width: 1440,
    height: 1024
  }
] as const

async function getWidth(locator: Locator): Promise<number | undefined> {
  const bounds = await locator.boundingBox()

  return bounds?.width
}

async function getTextLineCount(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const range = globalThis.document.createRange()

    range.selectNodeContents(element)

    return range.getClientRects().length
  })
}

test.beforeEach(async ({ context }) => {
  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-long-email-session',
    url: appBaseUrl
  }])
})

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of viewports) {
    test(`${viewport.name} watchlist in ${colorScheme}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.emulateMedia({ colorScheme })
      await page.goto('/watchlist')
      await expect(page.getByRole('listitem')).toHaveCount(watchlistItems.length)
      await page.evaluate(async () => { await globalThis.document.fonts.ready })
      await expect(page.getByAltText('Dune poster')).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await expect(page).toHaveScreenshot(`watchlist-${viewport.name}-${colorScheme}.png`, { fullPage: true })
    })
  }
}

for (const [width, expectedNavigationWidth] of [[320, 320], [639, 639], [640, 80], [1023, 80], [1024, 224]] as const) {
  test(`keeps long titles and cards inside ${width}px`, async ({ page }) => {
    await page.setViewportSize({
      width,
      height: 1024
    })

    await page.goto('/watchlist')
    await expect(page.getByRole('listitem')).toHaveCount(watchlistItems.length)
    await expectNoHorizontalOverflow(page)

    const navigation = page.getByRole('navigation', { name: 'Main navigation' })
    const watchlistLabel = navigation.getByRole('link', { name: 'Watchlist' }).locator('span')
    const longTitle = page.getByRole('heading', { name: watchlistItems[1].title })

    expect(await getWidth(navigation)).toBe(expectedNavigationWidth)
    expect(await getTextLineCount(watchlistLabel)).toBe(1)
    expect(await getVisibleLineCount(longTitle)).toBeLessThanOrEqual(2)
    await expect(longTitle).toBeVisible()
  })
}

test('reflows the watchlist at a 200% zoom-equivalent viewport', async ({ page }) => {
  await page.setViewportSize({
    width: 720,
    height: 512
  })

  await page.goto('/watchlist')
  await expect(page.getByRole('listitem')).toHaveCount(watchlistItems.length)
  await expectNoHorizontalOverflow(page)
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
})
