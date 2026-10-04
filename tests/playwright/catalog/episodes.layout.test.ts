/* oxlint-disable vitest/prefer-each -- Named viewport and theme cases stay explicit in browser reports. */
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { expectNoHorizontalOverflow } from '../helpers.ts'
import { appBaseUrl } from '../constants.ts'
import { chernobyl } from './details.fixtures.ts'
import { waitForHydration } from './helpers.ts'

const chernobylPath = `/titles/${chernobyl.id}`

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

interface EpisodeCardGeometry {
  height: number;
  left: number;
  top: number;
  width: number;
}

async function readGeometry(locator: Locator): Promise<EpisodeCardGeometry> {
  return locator.evaluate((element) => {
    const { height, left, top, width } = element.getBoundingClientRect()

    return {
      height,
      left,
      top,
      width
    }
  })
}

async function expectEpisodeLayout(page: Page, expectedColumns: number): Promise<void> {
  await waitForHydration(page)
  await page.evaluate(async () => globalThis.document.fonts.ready)

  const cards = page.getByRole('listitem')

  await expect(cards).toHaveCount(5)

  const first = await readGeometry(cards.nth(0))
  const second = await readGeometry(cards.nth(1))

  if (expectedColumns === 1) {
    expect(Math.abs(first.left - second.left)).toBeLessThanOrEqual(1)
    expect(second.top).toBeGreaterThan(first.top + first.height - 1)
  } else {
    expect(second.left).toBeGreaterThan(first.left + first.width - 1)
    expect(Math.abs(first.top - second.top)).toBeLessThanOrEqual(1)
  }

  const credit = page.getByRole('link', { name: 'Episode data from TVMaze' })

  await credit.scrollIntoViewIfNeeded()
  await expect(credit).toBeVisible()
  await expectNoHorizontalOverflow(page)
}

test('keeps title columns fixed when episode tabs add or remove the scrollbar', async ({ context, page }) => {
  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])

  await page.setViewportSize({
    width: 1440,
    height: 720
  })

  await page.goto(chernobylPath)
  await waitForHydration(page)
  await page.evaluate(async () => globalThis.document.fonts.ready)

  // Use classic scrollbars even when the host normally overlays them.
  await page.addStyleTag({ content: '::-webkit-scrollbar { width: 16px; }' })

  // Wait for the browser to lay out the newly forced classic scrollbars.
  await expect.poll(async () => page.getByRole('main').evaluate(element => (
    element.getBoundingClientRect().right - globalThis.document.documentElement.clientWidth
  ))).toBeLessThanOrEqual(0)

  const heading = page.getByRole('heading', {
    name: 'Chernobyl',
    exact: true
  })

  const ratings = page.getByRole('complementary', { name: 'Title ratings' })

  const reservedScrollbarWidth = await page.getByRole('main').evaluate(element => (
    globalThis.innerWidth - element.getBoundingClientRect().right
  ))

  expect(reservedScrollbarWidth).toBeGreaterThan(0)

  const before = await Promise.all([readGeometry(heading), readGeometry(ratings)])
  const hasInitialScrollbar = await page.evaluate(() => globalThis.document.documentElement.scrollHeight > globalThis.innerHeight)

  expect(hasInitialScrollbar).toBe(true)
  await page.getByRole('tab', { name: 'Overview' }).click()

  const hasOverviewScrollbar = await page.evaluate(() => globalThis.document.documentElement.scrollHeight > globalThis.innerHeight)

  expect(hasOverviewScrollbar).toBe(false)

  const after = await Promise.all([readGeometry(heading), readGeometry(ratings)])

  expect(after[0].left).toBe(before[0].left)
  expect(after[0].width).toBe(before[0].width)
  expect(after[1].left).toBe(before[1].left)
  expect(after[1].width).toBe(before[1].width)
  await page.getByRole('tab', { name: 'Episodes' }).click()

  const hasRestoredScrollbar = await page.evaluate(() => globalThis.document.documentElement.scrollHeight > globalThis.innerHeight)

  expect(hasRestoredScrollbar).toBe(true)

  const restored = await Promise.all([readGeometry(heading), readGeometry(ratings)])

  expect(restored[0].left).toBe(before[0].left)
  expect(restored[0].width).toBe(before[0].width)
  expect(restored[1].left).toBe(before[1].left)
  expect(restored[1].width).toBe(before[1].width)
})

const referenceViewports = [
  {
    height: 844,
    name: 'mobile',
    width: 390,
    columns: 1
  },
  {
    height: 1024,
    name: 'tablet',
    width: 768,
    columns: 2
  },
  {
    height: 1024,
    name: 'desktop',
    width: 1440,
    columns: 2
  }
] as const

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of referenceViewports) {
    test(`episode grid at ${viewport.name} in ${colorScheme}`, async ({ context, page }) => {
      await context.addCookies([{
        name: 'tv_session',
        value: 'e2e-session',
        url: appBaseUrl
      }])

      await page.setViewportSize(viewport)
      await page.emulateMedia({ colorScheme })
      await page.goto(chernobylPath)

      await expect(page.getByRole('button', {
        name: 'Follow',
        exact: true
      })).toBeEnabled()

      await expectEpisodeLayout(page, viewport.columns)

      const episodesTab = page.getByRole('tab', { name: 'Episodes' })

      await episodesTab.focus()

      const outlineStyle = await episodesTab.evaluate(
        element => globalThis.getComputedStyle(element).outlineStyle
      )

      expect(outlineStyle).not.toBe('none')

      const card = page.getByRole('listitem').first()
      const number = card.getByText('Season 1, E1', { exact: true })
      const title = card.getByRole('heading', { name: '1:23:45' })

      const watched = card.getByRole('button', {
        name: 'Watched',
        exact: true
      })

      const [numberBox, titleBox, watchedBox] = await Promise.all([
        readGeometry(number), readGeometry(title), readGeometry(watched)
      ])

      expect(numberBox.left + numberBox.width).toBeLessThan(titleBox.left)
      expect(titleBox.left + titleBox.width).toBeLessThan(watchedBox.left)
      expect(watchedBox.width).toBeGreaterThanOrEqual(44)
      expect(watchedBox.height).toBeGreaterThanOrEqual(44)
      await expect(watched).toHaveAccessibleDescription('1:23:45')
      await watched.click()
      await expect(watched).toHaveAttribute('aria-pressed', 'true')
      await expect(watched.locator('svg')).toBeVisible()
    })
  }
}

const boundaryViewports = [
  {
    height: 844,
    name: 'narrow 320px',
    width: 320,
    columns: 1
  },
  {
    height: 900,
    name: 'below tablet breakpoint',
    width: 639,
    columns: 1
  },
  {
    height: 900,
    name: 'at tablet breakpoint',
    width: 640,

    // The classic scrollbar leaves too little space for two readable episode cards.
    columns: 1
  },
  {
    height: 900,
    name: 'above tablet breakpoint with scrollbar space',
    width: 656,
    columns: 2
  },
  {
    height: 900,
    name: 'below desktop breakpoint',
    width: 1023,
    columns: 2
  },
  {
    height: 900,
    name: 'at desktop breakpoint',
    width: 1024,
    columns: 2
  }
] as const

for (const viewport of boundaryViewports) {
  test(`episode layout has no overflow at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto(chernobylPath)
    await expectEpisodeLayout(page, viewport.columns)
  })
}
