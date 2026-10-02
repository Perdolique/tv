/* oxlint-disable vitest/prefer-each -- Playwright uses generated tests for viewport variants. */
import type { Locator } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { appBaseUrl } from '../constants.ts'
import { expectNoHorizontalOverflow } from '../helpers.ts'
import { dune } from './details.fixtures.ts'
import { waitForHydration } from './helpers.ts'

const titlePath = `/titles/${dune.id}`

test.beforeEach(async ({ context }) => {
  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])
})

async function readChoiceGeometry(panel: Locator) {
  return panel.getByRole('radio').evaluateAll(inputs => inputs.map(input => {
    const box = input.parentElement?.getBoundingClientRect()

    return {
      width: box?.width ?? 0,
      height: box?.height ?? 0,
      right: box?.right ?? 0
    }
  }))
}

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of [{
    width: 390,
    height: 844
  }, {
    width: 768,
    height: 1024
  }, {
    width: 1440,
    height: 1024
  }]) {
    test(`supports keyboard rating in ${colorScheme} at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport)

      await page.emulateMedia({
        colorScheme,
        reducedMotion: 'reduce'
      })

      await page.goto(titlePath)
      await waitForHydration(page)

      const rate = page.getByRole('button', {
        name: 'Rate',
        exact: true
      })

      const panel = page.getByRole('region', { name: 'Your rating' })

      await expect(rate).toBeEnabled()
      await rate.focus()
      await page.keyboard.press('Enter')

      await expect(panel.getByRole('radio', {
        name: '1 out of 10',
        exact: true
      })).toBeFocused()

      await page.keyboard.press('ArrowRight')

      await expect(panel.getByRole('radio', {
        name: '2 out of 10',
        exact: true
      })).toBeChecked()

      await page.keyboard.press('Tab')
      await expect(panel.getByRole('button', { name: 'Save rating' })).toBeFocused()
      await expectNoHorizontalOverflow(page)

      const boxes = await readChoiceGeometry(panel)

      expect(boxes).toHaveLength(10)

      for (const box of boxes) {
        expect(box.width).toBeGreaterThanOrEqual(44)
        expect(box.height).toBeGreaterThanOrEqual(44)
        expect(box.right).toBeLessThanOrEqual(viewport.width)
      }

      await page.screenshot({
        path: `/tmp/tv-gh-79-${colorScheme}-${viewport.width}.png`,
        fullPage: true
      })

      await page.keyboard.press('Enter')
      await expect(panel.getByText('2 / 10', { exact: true })).toBeVisible()
      await expect(rate).toBeFocused()
    })
  }
}

test('keeps the editor usable at a narrow width and with double-sized text', async ({ page }) => {
  await page.setViewportSize({
    width: 320,
    height: 844
  })

  await page.goto(titlePath)

  await page.getByRole('button', {
    name: 'Rate',
    exact: true
  }).click()

  await expectNoHorizontalOverflow(page)

  await page.setViewportSize({
    width: 768,
    height: 1024
  })

  await page.evaluate(() => { globalThis.document.documentElement.style.fontSize = '200%' })
  await expectNoHorizontalOverflow(page)

  await page.getByRole('radio', {
    name: '10 out of 10',
    exact: true
  }).check()

  await page.getByRole('button', { name: 'Save rating' }).click()
  await expect(page.getByText('10 / 10', { exact: true })).toBeVisible()
})
