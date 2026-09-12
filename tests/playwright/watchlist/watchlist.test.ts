import type { BrowserContext, Page, Response } from '@playwright/test'
import { appBaseUrl } from '../constants.ts'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie, getRedirectLocation } from '../helpers.ts'
import { waitForHydration } from '../catalog/helpers.ts'
import { watchlistItems } from './fixtures.ts'

async function openAuthenticatedPage(page: Page, context: BrowserContext, target = '/watchlist'): Promise<Response | null> {
  await addCookie(context, 'tv_session', 'e2e-session')

  const response = await page.goto(target)

  await waitForHydration(page)

  return response
}

const failedWatchlistTest = test.extend({ expectedHttpErrors: { values: [
  {
    pathname: '/api/catalog/watchlist',
    status: 503
  },
  {
    pathname: '/api/catalog/watchlist',
    status: 503
  }
] } })

const expiredWatchlistTest = test.extend({ expectedHttpErrors: { values: [{
  pathname: '/api/catalog/watchlist',
  status: 401
}] } })

const failedSessionTest = test.extend({ expectedHttpErrors: { values: [
  {
    pathname: '/api/auth/session',
    status: 503
  },
  {
    pathname: '/api/auth/session',
    status: 503
  }
] } })

test('redirects a guest through sign in and returns to the watchlist', async ({ page, context }) => {
  const response = await context.request.get('/watchlist', { maxRedirects: 0 })
  const location = getRedirectLocation(response)

  expect(response.status()).toBe(302)
  expect(location.pathname).toBe('/sign-in')
  expect(location.searchParams.get('redirectTo')).toBe('/watchlist')
  await page.goto('/watchlist')
  await expect(page).toHaveURL(`${appBaseUrl}/sign-in?redirectTo=/watchlist`)
  await page.getByLabel('Email').fill('viewer@example.com')
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(`${appBaseUrl}/watchlist`)
  await expect(page.getByRole('heading', { name: 'Watchlist' })).toBeVisible()
  await expect(page.getByRole('listitem')).toHaveCount(watchlistItems.length)
})

test('renders the server order, nullable fields, posters, and title links', async ({ page, context }) => {
  const response = await openAuthenticatedPage(page, context)

  expect(response?.headers()['cache-control']).toBe('private, no-store')
  await expect(page.getByRole('listitem')).toHaveCount(watchlistItems.length)

  await expect(page.getByRole('heading', { level: 2 }).allTextContents()).resolves.toStrictEqual(
    watchlistItems.map(item => item.title)
  )

  await expect(page.getByRole('listitem').nth(2)).toContainText('Movie')
  await expect(page.getByRole('listitem').nth(2)).not.toContainText('·')
  await expect(page.getByRole('listitem').nth(3)).toContainText('Series · 2017')
  await expect(page.getByAltText('Dune poster')).toBeVisible()
  await expect(page.getByText('No poster available')).toHaveCount(3)

  const firstLink = page.getByRole('listitem').first().getByRole('link')

  await expect(firstLink).toHaveAttribute('href', `/titles/${watchlistItems[0].id}`)
  await firstLink.click()
  await expect(page).toHaveURL(`${appBaseUrl}/titles/${watchlistItems[0].id}`)

  await expect(page.getByRole('heading', {
    name: 'Dune',
    exact: true
  })).toBeVisible()

  await expect(page.getByRole('link', {
    name: 'Catalog',
    exact: true
  })).toHaveAttribute('aria-current', 'page')
})

test('shows an empty watchlist with a catalog link', async ({ page, context }) => {
  await addCookie(context, 'empty_watchlist', '1')
  await openAuthenticatedPage(page, context)
  await expect(page.getByRole('heading', { name: 'Your watchlist is empty' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Browse catalog' })).toHaveAttribute('href', '/')
  await expect(page.getByRole('listitem')).toHaveCount(0)
})

test('shows stable skeleton geometry while a client navigation loads', async ({ page, context }) => {
  await openAuthenticatedPage(page, context, '/')
  await addCookie(context, 'slow_watchlist', '1')

  await page.getByRole('link', {
    name: 'Watchlist',
    exact: true
  }).click()

  const loading = page.getByRole('region', { name: 'Loading watchlist' })

  await expect(loading).toBeVisible()
  await expect(loading.locator(':scope > div')).toHaveCount(3)

  const skeletonRow = loading.locator(':scope > div').first()
  const skeletonPoster = skeletonRow.locator(':scope > div').first()
  const loadingBounds = await skeletonRow.boundingBox()
  const loadingRadius = await skeletonPoster.evaluate(element => globalThis.getComputedStyle(element).borderRadius)

  await expect(page.getByText('Loading your watchlist…', { exact: true })).toBeVisible()
  await expect(page.getByRole('listitem')).toHaveCount(watchlistItems.length)

  const loadedRow = page.getByRole('listitem').first()
  const loadedPoster = page.getByAltText('Dune poster').locator('..')
  const loadedBounds = await loadedRow.boundingBox()
  const loadedRadius = await loadedPoster.evaluate(element => globalThis.getComputedStyle(element).borderRadius)

  expect(loadingBounds?.width).toBe(loadedBounds?.width)
  expect(loadingBounds?.height).toBe(loadedBounds?.height)
  expect(loadingRadius).toBe(loadedRadius)
})

// oxlint-disable-next-line vitest/require-hook -- This is a Playwright test with an expected HTTP error.
failedWatchlistTest('shows a safe error and restores focus after another failure', async ({ page, context }) => {
  await openAuthenticatedPage(page, context, '/')
  await addCookie(context, 'fail_watchlist', '2')

  await page.getByRole('link', {
    name: 'Watchlist',
    exact: true
  }).click()

  const alert = page.getByRole('alert')
  const retryButton = page.getByRole('button', { name: 'Try again' })

  await expect(alert).toHaveText('We couldn’t load your watchlist. Try again.')
  await expect(alert).not.toContainText('database')
  await retryButton.click()
  await expect(retryButton).toBeFocused()
  await expect(alert).toHaveText('We couldn’t load your watchlist. Try again.')
  await retryButton.click()
  await expect(page.getByRole('heading', { name: 'Watchlist' })).toBeFocused()
  await expect(page.getByRole('listitem')).toHaveCount(watchlistItems.length)
})

// oxlint-disable-next-line vitest/require-hook -- This is a Playwright test with an expected HTTP error.
expiredWatchlistTest('clears private rows after a late 401 and returns after sign in', async ({ page, context }) => {
  await addCookie(context, 'tv_session', `e2e-expiring-${crypto.randomUUID()}`)
  await page.goto('/')
  await waitForHydration(page)
  await addCookie(context, 'expire_watchlist', '1')

  await page.getByRole('link', {
    name: 'Watchlist',
    exact: true
  }).click()

  await expect(page).toHaveURL(`${appBaseUrl}/sign-in?redirectTo=/watchlist`)
  await expect(page.getByRole('list', { name: 'Followed titles' })).toHaveCount(0)
  await context.clearCookies({ name: 'expire_watchlist' })
  await page.getByLabel('Email').fill('viewer@example.com')
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(`${appBaseUrl}/watchlist`)
  await expect(page.getByRole('listitem')).toHaveCount(watchlistItems.length)
})

// oxlint-disable-next-line vitest/require-hook -- This is a Playwright test with an expected HTTP error.
failedSessionTest('keeps a session failure separate and restores retry focus', async ({ page, context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'fail_session', '2')
  await page.goto('/watchlist')
  await expect(page.getByRole('heading', { name: 'We couldn’t verify your session.' })).toBeVisible()
  await expect(page).toHaveURL(`${appBaseUrl}/watchlist`)

  const retryButton = page.getByRole('button', { name: 'Try again' })

  await retryButton.click()
  await expect(retryButton).toBeFocused()
  await expect(retryButton).toBeEnabled()
  await retryButton.click()
  await expect(page.getByRole('heading', { name: 'Watchlist' })).toBeFocused()
  await expect(page.getByRole('listitem')).toHaveCount(watchlistItems.length)
})

test('marks one current destination and keeps keyboard navigation usable', async ({ page, context }) => {
  await openAuthenticatedPage(page, context)

  const catalogLink = page.getByRole('link', {
    name: 'Catalog',
    exact: true
  })

  const watchlistLink = page.getByRole('link', {
    name: 'Watchlist',
    exact: true
  })

  const calendarLink = page.getByRole('link', {
    name: 'Calendar',
    exact: true
  })

  await expect(watchlistLink).toHaveAttribute('aria-current', 'page')
  await expect(catalogLink).not.toHaveAttribute('aria-current')
  await expect(calendarLink).not.toHaveAttribute('aria-current')
  await page.getByRole('button', { name: 'Sign out' }).focus()
  await page.keyboard.press('Tab')
  await expect(catalogLink).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(calendarLink).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(watchlistLink).toBeFocused()

  const outline = await watchlistLink.evaluate(element => globalThis.getComputedStyle(element).outlineStyle)

  expect(outline).not.toBe('none')
  await page.keyboard.press('Tab')

  const firstCardLink = page.getByRole('listitem').first().getByRole('link')
  const firstCard = page.getByRole('listitem').first()

  await expect(firstCardLink).toBeFocused()

  const outlineStyle = await firstCardLink.evaluate(element => globalThis.getComputedStyle(element).outlineStyle)
  const parentOverflow = await firstCard.evaluate(element => globalThis.getComputedStyle(element).overflow)

  expect(outlineStyle).toBe('solid')
  expect(parentOverflow).toBe('visible')
  await catalogLink.click()
  await expect(page).toHaveURL(`${appBaseUrl}/`)
  await expect(catalogLink).toHaveAttribute('aria-current', 'page')
})

test('keeps the current destination visible in forced colors', async ({ page, context }) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await openAuthenticatedPage(page, context)

  const catalogLink = page.getByRole('link', {
    name: 'Catalog',
    exact: true
  })

  const watchlistLink = page.getByRole('link', {
    name: 'Watchlist',
    exact: true
  })

  const calendarLink = page.getByRole('link', {
    name: 'Calendar',
    exact: true
  })

  const catalogWeight = Number(await catalogLink.evaluate(element => globalThis.getComputedStyle(element).fontWeight))
  const watchlistWeight = Number(await watchlistLink.evaluate(element => globalThis.getComputedStyle(element).fontWeight))

  expect(watchlistWeight).toBeGreaterThan(catalogWeight)
  await expect(calendarLink).not.toHaveAttribute('aria-current')
  await expect(watchlistLink).toHaveCSS('text-decoration-line', 'underline')
})

test('keeps slow and missing poster states inside their cards', async ({ page, context }) => {
  await page.route('**/posters/dune-2021.webp', async (route) => {
    // oxlint-disable-next-line promise/avoid-new -- The placeholder must remain visible during a slow poster response.
    await new Promise(resolve => { globalThis.setTimeout(resolve, 600) })

    await route.continue()
  })

  await openAuthenticatedPage(page, context, '/')

  await page.getByRole('link', {
    name: 'Watchlist',
    exact: true
  }).click()

  await expect(page.getByText('Loading poster…')).toBeVisible()
  await expect(page.getByAltText('Dune poster')).toBeVisible()
  await expect(page.getByText('No poster available')).toHaveCount(3)
})

test('preserves watchlist proxy status, cookies, and no-store responses', async ({ context }) => {
  const anonymous = await context.request.get('/api/catalog/watchlist')

  expect(anonymous.status()).toBe(401)
  expect(anonymous.headers()['cache-control']).toBe('no-store')
  await addCookie(context, 'tv_session', 'e2e-session')

  const authenticated = await context.request.get('/api/catalog/watchlist')

  expect(authenticated.status()).toBe(200)
  expect(authenticated.headers()['cache-control']).toBe('no-store')
  await addCookie(context, 'fail_watchlist', '1')

  const failed = await context.request.get('/api/catalog/watchlist')

  expect(failed.status()).toBe(503)
  expect(failed.headers()['cache-control']).toBe('no-store')
  expect(failed.headers()['set-cookie']).toContain('fail_watchlist=; Max-Age=0;')
})
