/* oxlint-disable vitest/prefer-each -- Viewport and restored state cases share their loading contracts. */
import type { Locator } from '@playwright/test'
import { appBaseUrl } from '../constants.ts'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { dune } from './details.fixtures.ts'
import { arrival } from './fixtures.ts'
import { waitForHydration } from './helpers.ts'

async function readHeaderGeometry(poster: Locator, heading: Locator) {
  const [posterBox, headingBox] = await Promise.all([poster.boundingBox(), heading.boundingBox()])

  if (posterBox === null || headingBox === null) {
    throw new Error('The title header must be visible before measuring it.')
  }

  return {
    poster: posterBox,
    headingX: headingBox.x,
    headingY: headingBox.y,
    headingWidth: headingBox.width
  }
}

for (const width of [390, 768, 1440]) {
  test(`keeps the public title header stable from loading to loaded at ${width}px`, async ({ context, page }) => {
    const release = Promise.withResolvers<boolean>()
    const detailsPath = `/api/catalog/items/${arrival.id}`

    await context.addCookies([{
      name: 'tv_session',
      value: 'e2e-session',
      url: appBaseUrl
    }])

    await page.setViewportSize({
      width,
      height: 1024
    })

    await page.goto('/?query=arrival')
    await waitForHydration(page)

    await page.route(url => url.pathname === detailsPath, async route => {
      await release.promise

      await route.continue()
    }, { times: 1 })

    try {
      await page.getByRole('link', {
        name: 'Arrival Movie · 2016',
        exact: true
      }).click()

      const loading = page.getByRole('region', { name: 'Loading title' })
      const loadingPoster = loading.locator('[aria-hidden="true"]')
      const loadingHeading = loading.getByRole('heading', { name: 'Loading title…' })

      await expect(loading).toBeVisible()
      await expect(loading).toHaveAttribute('aria-busy', 'true')
      await page.evaluate(async () => globalThis.document.fonts.ready)

      const loadingGeometry = await readHeaderGeometry(loadingPoster, loadingHeading)

      release.resolve(true)

      const heading = page.getByRole('heading', {
        name: arrival.title,
        exact: true
      })

      const poster = page.getByRole('article').locator('[data-compact="false"]')

      await expect(heading).toBeVisible()
      await expect(loading).toHaveCount(0)
      await page.evaluate(async () => globalThis.document.fonts.ready)

      const loadedGeometry = await readHeaderGeometry(poster, heading)

      expect(loadedGeometry).toStrictEqual(loadingGeometry)
    } finally {
      release.resolve(true)
      await page.unrouteAll({ behavior: 'wait' })
    }
  })
}

for (const width of [320, 390, 768, 1440]) {
  for (const { watched, label } of [{
    watched: false,
    label: 'Mark as watched'
  }, {
    watched: true,
    label: 'Watched, mark as unwatched'
  }]) {
    test(`keeps personal actions stable while loading at ${width}px with watched ${watched}`, async ({ context, page }) => {
      const release = Promise.withResolvers<boolean>()

      await context.addCookies([{
        name: 'tv_session',
        value: 'e2e-session',
        url: appBaseUrl
      }])

      await page.setViewportSize({
        width,
        height: 1024
      })

      await page.route(`**/api/catalog/items/${dune.id}/follow`, async route => {
        await release.promise

        await route.fulfill({ json: { followed: true } })
      })

      await page.route(`**/api/catalog/items/${dune.id}/watched`, async route => {
        await release.promise

        await route.fulfill({ json: { watched } })
      })

      try {
        await page.goto(`/titles/${dune.id}`)
        await waitForHydration(page)
        await page.evaluate(async () => globalThis.document.fonts.ready)

        const follow = page.getByRole('region', { name: 'Follow action' }).getByRole('button')
        const watch = page.getByRole('region', { name: 'Watched action' }).getByRole('button')

        await expect(follow).toBeDisabled()
        await expect(watch).toBeDisabled()
        await expect(follow).toHaveAttribute('aria-busy', 'true')
        await expect(watch).toHaveAttribute('aria-busy', 'true')
        await expect(follow).toHaveText('Follow')
        await expect(watch.getByText('Mark as watched', { exact: true }).filter({ visible: true })).toBeVisible()

        const followBefore = await follow.boundingBox()
        const watchBefore = await watch.boundingBox()

        release.resolve(true)
        await expect(follow).toBeEnabled()
        await expect(watch).toBeEnabled()
        await expect(follow).toHaveAttribute('aria-pressed', 'true')
        await expect(watch).toHaveAccessibleName(label)

        const followAfter = await follow.boundingBox()

        expect(followAfter).toStrictEqual(followBefore)

        const watchAfter = await watch.boundingBox()

        expect(watchAfter).toStrictEqual(watchBefore)
      } finally {
        release.resolve(true)
        await page.unrouteAll({ behavior: 'wait' })
      }
    })
  }
}
