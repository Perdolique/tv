/* oxlint-disable vitest/prefer-each -- Playwright uses loops for parameterized viewport tests. */
import type { Locator } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie, expectNoHorizontalOverflow } from '../helpers.ts'
import { waitForHydration } from './helpers.ts'
import { discoveryCollection } from './discovery.fixtures.ts'
import { dune } from './details.fixtures.ts'

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

type Bounds = Awaited<ReturnType<Locator['boundingBox']>>

function expectRankingPlacement(desktop: boolean, recent: Bounds, ranking: Bounds): void {
  expect(recent).not.toBeNull()
  expect(ranking).not.toBeNull()

  if (desktop) { expect(ranking?.x).toBeGreaterThan(recent?.x ?? 0) }
  else { expect(ranking?.y).toBeGreaterThan(recent?.y ?? 0) }
}

for (const colorScheme of ['dark', 'light'] as const) {
  for (const viewport of viewports) {
    test(`${viewport.name} discovery, collections, and editor in ${colorScheme}`, async ({ page, context }, testInfo) => {
      await page.setViewportSize(viewport)

      await page.emulateMedia({
        colorScheme,
        reducedMotion: 'reduce'
      })

      await addCookie(context, 'catalog_discovery', '1')
      await page.goto('/')
      await waitForHydration(page)
      await expect(page.getByRole('heading', { name: 'Recently added' })).toBeVisible()
      await expectNoHorizontalOverflow(page)

      const recent = await page.getByRole('region', {
        name: 'Recently added',
        exact: true
      }).boundingBox()

      const ranking = await page.getByRole('region', {
        name: 'Top rated on TV',
        exact: true
      }).boundingBox()

      expectRankingPlacement(viewport.name === 'desktop', recent, ranking)

      await page.screenshot({
        path: testInfo.outputPath('home.png'),
        fullPage: true
      })

      await page.goto(`/collections/${discoveryCollection.id}`)
      await waitForHydration(page)

      await expect(page.getByRole('heading', {
        name: 'Screen worlds',
        exact: true
      })).toBeVisible()

      await expectNoHorizontalOverflow(page)

      await page.screenshot({
        path: testInfo.outputPath('collection.png'),
        fullPage: true
      })

      await page.goto(`/titles/${dune.id}`)
      await waitForHydration(page)
      await expect(page.getByText('Current title', { exact: true })).toBeVisible()
      await expectNoHorizontalOverflow(page)

      await page.screenshot({
        path: testInfo.outputPath('related.png'),
        fullPage: true
      })

      await addCookie(context, 'tv_session', 'e2e-session')
      await addCookie(context, 'catalog_manager', '1')
      await page.goto(`/manage/collections/${discoveryCollection.id}`)
      await waitForHydration(page)
      await expect(page.getByRole('textbox', { name: 'Collection name' })).toHaveValue('Screen worlds')
      await expect(page.getByRole('button', { name: 'Save and publish' })).toBeVisible()
      await expectNoHorizontalOverflow(page)

      await page.screenshot({
        path: testInfo.outputPath('editor.png'),
        fullPage: true
      })
    })
  }
}
