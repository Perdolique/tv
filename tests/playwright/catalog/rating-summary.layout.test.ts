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
  const publicBox = await readBox(viewer.getByText('8.8 out of 10', { exact: true }))
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
      const score = viewer.getByText('8.8 out of 10', { exact: true })
      const personal = page.getByRole('region', { name: 'Your rating' })
      const personalTrigger = personal.getByRole('button', { name: 'Rate, your rating: 7 out of 10' })
      const scoreCard = page.getByRole('region', { name: 'Personal score' })
      const count = viewer.getByText('1,234 ratings', { exact: true })

      await expect(viewer.getByRole('button')).toHaveCount(0)
      await expect(score).toBeVisible()
      await expect(count).toBeVisible()
      await expect(personalTrigger).toHaveText('Rate')
      await expect(viewer).toHaveCount(1)
      await expect(scoreCard).toContainText('7 out of 10')
      await expect(viewer).toHaveAccessibleName('TV viewer rating')
      await expect(scoreCard.getByText('Your rating', { exact: true })).toBeVisible()
      await expectNoHorizontalOverflow(page)

      const scoreBox = await readBox(score)
      const countBox = await readBox(count)
      const personalBox = await readBox(personalTrigger)

      expect(personalBox.height).toBeGreaterThanOrEqual(44)
      expect(countBox.y).toBeGreaterThanOrEqual(scoreBox.y + scoreBox.height)
      await expectReferenceLayout(page, viewport.width)
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
    })
  }
}

test('moves one visible score and count between the header and rail', async ({ context, page }) => {
  await context.addCookies([{
    name: 'large_rating_summary',
    value: '1',
    url: appBaseUrl
  }])

  await page.goto(`/titles/${dune.id}`)
  await waitForHydration(page)

  /* oxlint-disable eslint/no-await-in-loop -- Resize one mounted page sequentially to check responsive changes. */
  for (const width of [390, 1440, 768, 320]) {
    await page.setViewportSize({
      width,
      height: 844
    })

    const viewer = page.getByRole('region', { name: 'TV viewer rating' })

    await expect(viewer).toHaveCount(1)
    await expect(viewer.getByText('8.8 out of 10', { exact: true })).toBeVisible()
    await expect(viewer.getByText('1,234 ratings', { exact: true })).toBeVisible()
    await expect(viewer.getByRole('button')).toHaveCount(0)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
  }
  /* oxlint-enable eslint/no-await-in-loop */
})

test('keeps the score and count readable with narrow double-sized text', async ({ context, page }) => {
  await context.addCookies([{
    name: 'large_rating_summary',
    value: '1',
    url: appBaseUrl
  }])

  await page.setViewportSize({
    width: 320,
    height: 844
  })

  await page.goto(`/titles/${dune.id}`)
  await waitForHydration(page)
  await page.evaluate(() => { globalThis.document.documentElement.style.fontSize = '200%' })

  const viewer = page.getByRole('region', { name: 'TV viewer rating' })
  const count = viewer.getByText('1,234 ratings', { exact: true })

  await expect(viewer.getByText('8.8 out of 10', { exact: true })).toBeVisible()
  await expect(count).toBeVisible()
  await expectNoHorizontalOverflow(page)

  const box = await readBox(count)

  expect(box.x).toBeGreaterThanOrEqual(16)
  expect(box.x + box.width).toBeLessThanOrEqual(304)
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

  const viewer = page.getByRole('region', { name: 'TV viewer rating' })

  await expect(viewer.getByText('10 out of 10', { exact: true })).toBeVisible()
  await expect(viewer.getByText('100 ratings', { exact: true })).toBeVisible()
})
