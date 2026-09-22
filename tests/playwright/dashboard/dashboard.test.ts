import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie, getRedirectLocation } from '../helpers.ts'
import { dune, chernobyl } from '../catalog/details.fixtures.ts'
import { waitForHydration } from '../catalog/helpers.ts'
import { longEmail } from '../auth/constants.ts'
import { appBaseUrl } from '../constants.ts'

async function signIn(page: Page, email = 'viewer@example.com'): Promise<void> {
  await waitForHydration(page)
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple')

  await page.getByRole('button', {
    name: 'Sign in',
    exact: true
  }).click()
}

function marks(page: Page) {
  return page.getByRole('list', {
    name: 'Watched marks',
    exact: true
  }).getByRole('listitem')
}

function trackViewingRequests(page: Page): string[] {
  const privateRequests: string[] = []

  page.on('request', request => {
    if (request.url().includes('/api/catalog/viewing-')) {
      privateRequests.push(request.url())
    }
  })

  return privateRequests
}

test('redirects a guest through sign in to an empty private dashboard', async ({ page, context }) => {
  const response = await context.request.get('/dashboard', { maxRedirects: 0 })
  const location = getRedirectLocation(response)

  expect(response.status()).toBe(302)
  expect(location.searchParams.get('redirectTo')).toBe('/dashboard')
  await page.goto('/dashboard')
  await signIn(page)
  await expect(page).toHaveURL(`${appBaseUrl}/dashboard`)
  await expect(page.getByRole('heading', { name: 'Nothing marked as watched yet' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Browse catalog' })).toHaveAttribute('href', '/')

  await expect(page.getByRole('link', {
    name: 'Dashboard',
    exact: true
  })).toHaveAttribute('aria-current', 'page')

  await expect(page.locator('dd')).toHaveText(['0', '0'])
})

test('uses movie and episode marks, refreshes after removal, and isolates accounts after sign in', async ({ page, context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await page.goto(`/titles/${dune.id}`)

  const movieButton = page.getByRole('button', {
    name: 'Watched',
    exact: true
  })

  await movieButton.click()
  await expect(movieButton).toHaveAttribute('aria-pressed', 'true')
  await expect(movieButton).toBeEnabled()
  await page.goto(`/titles/${chernobyl.id}`)

  const episode = page.getByRole('listitem').filter({ hasText: 'Please Remain Calm' })

  const button = episode.getByRole('button', {
    name: 'Watched',
    exact: true
  })

  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect(button).toBeEnabled()

  await page.getByRole('link', {
    name: 'Dashboard',
    exact: true
  }).click()

  await expect(marks(page)).toHaveCount(2)
  await expect(page.locator('dd')).toHaveText(['1', '1'])
  await expect(marks(page).first()).toContainText('Episode · S1 · E2')
  await expect(marks(page).first()).toContainText('Please Remain Calm')
  await expect(page.getByRole('list', { name: 'Watched episodes by series' })).toContainText('1 episode watched')
  await expect(marks(page).last()).toContainText('Movie · 2021')
  await expect(marks(page).last()).toContainText('Marked')

  const response = await page.reload()

  expect(response?.headers()['cache-control']).toBe('private, no-store')
  await expect(marks(page)).toHaveCount(2)
  await marks(page).last().getByRole('link').click()
  await movieButton.click()
  await expect(movieButton).toHaveAttribute('aria-pressed', 'false')
  await expect(movieButton).toBeEnabled()

  await page.getByRole('link', {
    name: 'Dashboard',
    exact: true
  }).click()

  await expect(marks(page)).toHaveCount(1)
  await expect(page.locator('dd')).toHaveText(['0', '1'])
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(`${appBaseUrl}/sign-in?redirectTo=/dashboard`)
  await signIn(page, longEmail)
  await expect(page).toHaveURL(`${appBaseUrl}/dashboard`)
  await expect(page.locator('dd')).toHaveText(['0', '0'])
  await expect(marks(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await signIn(page)
  await expect(marks(page)).toHaveCount(1)
  await expect(page.locator('dd')).toHaveText(['0', '1'])
})

test('server renders the first page without duplicate hydration requests and loads older marks by keyboard', async ({ page, context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'paginated_viewing', '1')

  const privateRequests = trackViewingRequests(page)
  const response = await page.goto('/dashboard')
  const html = await response?.text()

  expect(html).toContain('Episode 25')
  await waitForHydration(page)
  expect(privateRequests).toStrictEqual([])
  await expect(marks(page)).toHaveCount(20)

  const button = page.getByRole('button', { name: 'Load more' })

  await button.focus()
  await page.keyboard.press('Enter')
  await expect(marks(page)).toHaveCount(25)
  await expect(marks(page).nth(20).getByRole('link')).toBeFocused()
  await expect(button).toHaveCount(0)

  await expect(page.getByRole('region', {
    name: 'Viewing history',
    exact: true
  }).getByRole('status')).toHaveText('5 older marks added.')

  await expect(marks(page).last()).toContainText('Episode 1')
})

test('shows loading feedback on client navigation and keeps the four destinations keyboard accessible', async ({ page, context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'paginated_viewing', '1')
  await page.goto('/')
  await waitForHydration(page)
  await addCookie(context, 'slow_viewing', '1')

  await page.getByRole('link', {
    name: 'Dashboard',
    exact: true
  }).click()

  await expect(page.getByRole('region', { name: 'Loading viewing history' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Loading viewing summary' })).toBeVisible()
  await expect(marks(page)).toHaveCount(20)

  await page.getByRole('link', {
    name: 'Catalog',
    exact: true
  }).focus()

  await page.keyboard.press('Tab')

  await expect(page.getByRole('link', {
    name: 'Calendar',
    exact: true
  })).toBeFocused()

  await page.keyboard.press('Tab')

  await expect(page.getByRole('link', {
    name: 'Watchlist',
    exact: true
  })).toBeFocused()

  await page.keyboard.press('Tab')

  await expect(page.getByRole('link', {
    name: 'Dashboard',
    exact: true
  })).toBeFocused()
})

const failedMoreTest = test.extend({ expectedHttpErrors: { values: [{
  pathname: '/api/catalog/viewing-history',
  status: 503
}] } })

// oxlint-disable-next-line vitest/require-hook -- Playwright fixture declares the expected service failure.
failedMoreTest('retains visible marks after a failed continuation and retries with usable focus', async ({ page, context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'paginated_viewing', '1')
  await page.goto('/dashboard')
  await addCookie(context, 'fail_viewing_more', '1')

  const button = page.getByRole('button', { name: 'Load more' })

  await button.click()
  await expect(page.getByRole('alert')).toHaveText('We couldn’t load older marks. Try again.')
  await expect(marks(page)).toHaveCount(20)
  await expect(button).toBeFocused()
  await button.click()
  await expect(marks(page)).toHaveCount(25)
  await expect(marks(page).nth(20).getByRole('link')).toBeFocused()
})

const failedSummaryTest = test.extend({ expectedHttpErrors: { values: [{
  pathname: '/api/catalog/viewing-summary',
  status: 503
}] } })

// oxlint-disable-next-line vitest/require-hook -- Playwright fixture declares the expected service failure.
failedSummaryTest('recovers the summary independently while history remains usable', async ({ page, context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'paginated_viewing', '1')
  await page.goto('/')
  await addCookie(context, 'fail_viewing_summary', '1')

  await page.getByRole('link', {
    name: 'Dashboard',
    exact: true
  }).click()

  await expect(marks(page)).toHaveCount(20)
  await expect(page.getByRole('alert')).toHaveText('We couldn’t load your viewing summary. Try again.')
  await page.getByRole('button', { name: 'Retry summary' }).click()
  await expect(page.locator('dd')).toHaveText(['0', '25'])

  await expect(page.getByRole('heading', {
    name: 'Dashboard',
    exact: true
  })).toBeFocused()

  await expect(marks(page)).toHaveCount(20)
})

const expiredTest = test.extend({ expectedHttpErrors: { values: [{
  pathname: '/api/catalog/viewing-history',
  status: 401
}] } })

// oxlint-disable-next-line vitest/require-hook -- Playwright fixture declares the expected expired session.
expiredTest('clears the whole dashboard when a continuation reports an expired session', async ({ page, context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'paginated_viewing', '1')
  await page.goto('/dashboard')
  await addCookie(context, 'expire_viewing', '1')
  await page.getByRole('button', { name: 'Load more' }).click()
  await expect(page).toHaveURL(`${appBaseUrl}/sign-in?redirectTo=/dashboard`)
  await expect(marks(page)).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Watched episodes by series' })).toHaveCount(0)
  await expect(page.locator('dd')).toHaveCount(0)
})

const failedHistoryTest = test.extend({ expectedHttpErrors: { values: [{
  pathname: '/api/catalog/viewing-history',
  status: 503
}] } })

// oxlint-disable-next-line vitest/require-hook -- Playwright fixture declares the expected history failure.
failedHistoryTest('recovers initial history while keeping the summary visible', async ({ page, context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'paginated_viewing', '1')
  await page.goto('/')
  await addCookie(context, 'fail_viewing_history', '1')

  await page.getByRole('link', {
    name: 'Dashboard',
    exact: true
  }).click()

  await expect(page.locator('dd')).toHaveText(['0', '25'])
  await expect(page.getByRole('alert')).toHaveText('We couldn’t load your viewing history. Try again.')
  await page.getByRole('button', { name: 'Retry history' }).click()
  await expect(marks(page)).toHaveCount(20)

  await expect(page.getByRole('heading', {
    name: 'Viewing history',
    exact: true
  })).toBeFocused()
})

const failedSessionTest = test.extend({ expectedHttpErrors: { values: [{
  pathname: '/api/auth/session',
  status: 503
}] } })

// oxlint-disable-next-line vitest/require-hook -- Playwright fixture declares the expected session failure.
failedSessionTest('retries a failed session check without treating it as an empty dashboard', async ({ page, context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'fail_session', '1')
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: 'We couldn’t verify your session.' })).toBeVisible()
  await expect(page.locator('dd')).toHaveCount(0)
  await page.getByRole('button', { name: 'Try again' }).click()

  await expect(page.getByRole('heading', {
    name: 'Dashboard',
    exact: true
  })).toBeFocused()

  await expect(page.locator('dd')).toHaveText(['0', '0'])
})

test('keeps a slow poster inside its row and shows the movie-only series state', async ({ page, context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'tv_watched_item', dune.id)

  const pending = Promise.withResolvers<boolean>()

  await page.route('**/posters/dune-2021.webp', async route => {
    await pending.promise

    const response = await route.fetch()

    await route.fulfill({ response })
  })

  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Loading poster…')).toBeVisible()

  const before = await marks(page).first().boundingBox()

  pending.resolve(true)
  await expect(page.getByAltText('Dune poster')).toHaveCSS('opacity', '1')

  const after = await marks(page).first().boundingBox()

  expect(after).toStrictEqual(before)
  await expect(page.getByText('No episodes marked as watched yet.')).toBeVisible()
  await expect(page.locator('dd')).toHaveText(['1', '0'])
})
