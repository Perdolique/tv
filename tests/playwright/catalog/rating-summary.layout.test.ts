/* oxlint-disable vitest/prefer-each -- Playwright generates theme and viewport variants. */
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { appBaseUrl } from '../constants.ts'
import { expectNoHorizontalOverflow } from '../helpers.ts'
import { dune } from './details.fixtures.ts'
import { waitForHydration } from './helpers.ts'

async function readBox(locator: Locator) {
  const box = await locator.boundingBox()

  if (box === null) {
    throw new Error('The rating element must be visible before measuring it.')
  }

  return box
}

async function expectReferenceLayout(page: Page, width: number): Promise<void> {
  const viewer = page.getByRole('region', { name: 'TV viewer rating' })
  const scoreCard = page.getByRole('region', { name: 'Personal score' })
  const rateBox = await readBox(page.getByRole('button', { name: 'Rate, your rating: 7 out of 10' }))
  const publicBox = await readBox(viewer.getByRole('button'))
  const cardBox = await readBox(scoreCard)
  const posterBox = await readBox(page.getByRole('img', { name: 'Dune poster' }))

  const headingBox = await readBox(page.getByRole('heading', {
    name: 'Dune',
    exact: true
  }))

  expect(headingBox.x).toBeGreaterThan(posterBox.x + posterBox.width)
  expect(rateBox.y).toBeGreaterThan(headingBox.y + headingBox.height)

  if (width >= 1024) {
    const viewerBox = await readBox(viewer)

    const overviewBox = await readBox(page.getByRole('region', {
      name: 'Overview',
      exact: true
    }))

    expect(viewerBox.x).toBeGreaterThan(overviewBox.x + overviewBox.width)
    expect(Math.abs(viewerBox.x - cardBox.x)).toBeLessThanOrEqual(1)
    expect(cardBox.y).toBeGreaterThan(viewerBox.y + viewerBox.height)
    expect(viewerBox.y).toBeGreaterThan(rateBox.y + rateBox.height)
  } else if (width < 640) {
    expect(publicBox.x).toBeGreaterThan(posterBox.x + posterBox.width)
    expect(publicBox.y + publicBox.height).toBeLessThanOrEqual(rateBox.y)
    expect(cardBox.y).toBeGreaterThan(rateBox.y + rateBox.height)
    expect(cardBox.x).toBeLessThan(posterBox.x + 1)
    expect(cardBox.width).toBeGreaterThan(posterBox.width + rateBox.width)
  } else if (width >= 768) {
    expect(cardBox.x).toBeGreaterThan(rateBox.x + rateBox.width)
  } else {
    expect(cardBox.y).toBeGreaterThan(rateBox.y + rateBox.height)
  }
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
  }, {
    // Equivalent to a 1440 × 1024 viewport at 200% browser zoom.
    width: 720,
    height: 512
  }]) {
    test(`keeps the viewer rating and large count usable in ${colorScheme} at ${viewport.width}px`, async ({ context, page }) => {
      await page.setViewportSize(viewport)

      await page.emulateMedia({
        colorScheme,
        reducedMotion: 'reduce'
      })

      await context.addCookies([
        {
          name: 'large_rating_summary',
          value: '1',
          url: appBaseUrl
        },
        {
          name: 'tv_session',
          value: 'e2e-session',
          url: appBaseUrl
        },
        {
          name: `tv_rating_first_${dune.id}`,
          value: '7',
          url: appBaseUrl
        }
      ])

      await page.goto(`/titles/${dune.id}`)
      await waitForHydration(page)

      const viewer = page.getByRole('region', { name: 'TV viewer rating' })
      const trigger = viewer.getByRole('button', { name: 'TV viewer rating: 8.8 out of 10' })
      const personal = page.getByRole('region', { name: 'Your rating' })
      const personalTrigger = personal.getByRole('button', { name: 'Rate, your rating: 7 out of 10' })
      const scoreCard = page.getByRole('region', { name: 'Personal score' })
      const tooltip = page.getByRole('tooltip')

      await expect(tooltip).toHaveCount(0)
      await expect(trigger).toHaveText('8.8')
      await expect(personalTrigger).toHaveText('Rate')
      await expect(viewer).toHaveCount(1)
      await expect(scoreCard).toContainText('7 out of 10')
      await expect(viewer).toHaveAccessibleName('TV viewer rating')
      await expect(scoreCard.getByText('Your rating', { exact: true })).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await trigger.focus()
      await expect(tooltip).toHaveText('1,234 ratings')
      await expect(trigger).toBeFocused()

      const box = await readBox(trigger)
      const personalBox = await readBox(personalTrigger)
      const tooltipBox = await readBox(tooltip)

      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(personalBox.height).toBeGreaterThanOrEqual(44)
      await expectReferenceLayout(page, viewport.width)

      const positioning = await tooltip.evaluate(element => {
        const style = globalThis.getComputedStyle(element)
        const anchor = style.getPropertyValue('position-anchor')

        return {
          anchor,
          inlineLeft: element.style.left
        }
      })

      expect(positioning.anchor).toMatch(/^--/u)
      expect(positioning.inlineLeft).toBe('')
      expect(tooltipBox.x).toBeGreaterThanOrEqual(16)
      expect(tooltipBox.y).toBeGreaterThanOrEqual(16)
      expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(viewport.width - 16)
      expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(viewport.height - 16)
      await page.keyboard.press('Escape')
      await expect(tooltip).toHaveCount(0)
      await personalTrigger.focus()
      await page.keyboard.press('Tab')

      const follow = page.getByRole('button', {
        name: 'Follow',
        exact: true
      })

      await expect(follow).toBeFocused()

      const hasVisibleFocus = await follow.evaluate(element => {
        const rectangle = element.getBoundingClientRect()
        const centerX = rectangle.x + rectangle.width / 2
        const centerY = rectangle.y + rectangle.height / 2
        const visibleElement = globalThis.document.elementFromPoint(centerX, centerY)

        return element.contains(visibleElement)
      })

      expect(hasVisibleFocus).toBe(true)

      await page.getByRole('heading', {
        name: 'Dune',
        exact: true
      }).click()

      await page.screenshot({
        path: `/tmp/tv-pr85-reference-layout/movie-${colorScheme}-${viewport.width}.png`,
        fullPage: false
      })
    })
  }
}

test('moves one visible viewer score between the header and rail without leaving its tooltip open', async ({ context, page }) => {
  await context.addCookies([{
    name: 'large_rating_summary',
    value: '1',
    url: appBaseUrl
  }])

  await page.setViewportSize({
    width: 390,
    height: 844
  })

  await page.goto(`/titles/${dune.id}`)
  await waitForHydration(page)

  const viewer = page.getByRole('region', { name: 'TV viewer rating' })
  const trigger = viewer.getByRole('button', { name: 'TV viewer rating: 8.8 out of 10' })
  const tooltip = page.getByRole('tooltip')

  await expect(viewer).toHaveCount(1)
  await trigger.click()
  await expect(tooltip).toHaveText('1,234 ratings')
  await page.mouse.move(0, 0)

  const headerTooltipId = await tooltip.evaluate(element => element.id)

  await page.setViewportSize({
    width: 1440,
    height: 1024
  })

  await expect(page.locator(`[aria-describedby="${headerTooltipId}"]`)).toHaveCount(0)
  await expect(tooltip).toHaveCount(0)
  await expect(viewer).toHaveCount(1)
  await expect(page.getByRole('complementary', { name: 'Title ratings' }).getByRole('button', { name: 'TV viewer rating: 8.8 out of 10' })).toBeVisible()
  await trigger.focus()
  await expect(tooltip).toHaveText('1,234 ratings')

  const railTooltipId = await tooltip.evaluate(element => element.id)

  await page.setViewportSize({
    width: 768,
    height: 1024
  })

  await expect(page.locator(`[aria-describedby="${railTooltipId}"]`)).toHaveCount(0)
  await expect(tooltip).toHaveCount(0)
  await expect(viewer).toHaveCount(1)
  await expect(trigger).toBeVisible()
})

test('keeps the anchored tooltip inside the viewport on scroll, resize and narrow double-sized text', async ({ context, page }) => {
  await page.setViewportSize({
    width: 320,
    height: 844
  })

  await context.addCookies([{
    name: 'large_rating_summary',
    value: '1',
    url: appBaseUrl
  }])

  await page.goto(`/titles/${dune.id}`)
  await waitForHydration(page)
  await page.evaluate(() => { globalThis.document.documentElement.style.fontSize = '200%' })

  const trigger = page.getByRole('button', { name: 'TV viewer rating: 8.8 out of 10' })
  const tooltip = page.getByRole('tooltip')

  await trigger.click()
  await expect(tooltip).toHaveText('1,234 ratings')
  await expectNoHorizontalOverflow(page)

  const anchor = await tooltip.evaluate(element => {
    const style = globalThis.getComputedStyle(element)

    return style.getPropertyValue('position-anchor')
  })

  expect(anchor).toMatch(/^--/u)

  await page.setViewportSize({
    width: 320,
    height: 400
  })

  await trigger.evaluate(element => {
    const rectangle = element.getBoundingClientRect()

    globalThis.scrollBy(0, rectangle.bottom - globalThis.innerHeight + 24)
  })

  await expect.poll(async () => {
    const rectangle = await readBox(tooltip)

    return rectangle.y + rectangle.height
  }).toBeLessThanOrEqual(384)

  const rectangle = await readBox(tooltip)

  expect(rectangle.x).toBeGreaterThanOrEqual(16)
  expect(rectangle.x + rectangle.width).toBeLessThanOrEqual(304)
  await page.keyboard.press('Escape')
  await expect(tooltip).toHaveCount(0)
})

test('drops a zero fraction when the refreshed average rounds to ten', async ({ context, page }) => {
  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])

  await page.goto(`/titles/${dune.id}`)
  await waitForHydration(page)

  await page.route(`**/api/catalog/items/${dune.id}/rating-summary`, async route => {
    await route.fulfill({
      json: {
        averageScore: 9.96,
        ratingCount: 100
      }
    })
  }, { times: 1 })

  const personal = page.getByRole('region', { name: 'Your rating' })

  await personal.getByRole('button', {
    name: 'Rate',
    exact: true
  }).click()

  await personal.getByRole('button', {
    name: '7 out of 10',
    exact: true
  }).click()

  await expect(personal.getByRole('button', { name: 'Rate, your rating: 7 out of 10' })).toHaveText('Rate')
  await expect(page.getByRole('region', { name: 'Personal score' })).toContainText('7 out of 10')

  const viewer = page.getByRole('region', { name: 'TV viewer rating' }).getByRole('button')

  await expect(viewer).toHaveText('10')
  await expect(viewer).toHaveAccessibleName('TV viewer rating: 10 out of 10')
})
