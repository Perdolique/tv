/* oxlint-disable vitest/prefer-each -- Playwright uses loops for parameterized browser scenarios. */
import type { Page } from '@playwright/test'
import { appBaseUrl } from '../constants.ts'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { catalogItems } from './fixtures.ts'
import { dune } from './details.fixtures.ts'
import { waitForHydration } from './helpers.ts'

const dunePath = `/titles/${dune.id}`
const posterPath = '/posters/dune-2021.webp'

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

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth)

  expect(overflow).toBeLessThanOrEqual(0)
}

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of viewports) {
    test(`public title at ${viewport.name} in ${colorScheme}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.emulateMedia({ colorScheme })
      await page.goto(dunePath)
      await expect(page.getByRole('img', { name: 'Dune poster' })).toHaveAttribute('data-loaded', 'true')
      await page.evaluate(async () => { await globalThis.document.fonts.ready })
      await expectNoHorizontalOverflow(page)
      await expect(page).toHaveScreenshot(`details-${viewport.name}-${colorScheme}.png`, { fullPage: true })
    })
  }
}

for (const width of [320, 639, 640, 1023, 1024]) {
  test(`reflows a long title and the authenticated shell at ${width}px`, async ({ context, page }) => {
    await context.addCookies([{
      name: 'tv_session',
      value: 'e2e-long-email-session',
      url: appBaseUrl
    }])

    await page.setViewportSize({
      width,
      height: 1024
    })

    await page.goto(`/titles/${catalogItems[3].id}`)

    await expect(page.getByRole('heading', {
      name: catalogItems[3].title,
      exact: true
    })).toBeVisible()

    await expectNoHorizontalOverflow(page)
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  })
}

test('keeps Russian copy readable at a 200% zoom-equivalent viewport', async ({ page }) => {
  await page.setViewportSize({
    width: 720,
    height: 512
  })

  await page.goto(`${dunePath}?titleLocale=ru`)

  await expect(page.getByRole('heading', {
    name: 'Дюна',
    exact: true
  })).toBeVisible()

  await expectNoHorizontalOverflow(page)
})

test('reserves poster geometry during a slow image load', async ({ page }) => {
  const release = Promise.withResolvers<boolean>()

  await page.route(`**${posterPath}`, async (route) => {
    await release.promise

    await route.continue()
  })

  try {
    await page.goto(dunePath, { waitUntil: 'domcontentloaded' })
    await waitForHydration(page)

    const placeholder = page.getByText('Loading poster…', { exact: true })

    await expect(placeholder).toBeVisible()

    const before = await placeholder.boundingBox()

    release.resolve(true)

    const poster = page.getByRole('img', { name: 'Dune poster' })

    await expect(poster).toHaveAttribute('data-loaded', 'true')

    const after = await poster.boundingBox()

    expect(before?.width).toBe(after?.width)
    expect(before?.height).toBe(after?.height)
    await expect(placeholder).toHaveCount(0)
  } finally {
    release.resolve(true)
  }
})

test.describe('unavailable artwork', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: posterPath,
    status: 404
  }] } })

  test('replaces a broken image with a neutral placeholder without hiding the title', async ({ page }) => {
    await page.route(`**${posterPath}`, async (route) => {
      await route.fulfill({
      status: 404,
      body: ''
    })
    })

    await page.goto(dunePath)
    await expect(page.getByText('No poster available', { exact: true })).toBeVisible()

    await expect(page.getByRole('heading', {
      name: 'Dune',
      exact: true
    })).toBeVisible()

    await expect(page.getByRole('img', { name: 'Dune poster' })).toHaveCount(0)
  })
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`keeps visible keyboard focus with reduced motion in ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({
      colorScheme,
      reducedMotion: 'reduce'
    })

    await page.goto(dunePath)
    await waitForHydration(page)

    const back = page.getByRole('link', {
      name: 'Back to catalog',
      exact: true
    })

    await back.focus()
    await expect(back).toBeFocused()

    const outline = await back.evaluate(element => globalThis.getComputedStyle(element).outlineStyle)

    expect(outline).not.toBe('none')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(`${appBaseUrl}/`)
  })
}
