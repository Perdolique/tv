/* oxlint-disable eslint/max-lines, vitest/prefer-each -- Title layout variants share one responsive browser contract. */
import type { Locator, Page } from '@playwright/test'
import { appBaseUrl } from '../constants.ts'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { expectNoHorizontalOverflow } from '../helpers.ts'
import { longTitle } from './fixtures.ts'
import { dune } from './details.fixtures.ts'
import { waitForHydration } from './helpers.ts'

const dunePath = `/titles/${dune.id}`
const posterPath = '/posters/dune-2021.webp'

interface ElementGeometry {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface PersonalActionGeometry {
  follow: ElementGeometry;
  group: ElementGeometry;
  overview: ElementGeometry;
  watched: ElementGeometry;
}

function watchedButton(page: Page): Locator {
  return page.getByRole('button', {
    name: 'Watched',
    exact: true
  })
}

function loadingIndicator(button: Locator): Locator {
  return button.locator('[data-loading-indicator]')
}

async function readGeometry(locator: Locator): Promise<ElementGeometry> {
  return locator.evaluate((element) => {
    const { height, left, top, width } = element.getBoundingClientRect()

    return {
      height,
      left: left + globalThis.scrollX,
      top: top + globalThis.scrollY,
      width
    }
  })
}

async function readPersonalActionGeometry(page: Page): Promise<PersonalActionGeometry> {
  const follow = page.getByRole('button', {
    name: 'Follow',
    exact: true
  })

  const watched = watchedButton(page)
  const group = page.getByRole('region', { name: 'Follow action' }).locator('..')
  const overview = page.getByRole('region', { name: 'Overview' })

  const [followGeometry, groupGeometry, overviewGeometry, watchedGeometry] = await Promise.all([
    readGeometry(follow),
    readGeometry(group),
    readGeometry(overview),
    readGeometry(watched)
  ])

  return {
    follow: followGeometry,
    group: groupGeometry,
    overview: overviewGeometry,
    watched: watchedGeometry
  }
}

async function expectInsideViewport(page: Page, locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded()

  const box = await locator.boundingBox()
  const viewport = page.viewportSize()

  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()

  if (box === null || viewport === null) {
    return
  }

  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
}

async function expectNoOverlap(first: Locator, second: Locator): Promise<void> {
  const firstBox = await first.boundingBox()
  const secondBox = await second.boundingBox()

  expect(firstBox).not.toBeNull()
  expect(secondBox).not.toBeNull()

  if (firstBox === null || secondBox === null) {
    return
  }

  const overlaps = firstBox.x < secondBox.x + secondBox.width
    && firstBox.x + firstBox.width > secondBox.x
    && firstBox.y < secondBox.y + secondBox.height
    && firstBox.y + firstBox.height > secondBox.y

  expect(overlaps).toBe(false)
}

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

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of viewports) {
    test(`personal actions at ${viewport.name} in ${colorScheme}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.emulateMedia({ colorScheme })
      await page.goto(dunePath)

      const guestFollow = page.getByRole('link', {
        name: 'Follow',
        exact: true
      })

      const guestWatched = page.getByRole('link', {
        name: 'Mark as watched',
        exact: true
      })

      await expect(guestFollow).toBeVisible()
      await expect(guestWatched).toBeVisible()
      await expectInsideViewport(page, guestFollow)
      await expectInsideViewport(page, guestWatched)
      await expectNoOverlap(guestFollow, guestWatched)
      await expect(page.getByRole('img', { name: 'Dune poster' })).toHaveAttribute('data-loaded', 'true')
      await expectNoHorizontalOverflow(page)

      await page.context().addCookies([{
        name: 'tv_session',
        value: 'e2e-session',
        url: appBaseUrl
      }])

      await page.reload()

      const follow = page.getByRole('button', {
        name: 'Follow',
        exact: true
      })

      const watched = watchedButton(page)

      await expect(follow).toBeVisible()
      await expect(watched).toHaveAttribute('aria-pressed', 'false')
      await expectInsideViewport(page, follow)
      await expectInsideViewport(page, watched)
      await expectNoOverlap(follow, watched)
      await expect(page.getByRole('img', { name: 'Dune poster' })).toHaveAttribute('data-loaded', 'true')
      await expectNoHorizontalOverflow(page)

      await page.context().addCookies([{
        name: 'tv_followed_item',
        value: dune.id,
        url: appBaseUrl
      }, {
        name: 'tv_watched_item',
        value: dune.id,
        url: appBaseUrl
      }])

      await page.reload()

      const following = page.getByRole('button', {
        name: 'Following',
        exact: true
      })

      await expect(following).toBeVisible()
      await expect(watchedButton(page)).toHaveAttribute('aria-pressed', 'true')
      await expectInsideViewport(page, following)
      await expectInsideViewport(page, watchedButton(page))
      await expectNoOverlap(following, watchedButton(page))
      await expectNoHorizontalOverflow(page)
    })
  }
}

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of viewports) {
    test(`keeps personal action geometry stable during slow progress at ${viewport.name} in ${colorScheme}`, async ({ context, page }) => {
      const response = Promise.withResolvers<boolean>()
      const watchedUrl = `${appBaseUrl}/api/catalog/items/${dune.id}/watched`

      await context.addCookies([{
        name: 'tv_session',
        value: 'e2e-session',
        url: appBaseUrl
      }])

      await page.setViewportSize(viewport)
      await page.emulateMedia({ colorScheme })
      await page.goto(dunePath)
      await waitForHydration(page)

      await page.route(watchedUrl, async (route) => {
        await response.promise

        await route.fulfill({ json: { watched: true } })
      })

      try {
        const follow = page.getByRole('button', {
          name: 'Follow',
          exact: true
        })

        const watched = watchedButton(page)
        const progress = loadingIndicator(watched)
        const before = await readPersonalActionGeometry(page)

        await watched.click()
        await expect(watched).toHaveAttribute('aria-busy', 'true')
        await expect(watched).toHaveAttribute('aria-pressed', 'true')
        await expect(progress).toHaveCSS('visibility', 'hidden')
        await expect(progress).toHaveCSS('opacity', '1', { timeout: 2000 })

        const during = await readPersonalActionGeometry(page)

        expect(during).toEqual(before)
        await expectNoOverlap(follow, watched)
        await expectNoHorizontalOverflow(page)
        response.resolve(true)
        await expect(watched).not.toHaveAttribute('aria-busy')
        await expect(progress).toHaveCSS('visibility', 'hidden')

        const after = await readPersonalActionGeometry(page)

        expect(after).toEqual(before)
        await expectNoOverlap(follow, watched)
        await expectNoHorizontalOverflow(page)
      } finally {
        response.resolve(true)
        await page.unroute(watchedUrl)
      }
    })
  }
}

for (const colorScheme of ['light', 'dark'] as const) {
  for (const width of [320, 639, 640, 1023, 1024]) {
    test(`reflows a long title at ${width}px in ${colorScheme}`, async ({ context, page }) => {
      await context.addCookies([{
        name: 'tv_session',
        value: 'e2e-long-email-session',
        url: appBaseUrl
      }])

      await page.emulateMedia({ colorScheme })

      await page.setViewportSize({
        width,
        height: 1024
      })

      await page.goto(`/titles/${longTitle.id}`)

      const heading = page.getByRole('heading', {
        name: longTitle.title,
        exact: true
      })

      const follow = page.getByRole('button', {
        name: 'Follow',
        exact: true
      })

      const watched = watchedButton(page)

      await expect(heading).toBeVisible()
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
      await expect(follow).toBeVisible()
      await expect(watched).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await expectInsideViewport(page, heading)
      await expectInsideViewport(page, follow)
      await expectInsideViewport(page, watched)
      await expectNoOverlap(follow, watched)
    })
  }
}

test('keeps Russian copy readable at a 200% zoom-equivalent viewport', async ({ context, page }) => {
  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])

  await page.setViewportSize({
    width: 720,
    height: 512
  })

  await page.goto(`${dunePath}?titleLocale=ru`)

  await expect(page.getByRole('heading', {
    name: 'Дюна',
    exact: true
  })).toBeVisible()

  await expectNoHorizontalOverflow(page)

  await expect(page.getByRole('button', {
    name: 'Follow',
    exact: true
  })).toBeVisible()

  await expect(watchedButton(page)).toBeVisible()
})

test('reserves poster geometry during a slow image load', async ({ page }) => {
  const release = Promise.withResolvers<boolean>()

  await page.route(`**${posterPath}`, async (route) => {
    await release.promise

    await route.continue()
  })

  try {
    await page.goto(dunePath, { waitUntil: 'domcontentloaded' })
    await waitForHydration(page)

    const placeholder = page.getByText('Loading poster…', { exact: true })

    await expect(placeholder).toBeVisible()

    const before = await placeholder.boundingBox()

    release.resolve(true)

    const poster = page.getByRole('img', { name: 'Dune poster' })

    await expect(poster).toHaveAttribute('data-loaded', 'true')

    const after = await poster.boundingBox()

    expect(before?.width).toBe(after?.width)
    expect(before?.height).toBe(after?.height)
    await expect(placeholder).toHaveCount(0)
  } finally {
    release.resolve(true)
  }
})

test.describe('unavailable artwork', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: posterPath,
    status: 404
  }] } })

  test('replaces a broken image with a neutral placeholder without hiding the title', async ({ page }) => {
    await page.route(`**${posterPath}`, async (route) => {
      await route.fulfill({
      status: 404,
      body: ''
    })
    })

    await page.goto(dunePath)
    await expect(page.getByText('No poster available', { exact: true })).toBeVisible()

    await expect(page.getByRole('heading', {
      name: 'Dune',
      exact: true
    })).toBeVisible()

    await expect(page.getByRole('img', { name: 'Dune poster' })).toHaveCount(0)
  })
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`keeps visible keyboard focus with reduced motion in ${colorScheme}`, async ({ context, page }) => {
    const response = Promise.withResolvers<boolean>()
    const watchedUrl = `${appBaseUrl}/api/catalog/items/${dune.id}/watched`

    await context.addCookies([{
      name: 'tv_session',
      value: 'e2e-session',
      url: appBaseUrl
    }])

    await page.emulateMedia({
      colorScheme,
      reducedMotion: 'reduce'
    })

    await page.goto(dunePath)
    await waitForHydration(page)

    const follow = page.getByRole('button', {
      name: 'Follow',
      exact: true
    })

    await follow.focus()
    await expect(follow).toBeFocused()
    expect(await follow.evaluate(element => globalThis.getComputedStyle(element).outlineStyle)).not.toBe('none')
    await page.keyboard.press('Enter')

    const following = page.getByRole('button', {
      name: 'Following',
      exact: true
    })

    await expect(following).toBeVisible()
    await expect(following).toBeFocused()
    await expect(following).not.toHaveAttribute('aria-busy')

    const watched = watchedButton(page)

    await page.route(watchedUrl, async (route) => {
      await response.promise

      await route.fulfill({ json: { watched: true } })
    })

    try {
      await watched.focus()
      await expect(watched).toBeFocused()
      expect(await watched.evaluate(element => globalThis.getComputedStyle(element).outlineStyle)).not.toBe('none')
      await page.keyboard.press('Enter')
      await expect(watched).toHaveAttribute('aria-pressed', 'true')
      await expect(watched).toHaveAttribute('aria-busy', 'true')

      const progress = loadingIndicator(watched)

      await expect(progress).toHaveCSS('opacity', '1', { timeout: 2000 })

      const progressIterations = await progress.evaluate(element => element.getAnimations().map(
        animation => animation.effect?.getTiming().iterations
      ))

      expect(progressIterations).toEqual([1])
      response.resolve(true)
      await expect(watched).toBeFocused()
      await expect(watched).not.toHaveAttribute('aria-busy')
      await expect(progress).toHaveCSS('visibility', 'hidden')
    } finally {
      response.resolve(true)
      await page.unroute(watchedUrl)
    }

    const back = page.getByRole('link', {
      name: 'Back to catalog',
      exact: true
    })

    await back.focus()
    await expect(back).toBeFocused()

    const outline = await back.evaluate(element => globalThis.getComputedStyle(element).outlineStyle)

    expect(outline).not.toBe('none')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(`${appBaseUrl}/`)
  })
}
