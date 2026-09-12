/* oxlint-disable vitest/prefer-each -- Playwright uses loops for parameterized tests. */
import type { Locator, Page } from '@playwright/test'
import { appBaseUrl } from '../constants.ts'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { waitForHydration } from './helpers.ts'

type ElementBounds = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>

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

  const inputBounds = await page.getByRole('textbox').boundingBox()

  expect(inputBounds?.width).toBeGreaterThan(0)
}

async function getVisibleBounds(locator: Locator): Promise<ElementBounds> {
  const bounds = await locator.boundingBox()

  if (bounds === null) {
    throw new Error('Expected a visible navigation control')
  }

  return bounds
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
    test(`${viewport.name} catalog in ${colorScheme}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.emulateMedia({ colorScheme })
      await page.goto('/?query=a')
      await expect(page.getByRole('listitem')).toHaveCount(4)
      await page.evaluate(async () => { await globalThis.document.fonts.ready })
      await expectNoHorizontalOverflow(page)
      await expect(page).toHaveScreenshot(`catalog-${viewport.name}-${colorScheme}.png`, { fullPage: true })
    })
  }
}

for (const [width, expectedWidth] of [[320, 320], [639, 639], [640, 80], [1023, 80], [1024, 224]] as const) {
  test(`reflows long titles and email at ${width}px`, async ({ page }) => {
    await page.setViewportSize({
      width,
      height: 1024
    })

    await page.goto('/?query=a')
    await expect(page.getByRole('listitem')).toHaveCount(4)
    await expectNoHorizontalOverflow(page)

    const navigation = page.getByRole('navigation', { name: 'Main navigation' })
    const bounds = await navigation.boundingBox()

    expect(bounds?.width).toBe(expectedWidth)

    await expect(page.getByRole('link', {
      name: 'Catalog',
      exact: true
    })).toHaveAttribute('aria-current', 'page')

    await expect(page.getByRole('link', {
      name: 'Catalog',
      exact: true
    })).toHaveAttribute('href', '/')

    await expect(page.getByRole('link', {
      name: 'Watchlist',
      exact: true
    })).not.toHaveAttribute('aria-current')
  })
}

test('supports keyboard search and clear with visible focus and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await waitForHydration(page)

  const signOutButton = page.getByRole('button', { name: 'Sign out' })

  const catalogLink = page.getByRole('link', {
    name: 'Catalog',
    exact: true
  })

  const watchlistLink = page.getByRole('link', {
    name: 'Watchlist',
    exact: true
  })

  await expect(page.getByRole('banner')).toBeVisible()
  await expect(page.getByRole('main').getByRole('navigation')).toHaveCount(0)

  const signOutBounds = await getVisibleBounds(signOutButton)
  const catalogBounds = await getVisibleBounds(catalogLink)
  const signOutBottom = signOutBounds.y + signOutBounds.height

  expect(signOutBottom).toBeLessThan(catalogBounds.y)
  await signOutButton.focus()
  await page.keyboard.press('Tab')
  await expect(catalogLink).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(watchlistLink).toBeFocused()
  await page.keyboard.press('Tab')

  const input = page.getByRole('textbox')

  await expect(input).toBeFocused()

  const outline = await input.evaluate(element => globalThis.getComputedStyle(element).outlineStyle)

  expect(outline).not.toBe('none')
  await page.keyboard.type('Dark')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('listitem')).toHaveCount(2)
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Clear search' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('')
  await expectNoHorizontalOverflow(page)
})

test('keeps mobile keyboard order aligned with the bottom navigation', async ({ page }) => {
  await page.setViewportSize({
    width: 390,
    height: 844
  })

  await page.goto('/')
  await waitForHydration(page)
  await page.getByRole('button', { name: 'Sign out' }).focus()
  await page.keyboard.press('Tab')

  const input = page.getByRole('textbox')

  await expect(input).toBeFocused()
  await page.keyboard.press('Tab')

  await expect(page.getByRole('link', {
    name: 'Catalog',
    exact: true
  })).toBeFocused()

  await page.keyboard.press('Tab')

  await expect(page.getByRole('link', {
    name: 'Watchlist',
    exact: true
  })).toBeFocused()
})

test('reflows at a 200% zoom-equivalent viewport', async ({ page }) => {
  await page.setViewportSize({
    width: 720,
    height: 512
  })

  await page.goto('/?query=a')
  await expect(page.getByRole('listitem')).toHaveCount(4)
  await expectNoHorizontalOverflow(page)
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
})
