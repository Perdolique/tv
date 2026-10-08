/* oxlint-disable vitest/prefer-each -- Named viewport and theme cases stay explicit in browser reports. */
import { strict as assert } from 'node:assert'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { expectNoHorizontalOverflow } from '../helpers.ts'
import { appBaseUrl } from '../constants.ts'
import { chernobyl } from './details.fixtures.ts'
import { openEpisodes, waitForHydration } from './helpers.ts'

const chernobylPath = `/titles/${chernobyl.id}`

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

interface EpisodeRowGeometry {
  height: number;
  left: number;
  top: number;
  width: number;
}

async function readGeometry(locator: Locator): Promise<EpisodeRowGeometry> {
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

async function expectEpisodeLayout(page: Page, inlineControls: boolean): Promise<void> {
  await openEpisodes(page)
  await page.evaluate(async () => globalThis.document.fonts.ready)

  const cards = page.getByRole('listitem')

  await expect(cards).toHaveCount(5)

  const list = page.getByRole('region', {
    name: 'Episodes',
    exact: true
  }).getByRole('list')

  const listBox = await readGeometry(list)
  const first = await readGeometry(cards.nth(0))
  const second = await readGeometry(cards.nth(1))
  const widthDifference = Math.abs(first.width - listBox.width)
  const leftDifference = Math.abs(first.left - second.left)

  expect(widthDifference).toBeLessThanOrEqual(2)
  expect(leftDifference).toBeLessThanOrEqual(1)
  expect(second.top).toBeGreaterThanOrEqual(first.top + first.height - 1)

  if (inlineControls) {
    const heading = cards.nth(0).getByRole('heading', { name: '1:23:45' })

    const ratings = cards.nth(0).getByRole('region', {
      name: 'Ratings for season 1, episode 1',
      exact: true
    })

    const watched = cards.nth(0).getByRole('button', {
      name: 'Watched',
      exact: true
    })

    const [headingBox, ratingsBox, watchedBox] = await Promise.all([
      readGeometry(heading), readGeometry(ratings), readGeometry(watched)
    ])

    expect(first.height).toBeLessThanOrEqual(88)
    expect(headingBox.left + headingBox.width).toBeLessThan(ratingsBox.left)
    expect(ratingsBox.left + ratingsBox.width).toBeLessThan(watchedBox.left)
    expect(watchedBox.top).toBeLessThan(headingBox.top + headingBox.height)
  }

  const credit = page.getByRole('link', { name: 'Episode data from TVMaze' })

  await credit.scrollIntoViewIfNeeded()
  await expect(credit).toBeVisible()
  await expectNoHorizontalOverflow(page)
}

async function fitViewportBetweenTabs(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Overview' }).click()

  const timeline = page.getByRole('region', { name: 'Your timeline' })

  await expect(timeline.getByText('Your activity for this title will appear here.', { exact: true })).toBeVisible()

  const overviewHeight = await page.evaluate(() => globalThis.document.documentElement.scrollHeight)

  await openEpisodes(page)

  await expect(page.getByRole('button', {
    name: 'Mark all released episodes',
    exact: true
  })).toBeVisible()

  await expect(page.getByRole('region', {
    name: 'Episodes',
    exact: true
  }).getByRole('listitem')).toHaveCount(5)

  const episodesHeight = await page.evaluate(() => globalThis.document.documentElement.scrollHeight)

  expect(episodesHeight).toBeGreaterThan(overviewHeight)

  const midpoint = (overviewHeight + episodesHeight) / 2
  const height = Math.floor(midpoint)

  await page.setViewportSize({
    width: 1440,
    height
  })
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
  await openEpisodes(page)
  await page.evaluate(async () => globalThis.document.fonts.ready)

  // Use classic scrollbars even when the host normally overlays them.
  await page.addStyleTag({ content: '::-webkit-scrollbar { width: 16px; }' })

  // Wait for the browser to lay out the newly forced classic scrollbars.
  await expect.poll(async () => page.getByRole('main').evaluate(element => (
    element.getBoundingClientRect().right - globalThis.document.documentElement.clientWidth
  ))).toBeLessThanOrEqual(0)

  await fitViewportBetweenTabs(page)

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

  await expect.poll(async () => page.evaluate(() => globalThis.document.documentElement.scrollHeight > globalThis.innerHeight)).toBe(true)
  await page.getByRole('tab', { name: 'Overview' }).click()
  await expect.poll(async () => page.evaluate(() => globalThis.document.documentElement.scrollHeight > globalThis.innerHeight)).toBe(false)

  const after = await Promise.all([readGeometry(heading), readGeometry(ratings)])

  expect(after[0].left).toBe(before[0].left)
  expect(after[0].width).toBe(before[0].width)
  expect(after[1].left).toBe(before[1].left)
  expect(after[1].width).toBe(before[1].width)
  await page.getByRole('tab', { name: 'Episodes' }).click()
  await expect.poll(async () => page.evaluate(() => globalThis.document.documentElement.scrollHeight > globalThis.innerHeight)).toBe(true)

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
    inlineControls: false
  },
  {
    height: 1024,
    name: 'tablet',
    width: 768,
    inlineControls: true
  },
  {
    height: 1024,
    name: 'desktop',
    width: 1440,
    inlineControls: true
  }
] as const

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of referenceViewports) {
    test(`episode list at ${viewport.name} in ${colorScheme}`, async ({ context, page }) => {
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

      await expectEpisodeLayout(page, viewport.inlineControls)

      const episodesTab = page.getByRole('tab', { name: 'Episodes' })

      await episodesTab.focus()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Shift+Tab')
      await expect(episodesTab).toBeFocused()

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
    width: 320
  },
  {
    height: 900,
    name: 'below tablet breakpoint',
    width: 639
  },
  {
    height: 900,
    name: 'at tablet breakpoint',
    width: 640
  },
  {
    height: 900,
    name: 'above tablet breakpoint with scrollbar space',
    width: 656
  },
  {
    height: 900,
    name: 'below desktop breakpoint',
    width: 1023
  },
  {
    height: 900,
    name: 'at desktop breakpoint',
    width: 1024
  }
] as const

for (const viewport of boundaryViewports) {
  test(`episode layout has no overflow at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto(chernobylPath)
    await expectEpisodeLayout(page, false)
  })
}

test('opens Overview by default and supports the complete keyboard tab pattern', async ({ page }) => {
  await page.goto(chernobylPath)
  await waitForHydration(page)

  const episodesTab = page.getByRole('tab', { name: 'Episodes' })
  const overviewTab = page.getByRole('tab', { name: 'Overview' })

  const episodesPanel = page.getByRole('tabpanel', {
    name: 'Episodes',
    includeHidden: true
  })

  const overviewPanel = page.getByRole('tabpanel', {
    name: 'Overview',
    includeHidden: true
  })

  await expect(page.getByRole('tab')).toHaveText(['Overview', 'Episodes'])
  await expect(page.getByRole('tabpanel', { includeHidden: true })).toHaveCount(2)

  const episodesPanelId = await episodesTab.getAttribute('aria-controls')
  const overviewPanelId = await overviewTab.getAttribute('aria-controls')

  assert.ok(episodesPanelId !== null, 'The Episodes tab must reference its panel')
  assert.ok(overviewPanelId !== null, 'The Overview tab must reference its panel')
  await expect(episodesPanel).toHaveAttribute('id', episodesPanelId)
  await expect(overviewPanel).toHaveAttribute('id', overviewPanelId)
  await expect(overviewTab).toHaveAttribute('aria-selected', 'true')
  await expect(overviewTab).toHaveAttribute('tabindex', '0')
  await expect(episodesTab).toHaveAttribute('tabindex', '-1')
  await expect(episodesPanel).toBeHidden()
  await expect(overviewPanel).toBeVisible()
  await overviewTab.focus()
  await page.keyboard.press('ArrowRight')
  await expect(episodesTab).toBeFocused()
  await expect(episodesTab).toHaveAttribute('aria-selected', 'true')
  await expect(episodesPanel).toBeVisible()
  await expect(overviewPanel).toBeHidden()
  await page.keyboard.press('ArrowRight')
  await expect(overviewTab).toBeFocused()
  await expect(overviewTab).toHaveAttribute('aria-selected', 'true')
  await expect(episodesPanel).toBeHidden()
  await expect(overviewPanel).toBeVisible()
  await expect(page.getByText(chernobyl.description, { exact: true })).toBeVisible()
  await page.keyboard.press('Home')
  await expect(overviewTab).toBeFocused()
  await page.keyboard.press('End')
  await expect(episodesTab).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(overviewTab).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(episodesTab).toBeFocused()

  await expect(page.getByRole('heading', {
    name: 'Season 1',
    exact: true
  })).toBeVisible()

  await page.reload()
  await waitForHydration(page)
  await expect(overviewTab).toHaveAttribute('aria-selected', 'true')
  await expect(overviewPanel).toBeVisible()
  await expect(episodesPanel).toBeHidden()
})
