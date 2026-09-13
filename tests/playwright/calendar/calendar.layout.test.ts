/* oxlint-disable vitest/prefer-each -- Playwright uses loops for viewport and color-scheme checks. */
import type { Locator } from '@playwright/test'
import { appBaseUrl } from '../constants.ts'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { expectNoHorizontalOverflow, getVisibleLineCount } from '../helpers.ts'

const FIXED_NOW = new Date('2026-09-12T10:00:00.000Z')

test.use({
  locale: 'en-US',
  timezoneId: 'UTC'
})

async function getVisibleBounds(locator: Locator): Promise<NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>> {
  const bounds = await locator.boundingBox()

  if (bounds === null) {
    throw new Error('Expected a visible calendar element')
  }

  return bounds
}

async function expectReleaseSummaryInsideDay(day: Locator): Promise<void> {
  const dayBounds = await day.evaluate((element) => {
    const bounds = element.getBoundingClientRect()

    return {
      left: bounds.left,
      right: bounds.right
    }
  })

  const releaseSummary = day.locator('[data-release-summary]')

  await expect(releaseSummary).toHaveCount(1)

  const summaryBounds = await releaseSummary.evaluate((element) => {
    const bounds = element.getBoundingClientRect()

    return {
      left: bounds.left,
      right: bounds.right
    }
  })

  expect(summaryBounds.left).toBeGreaterThanOrEqual(dayBounds.left)
  expect(summaryBounds.right).toBeLessThanOrEqual(dayBounds.right)
}

const viewports = [
  {
    calendarDisplay: 'none',
    height: 844,
    name: 'mobile',
    weekDisplay: 'grid',
    width: 390
  },
  {
    calendarDisplay: 'grid',
    height: 1024,
    name: 'tablet',
    weekDisplay: 'none',
    width: 768
  },
  {
    calendarDisplay: 'grid',
    height: 1024,
    name: 'desktop',
    weekDisplay: 'none',
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

      await expectNoHorizontalOverflow(page)

      await expect(page.getByRole('group', {
        name: 'Selected week',
        includeHidden: true
      })).toHaveCSS('display', viewport.weekDisplay)

      await expect(page.getByRole('grid', {
        name: 'Calendar days',
        includeHidden: true
      }).locator('xpath=..')).toHaveCSS('display', viewport.calendarDisplay)
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

    await page.getByRole('button', {
      name: 'Month',
      exact: true
    }).click()

    const selectedDay = page.getByRole('grid', { name: 'Calendar days' }).locator('button[aria-pressed="true"]')
    const visibleCue = selectedDay.locator('[data-type="episode"]:visible')
    const cueBounds = await visibleCue.boundingBox()

    await expect(visibleCue).toHaveCount(1)
    await expect(selectedDay.getByText('2', { exact: true })).toBeVisible()
    expect(cueBounds?.width).toBeGreaterThanOrEqual(16)
    expect(cueBounds?.height).toBeGreaterThanOrEqual(16)
    await expectNoHorizontalOverflow(page)
  })
}

test('shows the selected release agenda below mobile Month', async ({ page }) => {
  await page.setViewportSize({
    height: 844,
    width: 390
  })

  await page.goto('/calendar?date=2026-09-12')

  await page.getByRole('button', {
    name: 'Month',
    exact: true
  }).click()

  await page.getByRole('button', { name: /Sunday, September 13, 2026.*2 releases/u }).click()

  const calendarBounds = await getVisibleBounds(page.getByRole('grid', { name: 'Calendar days' }))
  const agendaBounds = await getVisibleBounds(page.getByRole('list', { name: 'Releases for selected day' }))

  expect(agendaBounds.y).toBeGreaterThanOrEqual(calendarBounds.y + calendarBounds.height)
})

test('keeps slow and missing posters inside release rows', async ({ page }) => {
  await page.context().addCookies([{
    name: 'tv_session',
    url: appBaseUrl,
    value: 'e2e-session'
  }])

  await page.route('**/posters/dune-2021.webp', async (route) => {
    // oxlint-disable-next-line promise/avoid-new -- The placeholder must remain visible during a slow poster response.
    await new Promise(resolve => { globalThis.setTimeout(resolve, 600) })

    await route.continue()
  })

  await page.goto('/calendar?date=2026-09-12')
  await expect(page.getByText('Loading poster…')).toBeVisible()
  await expect(page.getByAltText('Dune poster')).toHaveAttribute('loading', 'lazy')
  await expect(page.getByAltText('Dune poster')).toBeVisible()
  await page.goto('/calendar?date=2026-09-13')
  await expect(page.getByText('No poster available')).toHaveCount(2)
  await expectNoHorizontalOverflow(page)
})

test('keeps narrow desktop dates, release cues, and navigation icons aligned', async ({ page }) => {
  await page.setViewportSize({
    height: 768,
    width: 1024
  })

  await page.goto('/calendar?date=2026-09-13')

  const calendarDays = page.getByRole('grid', { name: 'Calendar days' })
  const today = calendarDays.locator('button[aria-current="date"]')
  const todayNumber = today.getByText('12', { exact: true })
  const todayText = today.getByText('Today', { exact: true })
  const nextMonth = page.getByRole('button', { name: 'Next month' })
  const nextIcon = nextMonth.locator('svg')

  await expect(nextIcon).toHaveCount(1)

  const buttonMiddle = await nextMonth.evaluate((element) => {
    const bounds = element.getBoundingClientRect()

    return bounds.y + bounds.height / 2
  })

  const iconMiddle = await nextIcon.evaluate((element) => {
    const bounds = element.getBoundingClientRect()

    return bounds.y + bounds.height / 2
  })

  expect(await getVisibleLineCount(todayNumber)).toBe(1)
  await expect(todayText).toBeHidden()
  await expect(todayNumber).toHaveCSS('text-decoration-line', 'underline')
  await expect(nextMonth).toHaveCSS('align-items', 'center')
  expect(Math.abs(buttonMiddle - iconMiddle)).toBeLessThanOrEqual(1)
  await nextMonth.click()

  const busyDay = calendarDays.getByRole('button', {
    name: /Thursday, October 1, 2026.*3 releases/u
  })

  await busyDay.click()
  await expectReleaseSummaryInsideDay(busyDay)
  await expect(busyDay.locator('[data-type]:visible')).toHaveCount(1)
  await expect(busyDay.getByText('American Horror Story', { exact: true })).toBeHidden()

  await page.setViewportSize({
    height: 768,
    width: 1280
  })

  await expect(busyDay.locator('[data-type]:visible')).toHaveCount(2)
  await expect(busyDay.getByText('American Horror Story', { exact: true })).toBeVisible()
  await expectReleaseSummaryInsideDay(busyDay)
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

  const selected = page.getByRole('grid', { name: 'Calendar days' }).locator('button[aria-pressed="true"]')

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
