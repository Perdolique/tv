/* oxlint-disable vitest/prefer-each -- Named viewport and theme scenarios stay explicit in browser reports. */
import { strict as assert } from 'node:assert'
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie, expectNoHorizontalOverflow } from '../helpers.ts'
import { openEpisodes } from './helpers.ts'
import { firstEpisodeId, mockHistory, seriesResponse, titlePath, viewingId, watchedPath } from './timeline.fixtures.ts'

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

async function expectConnectorEndpoints(page: Page): Promise<void> {
  const timeline = page.getByRole('region', { name: 'Your timeline' })
  const lists = await timeline.getByRole('list').all()

  const inspections = lists.map(async list => list.locator(':scope > li').evaluateAll(entries => entries.map(entry => {
      const marker = entry.firstElementChild

      if (marker === null) { throw new Error('Timeline point is missing') }

      const entryBox = entry.getBoundingClientRect()
      const point = marker.getBoundingClientRect()
      const connector = globalThis.getComputedStyle(entry, '::before')
      const topValue = connector.top.replace('px', '')
      const heightValue = connector.height.replace('px', '')
      const topOffset = Number(topValue)
      const top = entryBox.top + topOffset
      const height = Number(heightValue)

      return {
        hasConnector: connector.display !== 'none',
        point: point.top + point.height / 2,
        top,
        bottom: top + height
      }
    })))

  const dayPoints = await Promise.all(inspections)

  for (const points of dayPoints) {
    const first = points.at(0)
    const last = points.at(-1)

    if (first === undefined || last === undefined) { throw new Error('Timeline points are missing') }

    if (points.length === 1) {
      expect(first.hasConnector).toBe(false)
    } else {
      const startDifference = Math.abs(first.top - first.point)
      const endDifference = Math.abs(last.bottom - last.point)

      expect(startDifference).toBeLessThanOrEqual(1)
      expect(endDifference).toBeLessThanOrEqual(1)
    }
  }
}

async function expectTitleActions(page: Page, mode: string): Promise<void> {
  const rate = page.getByRole('button', {
    name: 'Rate',
    exact: true
  })

  const follow = page.getByRole('button', {
    name: 'Follow',
    exact: true
  })

  const rewatch = page.getByRole('button', {
    name: 'Start rewatch',
    exact: true
  })

  await expect(rate).toBeEnabled()
  await expect(follow).toBeEnabled()
  await expect(rewatch).toBeEnabled()

  const boxes = await Promise.all([rate.boundingBox(), follow.boundingBox(), rewatch.boundingBox()])
  const [ratingBox] = boxes

  assert.ok(ratingBox, 'Rating button is missing')

  for (const box of boxes) {
    if (box === null) { throw new Error('Title action is missing') }

    const heightDifference = Math.abs(box.height - ratingBox.height)

    expect(heightDifference).toBeLessThanOrEqual(1)
    expect(box.height).toBeGreaterThanOrEqual(44)

    if (mode === 'desktop') {
      const widthDifference = Math.abs(box.width - ratingBox.width)

      expect(widthDifference).toBeLessThanOrEqual(1)
    }
  }

  await expect(rate.locator('svg path')).toBeVisible()
  await expect(rewatch.locator('svg path').first()).toBeVisible()
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

const viewingStates = {
  mobile: {
    status: 'watching',
    label: 'Watching'
  },

  tablet: {
    status: 'paused',
    label: 'Paused'
  },

  desktop: {
    status: 'completed',
    label: 'Completed'
  }
} as const

for (const colorScheme of ['dark', 'light'] as const) {
  for (const viewport of viewports) {
    test(`timeline matches title references at ${viewport.name} in ${colorScheme}`, async ({ context, page }) => {
      await addCookie(context, 'tv_session', 'e2e-session')
      await page.setViewportSize(viewport)
      await page.emulateMedia({ colorScheme })
      await mockHistory(page)

      const viewingState = viewingStates[viewport.name]
      const state = seriesResponse([firstEpisodeId], viewingId, 1)

      assert.ok(state.currentViewing, 'Current viewing fixture is missing')

      state.currentViewing.status = viewingState.status

      const watchedRoute = `**${watchedPath}`

      await page.route(watchedRoute, async route => { await route.fulfill({ json: state }) })
      await page.goto(titlePath)
      await openEpisodes(page)

      const timeline = page.getByRole('region', { name: 'Your timeline' })

      await expect(timeline.getByRole('heading', { name: 'Your timeline' })).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await expectPlacement(page, viewport.name)
      await expectConnectorEndpoints(page)
      await expectTitleActions(page, viewport.name)

      const title = page.getByRole('heading', {
        name: 'Chernobyl',
        exact: true
      })

      const status = title.locator('..').getByRole('status')

      await expect(status).toHaveText(viewingState.label)
      await expect(status.locator('svg')).toBeVisible()
      await expect(status.locator('svg').locator('path, circle').first()).toBeVisible()
      await expect(page.getByText(/^Current viewing /u)).toHaveCount(0)

      const episodes = page.getByRole('region', {
        name: 'Episodes',
        exact: true
      })

      await expect(episodes.getByRole('region', {
        name: 'Viewer rating for season 1, episode 1',
        exact: true
      }).getByText('Not rated', { exact: true })).toBeVisible()

      await expect(episodes.getByText('Loading…', { exact: true })).toHaveCount(0)

      const screenshotPath = `/tmp/tv-timeline-${colorScheme}-${viewport.name}.png`

      await page.screenshot({
        path: screenshotPath,
        fullPage: true
      })
    })
  }
}

test('keeps count-only history and its connector endpoints inside a 320px viewport', async ({ context, page }) => {
  await addCookie(context, 'tv_session', 'e2e-session')

  await page.setViewportSize({
    width: 320,
    height: 844
  })

  await mockHistory(page)
  await page.goto(titlePath)

  const timeline = page.getByRole('region', { name: 'Your timeline' })

  await expect(timeline.getByText('Watched 25 episodes', { exact: true })).toBeVisible()
  await expectConnectorEndpoints(page)
  await expectNoHorizontalOverflow(page)

  const entries = await timeline.locator(':scope > div > ol > li').all()
  const measurements = entries.map(async entry => entry.boundingBox())
  const boxes = await Promise.all(measurements)

  for (const box of boxes) {
    assert.ok(box, 'History entry is missing')

    const right = box.x + box.width

    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(right).toBeLessThanOrEqual(320)
  }
})
