/* oxlint-disable vitest/prefer-each -- Playwright uses loops for viewport and theme scenarios. */
import type { Locator } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie, expectNoHorizontalOverflow, getVisibleLineCount } from '../helpers.ts'
import { waitForHydration } from '../catalog/helpers.ts'

async function visibleBounds(locator: Locator) {
  const bounds = await locator.boundingBox()

  if (bounds === null) {
    throw new Error('Expected visible layout content')
  }

  return bounds
}

function expectColumns(history: Awaited<ReturnType<typeof visibleBounds>>, series: Awaited<ReturnType<typeof visibleBounds>>, width: number): void {
  if (width < 640) {
    expect(series.y).toBeGreaterThan(history.y + history.height)
  } else {
    expect(series.x).toBeGreaterThan(history.x + history.width)
    expect(series.width).toBe(width < 1024 ? 240 : 320)
  }
}

function expectNavigationColumns(controlBounds: Awaited<ReturnType<typeof visibleBounds>>[], width: number): void {
  const [firstColumn, secondColumn] = controlBounds

  if (firstColumn === undefined || secondColumn === undefined) {
    throw new Error('Expected navigation columns')
  }

  const columnStep = secondColumn.x - firstColumn.x

  for (const [index, bounds] of controlBounds.entries()) {
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)

    if (width < 640) {
      const columnStart = firstColumn.x + index * columnStep

      expect(columnStep).toBeGreaterThan(0)
      expect(bounds.width).toBeCloseTo(firstColumn.width, 1)
      expect(bounds.x).toBeCloseTo(columnStart, 1)
      expect(bounds.y).toBeCloseTo(firstColumn.y, 1)
    }
  }
}

function sectionLabels(elements: Element[]) {
  const labels = elements.map(element => {
    const label = element.getAttribute('aria-label')
    const heading = element.querySelector('h2')

    return label ?? heading?.textContent
  })

  return labels
}

test.beforeEach(async ({ context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'paginated_viewing', '1')
})

for (const colorScheme of ['light', 'dark'] as const) {
  for (const [name, width, height] of [['mobile', 390, 844], ['tablet', 768, 1024], ['desktop', 1440, 1024]] as const) {
    test(`${name} dashboard in ${colorScheme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({
        width,
        height
      })

      await page.emulateMedia({ colorScheme })
      await page.goto('/dashboard')
      await waitForHydration(page)
      await expectNoHorizontalOverflow(page)

      const history = page.getByRole('region', {
        name: 'Viewing history',
        exact: true
      })

      const series = page.getByRole('region', {
        name: 'By series',
        exact: true
      })

      const rows = page.getByRole('list', {
        name: 'Watched marks',
        exact: true
      }).getByRole('listitem')

      const historyBounds = await visibleBounds(history)
      const seriesBounds = await visibleBounds(series)
      const metrics = page.getByLabel('Viewing summary', { exact: true })
      const metricsBounds = await visibleBounds(metrics)
      const readingOrder = await page.locator('dl, section[aria-labelledby]').evaluateAll(sectionLabels)

      expect(readingOrder).toStrictEqual(['Viewing summary', 'Viewing history', 'By series'])
      expect(historyBounds.y).toBeGreaterThan(metricsBounds.y + metricsBounds.height)
      expect(seriesBounds.y).toBeGreaterThan(metricsBounds.y + metricsBounds.height)
      await expect(rows).toHaveCount(20)
      await expect(rows.first().getByText('No poster available')).toBeVisible()
      expect(await getVisibleLineCount(rows.first().getByRole('heading'))).toBeLessThanOrEqual(2)
      expectColumns(historyBounds, seriesBounds, width)

      const destination = page.getByRole('link', {
        name: 'Dashboard',
        exact: true
      })

      await expect(destination.locator('svg')).toBeVisible()
      await destination.focus()

      const outline = await destination.evaluate(element => globalThis.getComputedStyle(element).outlineStyle)

      expect(outline).not.toBe('none')

      const path = testInfo.outputPath('dashboard.png')

      await page.screenshot({ path })
    })
  }
}

for (const [width, height] of [[320, 1024], [639, 1024], [640, 1024], [1023, 1024], [1024, 1024], [720, 512]] as const) {
  test(`keeps dashboard rows and four navigation items inside ${width}px`, async ({ page }) => {
    await page.setViewportSize({
      width,
      height
    })

    await page.goto('/dashboard')
    await expectNoHorizontalOverflow(page)

    const navigation = page.getByRole('navigation', { name: 'Main navigation' })
    const links = navigation.getByRole('link')

    await expect(links).toHaveCount(4)

    const controls = await links.all()
    const controlBounds = await Promise.all(controls.map(async control => visibleBounds(control)))

    expectNavigationColumns(controlBounds, width)

    const first = page.getByRole('list', {
      name: 'Watched marks',
      exact: true
    }).getByRole('listitem').first()

    const bounds = await first.boundingBox()

    expect(bounds?.width).toBeGreaterThan(0)
    await expect(first.getByRole('heading')).toBeVisible()
  })
}

test('keeps keyboard focus and the current destination visible in forced colors and reduced motion', async ({ page }) => {
  await page.emulateMedia({
    forcedColors: 'active',
    reducedMotion: 'reduce'
  })

  await page.goto('/dashboard')

  const destination = page.getByRole('link', {
    name: 'Dashboard',
    exact: true
  })

  await destination.focus()
  await expect(destination).toHaveAttribute('aria-current', 'page')

  const decoration = await destination.evaluate(element => globalThis.getComputedStyle(element).textDecorationLine)

  expect(decoration).toContain('underline')
  await expectNoHorizontalOverflow(page)
})

for (const [timezoneId, date] of [['America/Los_Angeles', 'Sep 21, 2026'], ['Asia/Tokyo', 'Sep 22, 2026']] as const) {
  test.describe(`dashboard timestamps in ${timezoneId}`, () => {
    test.use({
      timezoneId,
      locale: 'en-US'
    })

    test('shows local mark dates without hydration errors', async ({ page }) => {
      await page.goto('/dashboard')
      await waitForHydration(page)

      const timestamp = page.getByRole('list', {
        name: 'Watched marks',
        exact: true
      }).locator('time').first()

      await expect(timestamp).toContainText(date)
      await expect(timestamp).toHaveAttribute('datetime', '2026-09-22T00:15:00.123Z')
    })
  })
}
