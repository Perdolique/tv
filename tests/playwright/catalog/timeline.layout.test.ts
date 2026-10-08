/* oxlint-disable vitest/prefer-each -- Named viewport and theme scenarios stay explicit in browser reports. */
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie, expectNoHorizontalOverflow } from '../helpers.ts'
import { openEpisodes } from './helpers.ts'
import { group, mockHistory, timelinePath, titlePath } from './timeline.fixtures.ts'

async function expectPlacement(page: Page, mode: string): Promise<void> {
  const timeline = page.getByRole('region', { name: 'Your timeline' })
  const timelineBox = await timeline.boundingBox()
  const ratingsBox = await page.getByRole('complementary', { name: 'Title ratings' }).boundingBox()
  const seriesBox = await page.getByRole('region', { name: 'Series details' }).boundingBox()

  expect(timelineBox).not.toBeNull()
  expect(ratingsBox).not.toBeNull()
  expect(seriesBox).not.toBeNull()

  if (timelineBox === null || ratingsBox === null || seriesBox === null) { throw new Error('Title layout is missing') }

  if (mode === 'desktop') {
    expect(timelineBox.x).toBeGreaterThan(seriesBox.x + seriesBox.width)
    expect(timelineBox.y).toBeGreaterThan(ratingsBox.y + ratingsBox.height)
  } else {
    expect(timelineBox.y).toBeGreaterThan(seriesBox.y + seriesBox.height)
  }

}

async function expectExpandedGroupWithinViewport(page: Page, title: string, viewportWidth: number): Promise<void> {
  const timeline = page.getByRole('region', { name: 'Your timeline' })
  const toggle = timeline.getByRole('button', { name: 'Hide episodes' })
  const panelId = await toggle.getAttribute('aria-controls')

  if (panelId === null) { throw new Error('Episode group panel is missing') }

  const panelSelector = `[id="${panelId}"]`
  const panel = page.locator(panelSelector)

  await expect(panel.getByText(title, { exact: true })).toBeVisible()

  const panelBox = await panel.boundingBox()
  const titleBox = await panel.getByText(title, { exact: true }).boundingBox()
  const controlBox = await panel.getByRole('button', { name: 'Load more episodes' }).boundingBox()

  expect(panelBox).not.toBeNull()
  expect(titleBox).not.toBeNull()
  expect(controlBox).not.toBeNull()

  if (panelBox === null || titleBox === null || controlBox === null) { throw new Error('Expanded episode group layout is missing') }

  const panelRight = panelBox.x + panelBox.width + 1

  for (const box of [titleBox, controlBox]) {
    const right = box.x + box.width

    expect(box.x).toBeGreaterThanOrEqual(panelBox.x)
    expect(right).toBeLessThanOrEqual(panelRight)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(right).toBeLessThanOrEqual(viewportWidth)
  }
}

test.use({ timezoneId: 'Europe/Tallinn' })

const viewports = [{
  name: 'mobile',
  width: 390,
  height: 844
}, {
  name: 'tablet',
  width: 768,
  height: 1024
}, {
  name: 'desktop',
  width: 1440,
  height: 1024
}] as const

for (const colorScheme of ['dark', 'light'] as const) {
  for (const viewport of viewports) {
    test(`timeline matches title references at ${viewport.name} in ${colorScheme}`, async ({ context, page }) => {
      await addCookie(context, 'tv_session', 'e2e-session')
      await page.setViewportSize(viewport)
      await page.emulateMedia({ colorScheme })
      await mockHistory(page)
      await page.goto(titlePath)
      await openEpisodes(page)

      const timeline = page.getByRole('region', { name: 'Your timeline' })

      await expect(timeline.getByRole('heading', { name: 'Your timeline' })).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await expectPlacement(page, viewport.name)

      const screenshotPath = `/tmp/tv-timeline-${colorScheme}-${viewport.name}.png`

      await page.screenshot({
        path: screenshotPath,
        fullPage: true
      })
    })
  }
}

test('keeps an expanded long episode title and its control inside a 320px viewport', async ({ context, page }) => {
  const longTitle = 'UnbrokenEpisodeTitle'.repeat(30)

  await addCookie(context, 'tv_session', 'e2e-session')

  await page.setViewportSize({
    width: 320,
    height: 844
  })

  await mockHistory(page)

  const episodesRoute = `**${timelinePath}/episodes?*`

  await page.route(episodesRoute, async (route) => {
    await route.fulfill({ json: {
      items: [{
        id: '50000000-0000-7000-8000-000000000100',
        watchId: '60000000-0000-7000-8000-000000000100',
        catalogEpisodeId: '30000000-0000-7000-8000-000000000100',
        seasonNumber: 1,
        episodeNumber: 1,
        sourceTitle: longTitle,
        markedAt: group.occurredAt
      }],

      nextCursor: 'group-next'
    } })
  })

  await page.goto(titlePath)

  const timeline = page.getByRole('region', { name: 'Your timeline' })

  await timeline.getByRole('button', { name: 'View episodes' }).click()
  await expectExpandedGroupWithinViewport(page, longTitle, 320)
  await expectNoHorizontalOverflow(page)
})
