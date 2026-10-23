import type { BrowserContext, Page } from '@playwright/test'
import * as v from 'valibot'
import { authSessionResponseSchema } from '../../../apps/web/app/utils/auth-response.ts'
import { appBaseUrl } from '../constants.ts'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { waitForHydration } from './helpers.ts'

async function openCatalog(page: Page, context: BrowserContext, target = '/'): Promise<void> {
  await addCookie(context, 'tv_session', 'e2e-session')
  await page.goto(target)
  await waitForHydration(page)
  await expect(page.getByRole('heading', { name: 'Your catalog starts here.' })).toBeVisible()
}

async function search(page: Page, query: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Search movies and series' }).fill(query)
  await page.getByRole('textbox', { name: 'Search movies and series' }).press('Enter')
}

const failedSearchTest = test.extend({ expectedHttpErrors: { values: [{
  pathname: '/api/catalog/search',
  status: 503
}, {
  pathname: '/api/catalog/search',
  status: 503
}, {
  pathname: '/api/catalog/search',
  status: 503
}] } })

test('lets guests search a direct URL and keeps authentication links available', async ({ page }) => {
  await page.goto('/?query=Dark')
  await waitForHydration(page)
  await expect(page.getByRole('textbox', { name: 'Search movies and series' })).toHaveValue('Dark')
  await expect(page.getByRole('region', { name: 'Search results' }).getByRole('listitem')).toHaveCount(2)

  await expect(page.getByRole('link', {
    name: 'Sign in',
    exact: true
  })).toHaveAttribute('href', '/sign-in?redirectTo=/?query=Dark')

  await expect(page.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/register?redirectTo=/?query=Dark')
})

test('searches partial and case-insensitive titles, preserves other URL parameters, and clears immediately', async ({ page, context }) => {
  await openCatalog(page, context, '/?source=home')

  const sessionRequests: string[] = []

  page.on('request', request => {
    sessionRequests.push(request.url())
  })

  const historyLength = await page.evaluate(() => globalThis.history.length)

  await page.getByRole('textbox', { name: 'Search movies and series' }).fill('  dAr  ')
  await expect(page.getByRole('listitem')).toHaveCount(2)

  await expect(page.getByRole('heading', {
    name: 'Dark',
    exact: true
  })).toBeVisible()

  await expect(page.getByRole('listitem').filter({ hasText: 'Dark City' })).toHaveText('Dark CityMovie')
  await expect(page.getByText('Series · 2017')).toBeVisible()
  await expect(page).toHaveURL(`${appBaseUrl}/?source=home&query=dAr`)
  expect(sessionRequests.filter(url => url.includes('/api/auth/session'))).toStrictEqual([])
  expect(await page.evaluate(() => globalThis.history.length)).toBe(historyLength)
  await search(page, 'Arrival')
  await expect(page.getByRole('listitem')).toHaveText(['ArrivalMovie · 2016'])
  await search(page, 'nothing matches')
  await expect(page.getByRole('heading', { name: 'No titles found' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(page.getByRole('textbox')).toBeFocused()
  await expect(page.getByRole('listitem')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Discover titles' })).toBeVisible()
  await expect(page).toHaveURL(`${appBaseUrl}/?source=home`)
})

test('waits for IME composition to finish before searching', async ({ page, context }) => {
  await openCatalog(page, context)

  const requests: string[] = []

  page.on('request', (request) => {
    requests.push(request.url())
  })

  const input = page.getByRole('textbox', { name: 'Search movies and series' })

  await input.evaluate((element: HTMLInputElement) => {
    element.value = 'Da'

    element.dispatchEvent(new globalThis.InputEvent('input', {
      bubbles: true,
      data: 'Da',
      inputType: 'insertCompositionText',
      isComposing: true
    }))
  })

  await page.waitForTimeout(350)

  const requestsDuringComposition = requests.filter(url => url.includes('/api/catalog/search'))

  expect(requestsDuringComposition).toStrictEqual([])

  const finalRequest = page.waitForRequest('**/api/catalog/search?query=Dark')

  await input.evaluate((element: HTMLInputElement) => {
    element.value = 'Dark'

    element.dispatchEvent(new globalThis.InputEvent('input', {
      bubbles: true,
      data: 'Dark',
      inputType: 'insertText'
    }))
  })

  await finalRequest

  await expect(page.getByRole('listitem')).toHaveCount(2)

  const catalogRequests = requests.filter(url => url.includes('/api/catalog/search'))

  expect(catalogRequests).toHaveLength(1)
})

test('does not flash loading feedback for fast local responses', async ({ page, context }) => {
  await openCatalog(page, context)

  await page.route('**/api/catalog/search?query=Dune', async (route) => {
    // oxlint-disable-next-line promise/avoid-new -- Controlled latency proves that a 162ms response never flashes loading UI.
    await new Promise(resolve => { globalThis.setTimeout(resolve, 162) })

    await route.fulfill({
      json: {
        items: [{
          id: 'movie-dune',
          originalTitle: 'Dune',
          originalTitleLocale: 'en',
          releaseYear: 2021,
          title: 'Dune',
          titleLocale: 'en',
          type: 'movie'
        }]
      }
    })
  })

  await page.evaluate(() => {
    const { body } = globalThis.document
    const loadingLabels = ['Searching…', 'Updating results…']

    const recordLoadingState = () => {
      const wasSeen = body.dataset.catalogLoadingSeen === 'true'
      const text = body.textContent
      const isVisible = loadingLabels.some(label => text.includes(label))
      const hasBeenVisible = [wasSeen, isVisible].includes(true)

      body.dataset.catalogLoadingSeen = String(hasBeenVisible)
    }

    const observer = new globalThis.MutationObserver(() => {
      recordLoadingState()
    })

    observer.observe(body, {
      childList: true,
      subtree: true,
      characterData: true
    })

    recordLoadingState()
  })

  await page.getByRole('textbox', { name: 'Search movies and series' }).fill('Dune')
  await expect(page.getByRole('listitem')).toHaveText(['DuneMovie · 2021'])
  await expect(page.locator('body')).toHaveAttribute('data-catalog-loading-seen', 'false')
})

test('renders a direct search on the server, hydrates without fetching again, reloads and signs out', async ({ page, context }) => {
  const browserSearches: string[] = []

  page.on('request', request => {
    browserSearches.push(request.url())
  })

  await openCatalog(page, context, '/?query=Dark')
  await expect(page.getByRole('listitem')).toHaveCount(2)

  const response = await page.reload()
  const html = await response?.text()

  expect(html).toContain('Dark City')
  await expect(page.getByRole('textbox')).toHaveValue('Dark')
  await expect(page.getByRole('listitem')).toHaveCount(2)
  await page.getByRole('textbox').focus()
  expect(browserSearches.filter(url => url.includes('/api/catalog/search'))).toStrictEqual([])
  await page.getByRole('button', { name: 'Sign out' }).click()

  await expect(page.getByRole('link', {
    name: 'Sign in',
    exact: true
  })).toBeVisible()

  await expect(page).toHaveURL(`${appBaseUrl}/?query=Dark`)
  await expect(page.getByRole('listitem')).toHaveCount(2)
})

test('shows first-load skeletons and keeps the previous list while updating', async ({ page, context }) => {
  await openCatalog(page, context)
  await addCookie(context, 'slow_catalog', '1')
  await search(page, 'Arrival')
  await expect(page.getByRole('region', { name: 'Search results' }).getByRole('status')).toHaveText('Searching…')
  await expect(page.getByRole('region', { name: 'Search results' }).locator('[aria-hidden="true"] > div')).toHaveCount(3)
  await expect(page.getByRole('listitem')).toHaveText(['ArrivalMovie · 2016'])
  await search(page, 'Dark')
  await expect(page.getByRole('region', { name: 'Search results' }).getByRole('status')).toHaveText('Updating results…')
  await expect(page.getByRole('heading', { name: 'Results for “Arrival”' })).toBeVisible()
  await expect(page.getByRole('listitem')).toHaveText(['ArrivalMovie · 2016'])
  await expect(page.getByRole('listitem')).toHaveCount(2)
})

// oxlint-disable-next-line vitest/require-hook -- This is a Playwright test with expected HTTP errors.
failedSearchTest('keeps previous results on an unsafe server error and retries the current query', async ({ page, context }) => {
  await openCatalog(page, context, '/?query=Arrival')
  await addCookie(context, 'fail_catalog', '1')
  await search(page, 'Dark')
  await expect(page.getByRole('alert')).toContainText('We couldn’t search for “Dark”.')
  await expect(page.getByRole('alert')).not.toContainText('database')
  await expect(page.getByRole('region', { name: 'Search results' }).getByRole('status')).toBeEmpty()
  await expect(page.getByRole('listitem')).toHaveText(['ArrivalMovie · 2016'])
  await page.getByRole('textbox').press('Enter')
  await expect(page.getByRole('listitem')).toHaveCount(2)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await addCookie(context, 'fail_catalog', '1')
  await search(page, 'Arrival')
  await expect(page.getByRole('alert')).toContainText('We couldn’t search for “Arrival”.')

  const retryButton = page.getByRole('button', { name: 'Try again' })

  await addCookie(context, 'fail_catalog', '1')

  const failedRetryResponse = page.waitForResponse('**/api/catalog/search?query=Arrival')

  await retryButton.focus()
  await retryButton.press('Enter')

  const response = await failedRetryResponse

  expect(response.status()).toBe(503)
  await response.finished()
  await expect(retryButton).toBeEnabled()
  await expect(retryButton).toBeFocused()
  await expect(page.getByRole('alert')).toContainText('We couldn’t search for “Arrival”.')
  await addCookie(context, 'slow_catalog', '1')
  await retryButton.press('Enter')
  await expect(page.getByRole('heading', { name: 'Results for “Arrival”' })).toBeFocused()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('keeps public search available after its account expires', async ({ page, context }) => {
  await openCatalog(page, context, '/?query=Arrival')
  await context.clearCookies({ name: 'tv_session' })
  await search(page, 'Dark')
  await expect(page).toHaveURL(`${appBaseUrl}/?query=Dark`)
  await expect(page.getByRole('listitem')).toHaveCount(2)
  await page.getByRole('button', { name: 'Clear search' }).click()

  await expect(page.getByRole('link', {
    name: 'Sign in',
    exact: true
  })).toBeVisible()

  await expect(page.getByRole('region', { name: 'Discover titles' })).toBeVisible()
  await expect(page.getByText('viewer@example.com')).toHaveCount(0)
})

test('aborts replaced and cleared requests at the transport layer', async ({ page, context }) => {
  await openCatalog(page, context)
  await addCookie(context, 'slow_catalog', '1')

  const started = page.waitForRequest('**/api/catalog/search?query=Arrival')

  await search(page, 'Arrival')

  const staleRequest = await started
  const aborted = page.waitForEvent('requestfailed', { predicate: request => request === staleRequest })

  await search(page, 'Dark')

  const abortedRequest = await aborted

  expect(abortedRequest.failure()?.errorText).toBe('net::ERR_ABORTED')
  await expect(page.getByRole('listitem')).toHaveCount(2)

  const nextStarted = page.waitForRequest('**/api/catalog/search?query=Arrival')

  await search(page, 'Arrival')

  const nextRequest = await nextStarted
  const cleared = page.waitForEvent('requestfailed', { predicate: request => request === nextRequest })

  await page.getByRole('button', { name: 'Clear search' }).click()

  const clearedRequest = await cleared

  expect(clearedRequest.failure()?.errorText).toBe('net::ERR_ABORTED')
  await expect(page.getByRole('listitem')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Discover titles' })).toBeVisible()
})

test('renders a safe first-search failure on the server without hydration warnings', async ({ page, context }) => {
  await addCookie(context, 'fail_catalog', '1')
  await openCatalog(page, context, '/?query=Dark')
  await expect(page.getByRole('alert')).toHaveText('We couldn’t search for “Dark”. Try again.')
  await expect(page.getByRole('region', { name: 'Search results' }).getByRole('listitem')).toHaveCount(0)
  await context.clearCookies({ name: 'fail_catalog' })
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('listitem')).toHaveCount(2)
})

test('renders public search on the server with an expired account cookie', async ({ context }) => {
  const sessionId = crypto.randomUUID()

  await addCookie(context, 'tv_session', `e2e-expiring-${sessionId}`)
  await addCookie(context, 'expire_catalog', '1')

  const sessionResponse = await context.request.get('/api/auth/session')
  const rawSession: unknown = await sessionResponse.json()
  const session = v.parse(authSessionResponseSchema, rawSession)

  expect(sessionResponse.status()).toBe(200)
  expect(session.user).toBeNull()

  const response = await context.request.get('/?query=Dark', { maxRedirects: 0 })
  const html = await response.text()

  expect(response.status()).toBe(200)
  expect(html).toContain('Dark City')
  expect(html).toContain('Sign in')
  expect(html).not.toContain('viewer@example.com')
})

test('preserves search proxy cookies, status codes and no-store responses', async ({ context }) => {
  const anonymous = await context.request.get('/api/catalog/search?query=Dark')

  expect(anonymous.status()).toBe(200)
  expect(anonymous.headers()['cache-control']).toBe('no-store')
  await addCookie(context, 'tv_session', 'e2e-session')

  const authenticated = await context.request.get('/api/catalog/search?query=Dark')

  expect(authenticated.status()).toBe(200)
  expect(authenticated.headers()['cache-control']).toBe('no-store')
  await addCookie(context, 'fail_catalog', '1')

  const failed = await context.request.get('/api/catalog/search?query=Dark')

  expect(failed.status()).toBe(503)
  expect(failed.headers()['cache-control']).toBe('no-store')
  expect(failed.headers()['set-cookie']).toContain('fail_catalog=; Max-Age=0;')
})

test('restores search when returning with browser history', async ({ page, context }) => {
  await openCatalog(page, context, '/?query=Dark')
  await expect(page.getByRole('listitem')).toHaveCount(2)

  await page.getByRole('link', {
    name: 'Catalog',
    exact: true
  }).click()

  await expect(page).toHaveURL(`${appBaseUrl}/`)
  await expect(page.getByRole('textbox')).toHaveValue('')
  await expect(page.getByRole('listitem')).toHaveCount(0)
  await page.goBack()
  await expect(page.getByRole('textbox')).toHaveValue('Dark')
  await expect(page.getByRole('listitem')).toHaveCount(2)
})
