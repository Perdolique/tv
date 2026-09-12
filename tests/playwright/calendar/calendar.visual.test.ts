/* oxlint-disable vitest/prefer-each -- Playwright uses loops for viewport and color-scheme snapshots. */
import { appBaseUrl } from '../constants.ts'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { expectNoHorizontalOverflow, getVisibleLineCount } from '../helpers.ts'

const FIXED_NOW = new Date('2026-09-12T10:00:00.000Z')

const viewports = [
  {
    height: 844,
    name: 'mobile',
    width: 390
  },
  {
    height: 1024,
    name: 'tablet',
    width: 768
  },
  {
    height: 1024,
    name: 'desktop',
    width: 1440
  }
] as const

test.beforeEach(async ({ context, page }) => {
  await page.clock.setFixedTime(FIXED_NOW)

  await context.addCookies([{
    name: 'tv_session',
    url: appBaseUrl,
    value: 'e2e-long-email-session'
  }])
})

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of viewports) {
    test(`${viewport.name} calendar in ${colorScheme}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.emulateMedia({ colorScheme })
      await page.goto('/calendar?date=2026-09-13')
      await expect(page.getByRole('heading', { name: 'Release calendar' })).toBeVisible()

      await expect(page.getByRole('heading', {
        name: 'Dark',
        exact: true
      })).toHaveCount(2)

      await page.evaluate(async () => { await globalThis.document.fonts.ready })
      await expectNoHorizontalOverflow(page)
      await expect(page).toHaveScreenshot(`calendar-${viewport.name}-${colorScheme}.png`, { fullPage: true })
    })
  }
}

for (const [width, expectedNavigationWidth] of [[320, 320], [639, 639], [640, 80], [1023, 80], [1024, 224]] as const) {
  test(`keeps calendar content inside ${width}px`, async ({ page }) => {
    await page.setViewportSize({
      height: 1024,
      width
    })

    await page.goto('/calendar?date=2026-09-18')
    await expect(page.getByRole('heading', { name: 'Release calendar' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    const navigation = page.getByRole('navigation', { name: 'Main navigation' })
    const longTitle = page.getByRole('heading', { name: /A very long title/u })
    const navigationBounds = await navigation.boundingBox()

    expect(navigationBounds?.width).toBe(expectedNavigationWidth)
    expect(await getVisibleLineCount(longTitle)).toBeLessThanOrEqual(2)
    await expect(longTitle).toBeVisible()
  })
}

for (const width of [320, 390]) {
  test(`keeps dense mobile event cues legible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({
      height: 844,
      width
    })

    await page.goto('/calendar?date=2026-09-13')
    await page.getByRole('button', { name: 'Month' }).click()

    const selectedDay = page.getByRole('group', { name: 'Calendar days' }).locator('button[aria-pressed="true"]')
    const visibleCue = selectedDay.locator('[data-type="episode"]:visible')
    const cueBounds = await visibleCue.boundingBox()

    await expect(visibleCue).toHaveCount(1)
    await expect(selectedDay.getByText('2', { exact: true })).toBeVisible()
    expect(cueBounds?.width).toBeGreaterThanOrEqual(16)
    expect(cueBounds?.height).toBeGreaterThanOrEqual(16)
    await expectNoHorizontalOverflow(page)
  })
}

test('keeps slow and missing posters inside release rows', async ({ page }) => {
  await page.route('**/posters/dune-2021.webp', async (route) => {
    // oxlint-disable-next-line promise/avoid-new -- The placeholder must remain visible during a slow poster response.
    await new Promise(resolve => { globalThis.setTimeout(resolve, 600) })

    await route.continue()
  })

  await page.goto('/calendar?date=2026-09-12')
  await expect(page.getByText('Loading poster…')).toBeVisible()
  await expect(page.getByAltText('Dune poster')).toBeVisible()
  await page.goto('/calendar?date=2026-09-13')
  await expect(page.getByText('No poster available')).toHaveCount(2)
  await expectNoHorizontalOverflow(page)
})

test('keeps calendar usable with reduced motion and forced colors', async ({ page }) => {
  await page.setViewportSize({
    height: 1024,
    width: 768
  })

  await page.emulateMedia({
    forcedColors: 'active',
    reducedMotion: 'reduce'
  })

  await page.goto('/calendar?date=2026-09-12')

  const selected = page.getByRole('group', { name: 'Calendar days' }).locator('button[aria-pressed="true"]')

  await expect(selected).toBeVisible()
  await expect(selected).toContainText('✓')
  await selected.focus()

  const focusIndicator = await selected.evaluate((element) => {
    const styles = globalThis.getComputedStyle(element)

    return {
      offset: styles.outlineOffset,
      width: styles.outlineWidth
    }
  })

  expect(focusIndicator).toStrictEqual({
    offset: '2px',
    width: '2px'
  })

  await expectNoHorizontalOverflow(page)
})

test('reflows the calendar at a 200% zoom-equivalent viewport', async ({ page }) => {
  await page.setViewportSize({
    height: 512,
    width: 720
  })

  await page.goto('/calendar?date=2026-09-13')
  await expect(page.getByRole('heading', { name: 'Release calendar' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})
