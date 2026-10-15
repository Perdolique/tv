/* oxlint-disable vitest/prefer-each -- Named theme and width cases identify layout regressions. */
import { strict as assert } from 'node:assert'
import type { Locator } from '@playwright/test'
import type { CatalogDetailsItem } from '../../../packages/shared/src/catalog.ts'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie, expectNoHorizontalOverflow } from '../helpers.ts'
import { chernobyl } from './details.fixtures.ts'
import { openEpisodes, waitForHydration } from './helpers.ts'

import {
  firstEpisodeId,
  nextViewingId,
  seriesResponse,
  titlePath,
  viewingId,
  watchedPath
} from './timeline.fixtures.ts'

test.use({ expectedHttpErrors: { values: [{
  pathname: titlePath,
  status: 503
}] } })

const seriesDetails = {
  ...chernobyl,
  title: 'American Horror Story',
  originalTitle: 'American Horror Story',
  posterUrl: null
} as const satisfies CatalogDetailsItem

async function expectSingleLine(button: Locator): Promise<void> {
  const geometry = await button.evaluate(element => {
    const text = [...element.childNodes].find(node => {
      const label = node.textContent?.trim() ?? ''

      return node.nodeType === globalThis.Node.TEXT_NODE && label !== ''
    })

    if (text === undefined) {
      throw new Error('The rewatch button has no visible label.')
    }

    const range = globalThis.document.createRange()

    range.selectNodeContents(text)

    const label = range.getBoundingClientRect()
    const box = element.getBoundingClientRect()

    return {
      lines: range.getClientRects().length,
      height: box.height,
      left: label.left - box.left,
      right: box.right - label.right,
      top: label.top - box.top,
      bottom: box.bottom - label.bottom
    }
  })

  expect(geometry.lines).toBe(1)
  expect(geometry.height).toBe(48)
  expect(geometry.left).toBeGreaterThan(0)
  expect(geometry.right).toBeGreaterThan(0)
  expect(geometry.top).toBeGreaterThan(0)
  expect(geometry.bottom).toBeGreaterThan(0)
}

const widths = [320, 390, 683, 768, 860, 876, 1440] as const

async function expectSeparateControls(first: Locator, second: Locator): Promise<void> {
  const [firstBox, secondBox] = await Promise.all([first.boundingBox(), second.boundingBox()])

  assert.ok(firstBox)
  assert.ok(secondBox)

  const separateRows = firstBox.y >= secondBox.y + secondBox.height
  const separateColumns = firstBox.x >= secondBox.x + secondBox.width

  expect(separateRows || separateColumns).toBe(true)
}

for (const colorScheme of ['light', 'dark'] as const) {
  for (const width of widths) {
    test(`keeps whole rewatch labels and controls readable at ${width}px in ${colorScheme}`, async ({ context, page }) => {
      await page.setViewportSize({
        width,
        height: 1024
      })

      await page.emulateMedia({ colorScheme })
      await addCookie(context, 'tv_session', 'e2e-session')

      let state = seriesResponse([firstEpisodeId], viewingId, 1)

      await page.route(url => url.pathname === `/api/catalog/items/${chernobyl.id}`, async route => {
        await route.fulfill({ json: { item: seriesDetails } })
      })

      await page.route(`**${watchedPath}`, async route => { await route.fulfill({ json: state }) })

      await page.route(`**/api/catalog/items/${chernobyl.id}/rewatch`, async route => {
        state = seriesResponse([], nextViewingId, 2)

        await route.fulfill({ json: state })
      })

      await addCookie(context, 'fail_details', '1')
      await page.goto(titlePath)
      await waitForHydration(page)
      await context.clearCookies({ name: 'fail_details' })

      await page.getByRole('button', {
        name: 'Try again',
        exact: true
      }).click()

      await expect(page.getByRole('heading', {
        name: 'American Horror Story',
        exact: true
      })).toBeVisible()

      await openEpisodes(page)

      const viewing = page.getByRole('region', {
        name: 'Current series viewing',
        exact: true
      })

      const start = viewing.getByRole('button', {
        name: 'Start rewatch',
        exact: true
      })

      const follow = page.getByRole('button', {
        name: 'Follow',
        exact: true
      })

      await expect(start).toBeEnabled()
      await page.evaluate(async () => globalThis.document.fonts.ready)
      await expectSingleLine(start)
      await expectSeparateControls(start, follow)
      await expectNoHorizontalOverflow(page)

      await page.screenshot({
        path: `/tmp/tv-gh-89-watched-${colorScheme}-${width}.png`,
        fullPage: true
      })

      await start.click()

      const dialog = page.getByRole('dialog', {
        name: 'Start a rewatch',
        exact: true
      })

      await dialog.getByRole('button', {
        name: 'Start rewatch',
        exact: true
      }).click()

      const cancel = viewing.getByRole('button', {
        name: 'Cancel rewatch',
        exact: true
      })

      await expect(cancel).toBeEnabled()
      await expectSingleLine(cancel)
      await expectNoHorizontalOverflow(page)
    })
  }
}
