/* oxlint-disable vitest/prefer-each -- Playwright names each theme and viewport explicitly. */
import { expect, test } from '../fixtures/global.fixtures.ts'
import { appBaseUrl } from '../constants.ts'
import { expectNoHorizontalOverflow } from '../helpers.ts'
import { episodeEdgeSeries } from './details.fixtures.ts'
import { waitForHydration } from './helpers.ts'

const titlePath = `/titles/${episodeEdgeSeries.id}`

for (const colorScheme of ['light', 'dark'] as const) {
  for (const width of [390, 768, 1440]) {
    test(`shows season ratings and keyboard controls in ${colorScheme} at ${width}px`, async ({ context, page }) => {
      await context.addCookies([{
        name: 'tv_session',
        value: 'e2e-session',
        url: appBaseUrl
      }])

      await page.setViewportSize({
        width,
        height: 1024
      })

      await page.emulateMedia({
        colorScheme,
        reducedMotion: 'reduce'
      })

      await page.goto(titlePath)
      await waitForHydration(page)

      const season = page.getByRole('region', {
        name: 'Season 2 ratings',
        exact: true
      })

      const rate = season.getByRole('button', {
        name: 'Rate season 2',
        exact: true
      })

      const viewer = season.getByRole('region', {
        name: 'Season 2 viewer rating',
        exact: true
      })

      await expect(rate).toBeEnabled()
      await expect(viewer.getByText('Not rated', { exact: true })).toBeVisible()
      await expect(season.getByText('Your season rating', { exact: true })).toBeVisible()
      await season.scrollIntoViewIfNeeded()
      await expectNoHorizontalOverflow(page)

      const boxes = await season.locator(':scope > *').evaluateAll(elements => {
        const rectangles = elements.map(element => {
          const box = element.getBoundingClientRect()

          return {
            left: box.left,
            right: box.right,
            width: box.width
          }
        })

        return rectangles
      })

      for (const box of boxes) {
        expect(box.left).toBeGreaterThanOrEqual(0)
        expect(box.right).toBeLessThanOrEqual(width)
        expect(box.width).toBeGreaterThan(0)
      }

      await rate.focus()
      await page.keyboard.press('Enter')

      const editor = season.getByRole('dialog', {
        name: 'Your rating for season 2',
        exact: true
      })

      const firstChoice = editor.getByRole('button', {
        name: '1 out of 10',
        exact: true
      })

      await expect(firstChoice).toBeFocused()
      await page.keyboard.press('Tab')

      await expect(editor.getByRole('button', {
        name: '2 out of 10',
        exact: true
      })).toBeFocused()

      await page.keyboard.press('Escape')
      await expect(editor).toHaveCount(0)
      await expect(rate).toBeFocused()
    })
  }
}

test('keeps season controls usable at 320px with double-sized text', async ({ context, page }) => {
  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])

  await page.setViewportSize({
    width: 320,
    height: 844
  })

  await page.goto(titlePath)
  await waitForHydration(page)
  await page.evaluate(() => { globalThis.document.documentElement.style.fontSize = '200%' })

  const season = page.getByRole('region', {
    name: 'Season 2 ratings',
    exact: true
  })

  await season.getByRole('button', {
    name: 'Rate season 2',
    exact: true
  }).click()

  await expectNoHorizontalOverflow(page)

  const editor = season.getByRole('dialog', {
    name: 'Your rating for season 2',
    exact: true
  })

  const boxes = await editor.getByRole('button').evaluateAll(buttons => {
    const rectangles = buttons.map(button => {
      const box = button.getBoundingClientRect()

      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom
      }
    })

    return rectangles
  })

  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.right).toBeLessThanOrEqual(320)
    expect(box.top).toBeGreaterThanOrEqual(0)
    expect(box.bottom).toBeLessThanOrEqual(844)
  }

  await editor.getByRole('button', {
    name: '10 out of 10',
    exact: true
  }).click()

  await expect(season.getByRole('button', {
    name: 'Rate season 2, your rating: 10 out of 10',
    exact: true
  })).toBeFocused()
})
