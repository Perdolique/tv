/* oxlint-disable eslint/max-lines -- Calendar browser contracts share one end-to-end service harness. */
import type { BrowserContext, Page, Response } from '@playwright/test'
import { appBaseUrl } from '../constants.ts'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie, getRedirectLocation } from '../helpers.ts'
import { waitForHydration } from '../catalog/helpers.ts'

const FIXED_NOW = new Date('2026-09-12T10:00:00.000Z')
const TODAY = '2026-09-12'

async function openCalendar(
  page: Page,
  context: BrowserContext,
  target = `/calendar?date=${TODAY}`
): Promise<Response | null> {
  await page.clock.setFixedTime(FIXED_NOW)
  await addCookie(context, 'tv_session', 'e2e-session')

  const response = await page.goto(target)

  await waitForHydration(page)
  await expect(page.getByRole('heading', { name: 'Release calendar' })).toBeVisible()

  return response
}

function observeReleaseRequests(page: Page): URL[] {
  const requests: URL[] = []

  page.on('request', (request) => {
    const url = new URL(request.url())

    if (url.pathname === '/api/catalog/releases') {
      requests.push(url)
    }
  })

  return requests
}

const failedCalendarTest = test.extend({ expectedHttpErrors: { values: [
  {
      pathname: '/api/catalog/releases',
      status: 503
    },
  {
      pathname: '/api/catalog/releases',
      status: 503
    }
] } })

const singleFailedCalendarTest = test.extend({ expectedHttpErrors: { values: [{
  pathname: '/api/catalog/releases',
  status: 503
}] } })

const expiredCalendarTest = test.extend({ expectedHttpErrors: { values: [{
  pathname: '/api/catalog/releases',
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

test('redirects a guest through sign in and returns to the full calendar URL', async ({ page, context }) => {
  await page.clock.setFixedTime(FIXED_NOW)

  const target = '/calendar?date=2026-09-13'
  const response = await context.request.get(target, { maxRedirects: 0 })
  const location = getRedirectLocation(response)

  expect(response.status()).toBe(302)
  expect(location.pathname).toBe('/sign-in')
  expect(location.searchParams.get('redirectTo')).toBe(target)
  await page.goto(target)
  await expect(page).toHaveURL(`${appBaseUrl}/sign-in?redirectTo=/calendar?date=2026-09-13`)
  await page.getByLabel('Email').fill('viewer@example.com')
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(`${appBaseUrl}${target}`)
  await expect(page.getByRole('list', { name: 'Releases for selected day' }).getByRole('listitem')).toHaveCount(2)
})

// oxlint-disable-next-line vitest/prefer-each -- Playwright's test API does not expose test.each.
for (const [target, expectedDate] of [
  ['/calendar', TODAY],
  ['/calendar?date=broken', TODAY],
  ['/calendar?date=2026-09-11', TODAY]
] as const) {
  test(`canonicalizes ${target} to the local current date`, async ({ page, context }) => {
    const historyLength = await page.evaluate(() => globalThis.history.length)

    await openCalendar(page, context, target)
    await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=${expectedDate}`)
    await expect(page.locator('button[aria-current="date"]').last()).toHaveAttribute('aria-pressed', 'true')
    expect(await page.evaluate(() => globalThis.history.length)).toBe(historyLength + 1)
  })
}

test('refreshes browser-local today after midnight without remounting', async ({ page, context }) => {
  const releaseRequests = observeReleaseRequests(page)

  await openCalendar(page, context)

  const historyLength = await page.evaluate(() => globalThis.history.length)

  await page.clock.setFixedTime(new Date('2026-09-13T10:00:00.000Z'))
  await page.evaluate(() => { globalThis.dispatchEvent(new Event('focus')) })
  await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=2026-09-13`)
  await expect.poll(() => releaseRequests.map(request => request.searchParams.get('from'))).toContain('2026-09-13')
  expect(await page.evaluate(() => globalThis.history.length)).toBe(historyLength)
  await expect(page.locator('button[aria-current="date"]').last()).toHaveAccessibleName(/Sunday, September 13, 2026/u)
})

test('renders the maximum supported calendar year without overflowing the URL contract', async ({ page, context }) => {
  await openCalendar(page, context, '/calendar?date=9999-12-31')

  const calendarDays = page.getByRole('group', { name: 'Calendar days' })

  await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=9999-12-31`)
  await expect(calendarDays.getByRole('button')).toHaveCount(42)
  await expect(calendarDays.locator('button[aria-pressed="true"]')).toHaveAccessibleName(/December 31, 9999/u)
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled()
})

test('requests exact month ranges and keeps push navigation in browser history', async ({ page, context }) => {
  const releaseRequests = observeReleaseRequests(page)
  const currentRequestPromise = page.waitForRequest('**/api/catalog/releases?**')

  await openCalendar(page, context)

  const currentRequest = await currentRequestPromise
  const currentUrl = new URL(currentRequest.url())

  await expect(page.getByRole('heading', { name: 'Dune' })).toBeVisible()
  expect(currentUrl.searchParams.get('from')).toBe(TODAY)
  expect(currentUrl.searchParams.get('to')).toBe('2026-09-30')
  await page.getByRole('button', { name: /Sunday, September 13, 2026.*2 releases/u }).click()
  await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=2026-09-13`)
  await expect(page.getByRole('list', { name: 'Releases for selected day' }).getByRole('listitem')).toHaveCount(2)
  expect(releaseRequests).toHaveLength(1)

  await page.getByRole('button', {
    name: 'Today',
    exact: true
  }).click()

  await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=${TODAY}`)
  expect(releaseRequests).toHaveLength(1)

  const futureRequestPromise = page.waitForRequest('**/api/catalog/releases?**')

  await page.getByRole('button', { name: 'Next' }).click()

  const futureRequest = await futureRequestPromise
  const futureUrl = new URL(futureRequest.url())

  await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=2026-10-12`)
  await expect(page.getByText('October 2026', { exact: true })).toBeVisible()
  expect(futureUrl.searchParams.get('from')).toBe('2026-10-01')
  expect(futureUrl.searchParams.get('to')).toBe('2026-10-31')

  await page.getByRole('button', {
    name: 'Today',
    exact: true
  }).click()

  await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=${TODAY}`)
  await page.goBack()
  await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=2026-10-12`)
  await expect(page.getByRole('button', { name: 'Previous' })).toBeEnabled()
  await page.goForward()
  await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=${TODAY}`)
  await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled()
})

test('shows movie, series, nullable metadata, and separate episodes', async ({ page, context }) => {
  await page.setViewportSize({
    height: 1024,
    width: 768
  })

  await openCalendar(page, context)

  const todayList = page.getByRole('list', { name: 'Releases for selected day' })
  const calendarDays = page.getByRole('group', { name: 'Calendar days' })
  const todayButton = calendarDays.locator('button[aria-current="date"]')

  await expect(todayList.getByRole('listitem')).toHaveCount(1)
  await expect(todayButton.locator('[data-type="movie"]')).toHaveText('M')
  await expect(todayList.getByRole('listitem')).toContainText('Movie')
  await expect(todayList.getByRole('listitem')).not.toContainText('·')
  await expect(todayList.getByRole('time')).toHaveAttribute('datetime', TODAY)
  await expect(todayList.getByRole('link')).toHaveAttribute('href', /\/titles\//u)
  await page.getByRole('button', { name: /Sunday, September 13, 2026.*2 releases/u }).click()
  await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=2026-09-13`)

  const episodeRows = page.getByRole('list', { name: 'Releases for selected day' }).getByRole('listitem')

  await expect(episodeRows).toHaveCount(2)
  await expect(episodeRows.nth(0)).toContainText('Series · S2 · E7')
  await expect(episodeRows.nth(1)).toContainText('Series · S2 · E8')

  await expect(calendarDays.getByRole('button', {
    name: /Sunday, September 13, 2026/u
  }).locator('[data-type="episode"]')).toHaveCount(2)

  await expect(episodeRows.getByRole('heading', {
    name: 'Dark',
    exact: true
  })).toHaveCount(2)

  await page.getByRole('button', { name: 'Next' }).click()

  const genericSeriesDay = calendarDays.getByRole('button', {
    name: /Monday, October 5, 2026/u
  })

  await expect(genericSeriesDay.locator('[data-type="series"]')).toHaveText('S')
})

test('defaults mobile to agenda and opens agenda after selecting a day in Month', async ({ page, context }) => {
  await page.setViewportSize({
    height: 844,
    width: 390
  })

  await openCalendar(page, context)

  const calendarDays = page.getByRole('group', { name: 'Calendar days' })

  await expect(page.getByRole('button', { name: 'Agenda' })).toHaveAttribute('aria-pressed', 'true')
  await expect(calendarDays).toBeHidden()
  await page.getByRole('button', { name: 'Month' }).click()
  await expect(calendarDays).toBeVisible()
  await page.getByRole('button', { name: /Sunday, September 13, 2026.*2 releases/u }).click()
  await expect(calendarDays).toBeHidden()
  await expect(page.getByRole('button', { name: 'Agenda' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('list', { name: 'Releases for selected day' }).getByRole('listitem')).toHaveCount(2)
  await expect(page.getByRole('heading', { name: /Sunday, September 13, 2026/u })).toBeFocused()
})

test('keeps empty outcomes visible in mobile Month', async ({ page, context }) => {
  await page.setViewportSize({
    height: 844,
    width: 390
  })

  await openCalendar(page, context)
  await page.getByRole('button', { name: 'Month' }).click()
  await page.getByRole('button', { name: /Monday, September 14, 2026.*0 releases/u }).click()
  await page.getByRole('button', { name: 'Month' }).click()
  await expect(page.getByRole('heading', { name: 'Nothing releases on this day' })).toBeVisible()
  await addCookie(context, 'empty_calendar', '1')
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByRole('heading', { name: 'No upcoming releases this month' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open watchlist' })).toBeVisible()
})

// oxlint-disable-next-line vitest/require-hook -- This is a Playwright test with an expected HTTP error.
singleFailedCalendarTest('keeps a mobile Month error actionable', async ({ page, context }) => {
  await page.setViewportSize({
    height: 844,
    width: 390
  })

  await page.clock.setFixedTime(FIXED_NOW)
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'fail_calendar', '1')
  await page.goto(`/calendar?date=${TODAY}`)
  await expect(page.getByRole('heading', { name: 'Release calendar' })).toBeVisible()
  await page.getByRole('button', { name: 'Month' }).click()
  await expect(page.getByRole('alert')).toHaveText('We couldn’t load your release calendar. Try again.')
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
})

test('shows month and agenda together from tablet and uses one month-grid tab stop', async ({ page, context }) => {
  await page.setViewportSize({
    height: 1024,
    width: 768
  })

  await openCalendar(page, context)

  const calendarDays = page.getByRole('group', { name: 'Calendar days' })
  const agenda = page.getByRole('list', { name: 'Releases for selected day' })
  const todayButton = calendarDays.locator('button[aria-current="date"]')

  await expect(calendarDays).toBeVisible()
  await expect(agenda).toBeVisible()
  await expect(calendarDays.locator('button[tabindex="0"]')).toHaveCount(1)
  await todayButton.focus()
  await page.keyboard.press('ArrowRight')

  const nextDay = calendarDays.getByRole('button', { name: /Sunday, September 13, 2026/u })

  await expect(nextDay).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=2026-09-13`)
  await expect(nextDay).toHaveAttribute('aria-pressed', 'true')
})

test('distinguishes empty days and empty months', async ({ page, context }) => {
  await page.setViewportSize({
    height: 1024,
    width: 768
  })

  await openCalendar(page, context)
  await page.getByRole('button', { name: /Monday, September 14, 2026.*0 releases/u }).click()
  await expect(page.getByRole('heading', { name: 'Nothing releases on this day' })).toBeVisible()
  await addCookie(context, 'empty_calendar', '1')
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByRole('heading', { name: 'No upcoming releases this month' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open watchlist' })).toHaveAttribute('href', '/watchlist')
})

test('keeps grid and agenda geometry while a client month request loads', async ({ page, context }) => {
  await page.setViewportSize({
    height: 1024,
    width: 768
  })

  await page.clock.setFixedTime(FIXED_NOW)
  await addCookie(context, 'tv_session', 'e2e-session')
  await page.goto('/')
  await waitForHydration(page)
  await addCookie(context, 'slow_calendar', '1')

  await page.getByRole('link', {
    name: 'Calendar',
    exact: true
  }).click()

  await expect(page.getByRole('status', { name: 'Loading month' }).locator(':scope > div')).toHaveCount(42)
  await expect(page.getByRole('status', { name: 'Loading agenda' }).locator(':scope > div')).toHaveCount(3)
  await expect(page.getByRole('group', { name: 'Calendar days' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dune' })).toBeVisible()
})

// oxlint-disable-next-line vitest/require-hook -- This is a Playwright test with expected HTTP errors.
failedCalendarTest('shows a safe error and restores focus across retry outcomes', async ({ page, context }) => {
  await page.setViewportSize({
    height: 1024,
    width: 768
  })

  await page.clock.setFixedTime(FIXED_NOW)
  await addCookie(context, 'tv_session', 'e2e-session')
  await page.goto('/')
  await waitForHydration(page)
  await addCookie(context, 'fail_calendar', '2')

  await page.getByRole('link', {
    name: 'Calendar',
    exact: true
  }).click()

  const alert = page.getByRole('alert')
  const retryButton = page.getByRole('button', { name: 'Try again' })

  await expect(alert).toHaveText('We couldn’t load your release calendar. Try again.')
  await expect(alert).not.toContainText('database')
  await retryButton.click()
  await expect(retryButton).toBeFocused()
  await retryButton.click()
  await expect(page.getByRole('heading', { name: 'Release calendar' })).toBeFocused()
  await expect(page.getByRole('group', { name: 'Calendar days' })).toBeVisible()
})

// oxlint-disable-next-line vitest/require-hook -- This is a Playwright test with expected session errors.
failedSessionTest('retries a calendar session failure and restores focus', async ({ page, context }) => {
  await page.clock.setFixedTime(FIXED_NOW)
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'fail_session', '2')
  await page.goto(`/calendar?date=${TODAY}`)
  await expect(page.getByRole('heading', { name: 'We couldn’t verify your session.' })).toBeVisible()

  const retryButton = page.getByRole('button', { name: 'Try again' })

  await retryButton.click()
  await expect(retryButton).toBeFocused()
  await expect(retryButton).toBeEnabled()
  await retryButton.click()
  await expect(page.getByRole('heading', { name: 'Release calendar' })).toBeFocused()
  await expect(page.getByRole('heading', { name: 'Dune' })).toBeVisible()
})

test('redirects after signing out of the protected calendar', async ({ page, context }) => {
  await openCalendar(page, context)

  const historyLength = await page.evaluate(() => globalThis.history.length)

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(`${appBaseUrl}/sign-in?redirectTo=/calendar?date=${TODAY}`)
  await expect(page.getByRole('list', { name: 'Releases for selected day' })).toHaveCount(0)
  expect(await page.evaluate(() => globalThis.history.length)).toBe(historyLength)
})

// oxlint-disable-next-line vitest/require-hook -- This is a Playwright test with an expected HTTP error.
expiredCalendarTest('clears private releases after a late 401 and returns after sign in', async ({ page, context }) => {
  await page.clock.setFixedTime(FIXED_NOW)
  await addCookie(context, 'tv_session', `e2e-expiring-${crypto.randomUUID()}`)
  await page.goto('/')
  await waitForHydration(page)
  await addCookie(context, 'expire_calendar', '1')

  const historyLength = await page.evaluate(() => globalThis.history.length)

  await page.getByRole('link', {
    name: 'Calendar',
    exact: true
  }).click()

  await expect(page).toHaveURL(`${appBaseUrl}/sign-in?redirectTo=/calendar?date=${TODAY}`)
  await expect(page.getByRole('list', { name: 'Releases for selected day' })).toHaveCount(0)
  expect(await page.evaluate(() => globalThis.history.length)).toBe(historyLength + 1)
  await context.clearCookies({ name: 'expire_calendar' })
  await page.getByLabel('Email').fill('viewer@example.com')
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=${TODAY}`)
  await expect(page.getByRole('heading', { name: 'Dune' })).toBeVisible()
})

test('preserves calendar page and proxy no-store responses', async ({ page, context }) => {
  const pageResponse = await openCalendar(page, context)

  expect(pageResponse?.headers()['cache-control']).toBe('private, no-store')

  await expect(page.getByRole('link', {
    name: 'Calendar',
    exact: true
  })).toHaveAttribute('aria-current', 'page')

  const releases = await context.request.get(`/api/catalog/releases?from=${TODAY}&to=2026-09-30`)

  expect(releases.status()).toBe(200)
  expect(releases.headers()['cache-control']).toBe('no-store')
})
