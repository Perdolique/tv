/* oxlint-disable vitest/prefer-each -- Playwright uses generated tests for viewport variants. */
import type { Locator, Page } from '@playwright/test'
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
  const geometry = await panel.getByRole('button', { name: /^\d+ out of 10$/u }).evaluateAll(buttons => {
    const choices = buttons.map(choice => {
      const label = choice.querySelector<HTMLElement>('span[aria-hidden="true"]')

      if (label === null) {
        throw new Error('Rating choices need visible numeric labels.')
      }

      const box = choice.getBoundingClientRect()
      const labelBox = label.getBoundingClientRect()
      const labelStyle = globalThis.getComputedStyle(label)

      return {
        width: box.width,
        height: box.height,
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        text: label.textContent,
        labelWidth: labelBox.width,
        labelHeight: labelBox.height,
        labelLeft: labelBox.left,
        labelTop: labelBox.top,
        labelRight: labelBox.right,
        labelBottom: labelBox.bottom,
        clipPath: labelStyle.clipPath,
        opacity: labelStyle.opacity,
        visibility: labelStyle.visibility
      }
    })

    return choices
  })

  return geometry
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
    const activationKey = viewport.width === 768 ? 'Space' : 'Enter'

    test(`supports keyboard rating in ${colorScheme} at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport)

      await page.emulateMedia({
        colorScheme,
        reducedMotion: 'reduce'
      })

      await page.goto(titlePath)
      await waitForHydration(page)

      const rate = page.getByRole('button', { name: /^(?:Rate|Rate, your rating: \d+ out of 10)$/u })
      const panel = page.getByRole('region', { name: 'Your rating' })

      await expect(rate).toBeEnabled()
      await rate.focus()
      await page.keyboard.press('Enter')

      await expect(panel.getByRole('button', {
        name: '1 out of 10',
        exact: true
      })).toBeFocused()

      await page.keyboard.press('Tab')

      const chosenScore = panel.getByRole('button', {
        name: '2 out of 10',
        exact: true
      })

      await expect(chosenScore).toBeFocused()
      await expect(chosenScore).toHaveAttribute('aria-pressed', 'false')

      await expect(panel.getByRole('button', {
        name: 'Rate',
        exact: true
      })).toBeVisible()

      await expectNoHorizontalOverflow(page)

      const boxes = await readChoiceGeometry(panel)

      expect(boxes).toHaveLength(10)

      const indexedChoices = boxes.entries()

      for (const [index, box] of indexedChoices) {
        expect(box.width).toBeGreaterThanOrEqual(44)
        expect(box.height).toBeGreaterThanOrEqual(44)
        expect(box.left).toBeGreaterThanOrEqual(0)
        expect(box.top).toBeGreaterThanOrEqual(0)
        expect(box.right).toBeLessThanOrEqual(viewport.width)
        expect(box.bottom).toBeLessThanOrEqual(viewport.height)

        const rowIndex = Math.floor(index / 5) * 5

        expect(box.top).toBe(boxes[rowIndex]?.top)

        const expectedLabel = String(index + 1)

        expect(box.text).toBe(expectedLabel)
        expect(box.labelWidth).toBeGreaterThan(0)
        expect(box.labelHeight).toBeGreaterThan(0)
        expect(box.labelLeft).toBeGreaterThanOrEqual(box.left)
        expect(box.labelTop).toBeGreaterThanOrEqual(box.top)
        expect(box.labelRight).toBeLessThanOrEqual(box.right)
        expect(box.labelBottom).toBeLessThanOrEqual(box.bottom)
        expect(box.clipPath).toBe('none')
        expect(box.opacity).toBe('1')
        expect(box.visibility).toBe('visible')
      }

      await page.keyboard.press(activationKey)

      await expect(panel.getByRole('button', {
        name: 'Rate, your rating: 2 out of 10',
        exact: true
      })).toHaveText('Rate')

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
  await page.evaluate(() => { globalThis.document.documentElement.style.fontSize = '200%' })
  await expectNoHorizontalOverflow(page)

  const boxes = await readChoiceGeometry(page.getByRole('dialog', { name: 'Your rating' }))

  expect(boxes).toHaveLength(10)

  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.right).toBeLessThanOrEqual(320)
    expect(box.labelRight).toBeLessThanOrEqual(box.right)
    expect(box.labelBottom).toBeLessThanOrEqual(box.bottom)
  }

  await page.getByRole('button', {
    name: '10 out of 10',
    exact: true
  }).click()

  await expect(page.getByRole('button', {
    name: 'Rate, your rating: 10 out of 10',
    exact: true
  })).toHaveText('Rate')
})

function observeRatingReads(page: Page): () => number {
  let ratingReads = 0
  const ratingPath = `/api/catalog/items/${dune.id}/rating`

  page.on('request', request => {
    const url = request.url()
    const isRatingRead = request.method() === 'GET' && url.endsWith(ratingPath)

    if (isRatingRead) {
      ratingReads += 1
    }
  })

  return () => ratingReads
}

test('keeps one rating action and preserves the picker across the mobile breakpoint', async ({ page }) => {
  await page.setViewportSize({
    width: 639,
    height: 844
  })

  const ratingReads = observeRatingReads(page)

  await page.goto(titlePath)

  const rate = page.getByRole('button', { name: /^(?:Rate|Rate, your rating: \d+ out of 10)$/u })
  const picker = page.getByRole('dialog', { name: 'Your rating' })

  await test.step('open the mobile sheet and wrap keyboard focus', async () => {
    await expect(rate).toHaveCount(1)
    await rate.click()
    await expect(picker).toHaveJSProperty('tagName', 'DIALOG')
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden')

    await page.getByRole('button', {
      name: '10 out of 10',
      exact: true
    }).focus()

    await page.keyboard.press('Tab')
    await expect(picker.getByRole('button', { name: 'Close rating' })).toBeFocused()
    await page.keyboard.press('Shift+Tab')

    await expect(picker.getByRole('button', {
      name: '10 out of 10',
      exact: true
    })).toBeFocused()
  })

  await test.step('dismiss with Escape and the backdrop', async () => {
    await page.keyboard.press('Escape')
    await expect(picker).toHaveCount(0)
    await expect(rate).toBeFocused()
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden')
    await rate.click()
    await page.mouse.click(8, 8)
    await expect(picker).toHaveCount(0)
    await expect(rate).toBeFocused()
    await rate.click()
  })

  await test.step('switch to a popover and save a score', async () => {
    await page.setViewportSize({
      width: 640,
      height: 844
    })

    await expect(picker).toHaveJSProperty('tagName', 'DIV')
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden')

    await expect(picker.getByRole('button', {
      name: '1 out of 10',
      exact: true
    })).toBeFocused()

    await picker.getByRole('button', {
      name: '7 out of 10',
      exact: true
    }).click()

    await expect(rate).toHaveAccessibleName('Rate, your rating: 7 out of 10')
    await expect(page.getByRole('region', { name: 'Personal score' })).toContainText('7 out of 10')
    await rate.click()
  })

  await test.step('preserve the selected score across both presentations', async () => {
    await page.setViewportSize({
      width: 639,
      height: 844
    })

    await expect(picker).toHaveJSProperty('tagName', 'DIALOG')

    await expect(picker.getByRole('button', {
      name: '7 out of 10',
      exact: true
    })).toBeFocused()

    await page.setViewportSize({
      width: 640,
      height: 844
    })

    await expect(picker).toHaveJSProperty('tagName', 'DIV')

    await expect(picker.getByRole('button', {
      name: '7 out of 10',
      exact: true
    })).toBeFocused()
  })

  await test.step('dismiss the popover without reading the rating again', async () => {
    await page.mouse.click(8, 8)
    await expect(picker).toHaveCount(0)
    await expect(rate).toBeFocused()
    expect(ratingReads()).toBe(1)
  })
})

test('flips the popover above its action when the viewport has no room below', async ({ page }) => {
  await page.setViewportSize({
    width: 768,
    height: 400
  })

  await page.goto(titlePath)

  const rate = page.getByRole('button', {
    name: 'Rate',
    exact: true
  })

  const picker = page.getByRole('dialog', { name: 'Your rating' })

  await rate.evaluate(element => {
    const box = element.getBoundingClientRect()
    const target = globalThis.scrollY + box.bottom - globalThis.innerHeight + 24

    globalThis.scrollTo(0, target)
  })

  await rate.click()

  const positioning = await picker.evaluate(element => {
    const style = globalThis.getComputedStyle(element)

    return {
      anchor: style.getPropertyValue('position-anchor'),
      inlineTop: element.style.top,
      inlineLeft: element.style.left,
      inlineMaxHeight: element.style.maxHeight
    }
  })

  expect(positioning.anchor).toMatch(/^--/u)
  expect(positioning.inlineTop).toBe('')
  expect(positioning.inlineLeft).toBe('')
  expect(positioning.inlineMaxHeight).toBe('')

  const buttonTop = await rate.evaluate(element => {
    const box = element.getBoundingClientRect()

    return box.top
  })

  const pickerBox = await picker.evaluate(element => {
    const { top, bottom } = element.getBoundingClientRect()

    return {
      top,
      bottom
    }
  })

  expect(pickerBox.bottom).toBeLessThanOrEqual(buttonTop)
  expect(pickerBox.top).toBeGreaterThanOrEqual(16)
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(rate).toBeFocused()
})
