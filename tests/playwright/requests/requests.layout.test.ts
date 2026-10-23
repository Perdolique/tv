/* oxlint-disable eslint/no-await-in-loop -- Each source review and navigation scroll must finish before the next interaction. */
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie, expectNoHorizontalOverflow } from '../helpers.ts'
import { longMovie, posterMovie, requestedMovie, unbrokenMovie } from './fixtures.ts'

import {
  expectContained,
  expectInsideViewport,
  expectReadableText,
  openRequestForm,
  readBox,
  reviewRequest,
  searchRequestSource
} from './helpers.ts'

test.describe('request source card layout', () => {
  test.beforeEach(async ({ context }) => {
    await addCookie(context, 'tv_session', 'e2e-session')
  })

  test('renders source artwork and a readable poster fallback beside their title and review action', async ({ page }) => {
    await page.route(posterMovie.posterUrl, async route => {
      await route.fulfill({
        path: 'apps/web/public/posters/dune-2021.webp',
        contentType: 'image/webp'
      })
    })

    await page.setViewportSize({
      width: 390,
      height: 844
    })

    await openRequestForm(page)
    await searchRequestSource(page, 'Source artwork')

    const source = page.getByRole('region', { name: 'TMDB search results' })
    const posterReviewName = `Review ${posterMovie.title}`
    const fallbackReviewName = `Review ${requestedMovie.title}`
    const imageName = `${posterMovie.title} poster`

    const posterAction = page.getByRole('button', {
      name: posterReviewName,
      exact: true
    })

    const fallbackAction = page.getByRole('button', {
      name: fallbackReviewName,
      exact: true
    })

    const posterRow = source.getByRole('listitem').filter({ has: posterAction })
    const fallbackRow = source.getByRole('listitem').filter({ has: fallbackAction })

    const image = posterRow.getByRole('img', {
      name: imageName,
      exact: true
    })

    const fallback = fallbackRow.getByText('No poster available', { exact: true })
    const fallbackFrame = fallback.locator('..')

    await image.scrollIntoViewIfNeeded()
    await expect(image).toHaveAttribute('data-loaded', 'true')
    await expect(fallback).toBeVisible()

    for (const { row, artwork, title } of [{
      row: posterRow,
      artwork: image,
      title: posterMovie.title
    }, {
      row: fallbackRow,
      artwork: fallbackFrame,
      title: requestedMovie.title
    }]) {
      const heading = row.getByText(title, { exact: true })
      const reviewName = `Review ${title}`

      const action = row.getByRole('button', {
        name: reviewName,
        exact: true
      })

      await expectContained(artwork, row)
      await expectContained(heading, row)
      await expectContained(action, row)

      const artworkBox = await readBox(artwork)
      const titleBox = await readBox(heading)
      const aspectRatio = artworkBox.height / artworkBox.width
      const artworkRight = artworkBox.x + artworkBox.width

      expect(artworkBox.width).toBeGreaterThanOrEqual(48)
      expect(aspectRatio).toBeCloseTo(1.5, 1)
      expect(artworkRight).toBeLessThanOrEqual(titleBox.x)
    }

    await expectContained(fallback, fallbackRow)
    await expectNoHorizontalOverflow(page)
  })

  for (const theme of ['light', 'dark'] as const) {
    for (const width of [390, 768, 1440]) {
      test(`long source and review titles stay readable in ${theme} at ${width}px`, async ({ page }, testInfo) => {
        await page.emulateMedia({ colorScheme: theme })

        await page.setViewportSize({
          width,
          height: 1024
        })

        await openRequestForm(page)
        await searchRequestSource(page, 'Long source titles')

        const source = page.getByRole('region', { name: 'TMDB search results' })

        for (const card of [longMovie, unbrokenMovie]) {
          const reviewName = `Review ${card.title}`

          const action = page.getByRole('button', {
            name: reviewName,
            exact: true
          })

          const row = source.getByRole('listitem').filter({ has: action })
          const title = row.getByText(card.title, { exact: true })

          await expectContained(title, row)
          await expectReadableText(title)
          await expectContained(action, row)
          await expectInsideViewport(page, action)
          await reviewRequest(page, card.title)

          const review = page.getByRole('region', { name: 'Review title request' })
          const article = review.getByRole('article')

          const heading = review.getByRole('heading', {
            name: card.title,
            exact: true
          })

          const original = review.getByText(card.originalTitle, { exact: true })

          const submit = review.getByRole('button', {
            name: 'Submit request',
            exact: true
          })

          await expectContained(heading, article)
          await expectContained(original, article)
          await expectReadableText(heading)
          await expectReadableText(original)
          await expectContained(submit, article)
          await expectInsideViewport(page, heading)
          await expectInsideViewport(page, submit)
          await expectNoHorizontalOverflow(page)
        }

        const screenshotPath = testInfo.outputPath('request-long-preview.png')

        await page.screenshot({
          path: screenshotPath,
          fullPage: true
        })
      })
    }
  }
})

test.describe('tablet request navigation', () => {
  test('fits the expanded management rail and scrolls every link without covering sign out at 768×600', async ({ page, context }) => {
    await addCookie(context, 'tv_session', 'e2e-session')
    await addCookie(context, 'catalog_manager', '1')

    await page.setViewportSize({
      width: 768,
      height: 600
    })

    await openRequestForm(page)

    const navigation = page.getByRole('navigation', {
      name: 'Main navigation',
      exact: true
    })

    const signOut = page.getByRole('button', {
      name: 'Sign out',
      exact: true
    })

    const links = navigation.getByRole('link')

    await expect(links).toHaveCount(8)

    const canScroll = await navigation.evaluate(element => element.scrollHeight > element.clientHeight)

    expect(canScroll).toBe(true)

    for (const name of ['Catalog', 'Calendar', 'Watchlist', 'Dashboard', 'Collections', 'Import title', 'Request title', 'Incoming requests']) {
      const link = navigation.getByRole('link', {
        name,
        exact: true
      })

      await link.focus()
      await expectInsideViewport(page, link)
      await expectContained(link, navigation)
      await expectContained(link.getByText(name, { exact: true }), link)
    }

    const navigationBox = await readBox(navigation)
    const signOutBox = await readBox(signOut)
    const navigationBottom = navigationBox.y + navigationBox.height

    expect(navigationBottom).toBeLessThanOrEqual(signOutBox.y)
    await page.keyboard.press('Tab')
    await expect(signOut).toBeFocused()
    await expectInsideViewport(page, signOut)
    await expectNoHorizontalOverflow(page)
    await signOut.press('Enter')

    await expect(page.getByRole('link', {
      name: 'Sign in',
      exact: true
    })).toBeVisible()
  })
})
