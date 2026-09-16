/* oxlint-disable eslint/max-lines -- Calendar browser contracts share one end-to-end service harness. */
import type { BrowserContext, Locator, Page, Request, Response } from '@playwright/test'
import { appBaseUrl } from '../constants.ts'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie, getRedirectLocation } from '../helpers.ts'
import { waitForHydration } from '../catalog/helpers.ts'
import { dune } from '../catalog/details.fixtures.ts'

const FIXED_NOW = new Date('2026-09-12T10:00:00.000Z')
const TODAY = '2026-09-12'

test.use({
  locale: 'en-US',
  timezoneId: 'UTC'
})

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

function observeUpcomingReleaseRequests(page: Page): URL[] {
  const requests: URL[] = []

  page.on('request', (request) => {
    const url = new URL(request.url())

    if (url.pathname === '/api/catalog/releases/upcoming') {
      requests.push(url)
    }
  })

  return requests
}

async function disableIntersectionObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class NoopIntersectionObserver {
      readonly root = null
      readonly rootMargin = '0px'
      readonly thresholds = [0]

      disconnect(): void { void this.root }
      observe(): void { void this.root }
      takeRecords(): IntersectionObserverEntry[] {
        void this.root

        return []
      }
      unobserve(): void { void this.root }
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The browser shim deliberately implements the observer methods used by VueUse.
    globalThis.IntersectionObserver = NoopIntersectionObserver as unknown as typeof globalThis.IntersectionObserver
  })
}

async function getVisibleBounds(locator: Locator): Promise<NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>> {
  const bounds = await locator.boundingBox()

  if (bounds === null) {
    throw new Error('Expected a visible calendar element')
  }

  return bounds
}

function isStaleSeptemberReleaseRequest(request: Request): boolean {
  return request.url().includes('/api/catalog/releases')
    && new URL(request.url()).searchParams.get('to') === '2026-09-30'
}

function isOctoberReleaseRequest(request: Request): boolean {
  return request.url().includes('/api/catalog/releases')
    && new URL(request.url()).searchParams.get('to') === '2026-10-31'
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

const failedUpcomingTest = test.extend({ expectedHttpErrors: { values: [
  {
    pathname: '/api/catalog/releases/upcoming',
    status: 503
  },
  {
    pathname: '/api/catalog/releases/upcoming',
    status: 503
  }
] } })

const failedUpcomingPageTest = test.extend({ expectedHttpErrors: { values: [{
  pathname: '/api/catalog/releases/upcoming',
  status: 503
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

test('redirects a guest to sign in with the full Upcoming URL', async ({ page, context }) => {
  await page.clock.setFixedTime(FIXED_NOW)

  const target = '/calendar?view=upcoming'
  const response = await context.request.get(target, { maxRedirects: 0 })
  const location = getRedirectLocation(response)

  expect(response.status()).toBe(302)
  expect(location.pathname).toBe('/sign-in')
  expect(location.searchParams.get('redirectTo')).toBe(target)
  await page.goto(target)
  await expect(page).toHaveURL(`${appBaseUrl}/sign-in?redirectTo=/calendar?view=upcoming`)
})

test('switches Calendar and Upcoming with canonical browser history URLs', async ({ page, context }) => {
  const rangeRequests = observeReleaseRequests(page)
  const upcomingRequests = observeUpcomingReleaseRequests(page)

  await openCalendar(page, context, '/calendar?view=upcoming&date=2026-10-01&month=2026-10')
  await expect(page).toHaveURL(`${appBaseUrl}/calendar?view=upcoming`)
  await expect(page.getByRole('button', { name: 'Upcoming' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Agenda' })).toHaveCount(0)

  await expect(page.getByRole('heading', {
    name: 'Upcoming releases',
    exact: true
  })).toBeVisible()

  await expect(page.getByRole('region', { name: 'Upcoming releases' })).toBeVisible()
  expect(rangeRequests).toHaveLength(0)
  expect(upcomingRequests).toHaveLength(1)
  await page.reload()
  await waitForHydration(page)
  await expect(page).toHaveURL(`${appBaseUrl}/calendar?view=upcoming`)

  await page.getByRole('button', {
    name: 'Calendar',
    exact: true
  }).click()

  await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=${TODAY}`)

  await expect(page.getByRole('button', {
    name: 'Calendar',
    exact: true
  })).toHaveAttribute('aria-pressed', 'true')

  await page.goBack()
  await expect(page).toHaveURL(`${appBaseUrl}/calendar?view=upcoming`)
  await page.goForward()
  await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=${TODAY}`)
})

test('auto-loads every cursor page without bursts and merges split date groups', async ({ page, context }) => {
  const upcomingRequests = observeUpcomingReleaseRequests(page)

  await openCalendar(page, context, '/calendar?view=upcoming')

  const upcomingButton = page.getByRole('button', { name: 'Upcoming' })
  const loadMoreButton = page.getByRole('button', { name: 'Load more releases' })

  await expect(page.getByRole('listitem')).toHaveCount(20)
  await expect(page.getByRole('heading', { name: /Today · Saturday, September 12, 2026/u })).toBeVisible()
  await upcomingButton.focus()
  await loadMoreButton.evaluate(element => { element.scrollIntoView() })
  await expect(page.getByRole('listitem')).toHaveCount(40)
  await loadMoreButton.evaluate(element => { element.scrollIntoView() })
  await expect(page.getByText('That’s all your upcoming releases.')).toBeVisible()
  await expect(page.getByText('20 more releases loaded.')).toHaveCount(1)
  await expect(upcomingButton).toBeFocused()
  await page.waitForTimeout(200)
  expect(upcomingRequests.map(request => request.searchParams.get('cursor'))).toStrictEqual([null, '20', '40'])
  await expect(page.getByRole('listitem')).toHaveCount(60)

  const releaseIds = await page.locator('[data-release-id]').evaluateAll(elements => (
    elements.map(element => element.attributes.getNamedItem('data-release-id')?.value)
  ))

  expect(new Set(releaseIds).size).toBe(60)

  const firstSplitDateHeading = page.getByRole('heading', { name: 'Thursday, October 1, 2026' })
  const secondSplitDateHeading = page.getByRole('heading', { name: 'Thursday, October 22, 2026' })

  await expect(firstSplitDateHeading).toHaveCount(1)
  await expect(secondSplitDateHeading).toHaveCount(1)
  await expect(page.getByRole('list', { name: 'Releases for Thursday, October 1, 2026' }).getByRole('listitem')).toHaveCount(3)
  await expect(page.getByRole('list', { name: 'Releases for Thursday, October 22, 2026' }).getByRole('listitem')).toHaveCount(2)
})

test('manually loads another page and focuses its first new release', async ({ page, context }) => {
  await disableIntersectionObserver(page)
  await openCalendar(page, context, '/calendar?view=upcoming')
  await page.getByRole('button', { name: 'Load more releases' }).click()
  await expect(page.getByRole('listitem')).toHaveCount(40)
  await expect(page.locator('[data-release-id="01991a00-0000-7000-8000-000000000109"] a')).toBeFocused()
  await expect(page.getByRole('button', { name: 'Load more releases' })).toBeVisible()
})

test('keeps Upcoming cards visible while another page loads', async ({ page, context }) => {
  await disableIntersectionObserver(page)
  await openCalendar(page, context, '/calendar?view=upcoming')
  await addCookie(context, 'slow_upcoming', '1')
  await page.getByRole('button', { name: 'Load more releases' }).click()
  await expect(page.getByText('Loading more releases…', { exact: true })).toBeFocused()
  await expect(page.getByRole('listitem')).toHaveCount(20)
  await expect(page.getByRole('listitem')).toHaveCount(40)
  await expect(page.getByRole('button', { name: 'Load more releases' })).toBeVisible()
})

test('shows stable Upcoming loading and empty states', async ({ page, context }) => {
  await page.clock.setFixedTime(FIXED_NOW)
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'slow_upcoming', '1')
  await page.goto('/calendar?view=upcoming')
  await expect(page.getByRole('status', { name: 'Loading upcoming releases' }).locator(':scope > div')).toHaveCount(5)

  await expect(page.getByRole('heading', {
    name: 'Upcoming releases',
    exact: true
  })).toBeVisible()

  await context.clearCookies({ name: 'slow_upcoming' })
  await addCookie(context, 'empty_upcoming', '1')
  await page.reload()
  await waitForHydration(page)
  await expect(page.getByRole('heading', { name: 'No upcoming releases' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open watchlist' })).toHaveAttribute('href', '/watchlist')
})

// oxlint-disable-next-line vitest/require-hook -- This is a Playwright test with expected HTTP errors.
failedUpcomingTest('keeps the initial Upcoming error actionable across retry outcomes', async ({ page, context }) => {
  await page.clock.setFixedTime(FIXED_NOW)
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'fail_upcoming', '2')
  await page.goto('/calendar?view=upcoming')

  const alert = page.getByRole('alert')
  const retryButton = page.getByRole('button', { name: 'Try again' })

  await expect(alert).toHaveText('We couldn’t load your upcoming releases. Try again.')
  await expect(alert).not.toContainText('database')
  await retryButton.click()
  await expect(retryButton).toBeFocused()
  await addCookie(context, 'slow_upcoming', '1')
  await retryButton.click()
  await expect(page.getByRole('status', { name: 'Loading upcoming releases' })).toBeFocused()
  await expect(page.getByRole('heading', { name: 'Release calendar' })).toBeFocused()
  await expect(page.getByRole('listitem')).toHaveCount(20)
})

// oxlint-disable-next-line vitest/require-hook -- This is a Playwright test with an expected HTTP error.
failedUpcomingPageTest('preserves Upcoming cards and retry focus after a load-more error', async ({ page, context }) => {
  await disableIntersectionObserver(page)
  await openCalendar(page, context, '/calendar?view=upcoming')
  await addCookie(context, 'fail_upcoming_more', '1')
  await page.getByRole('button', { name: 'Load more releases' }).click()

  const retryButton = page.getByRole('button', { name: 'Try again' })

  await expect(page.getByRole('listitem')).toHaveCount(20)
  await expect(page.getByText('We couldn’t load more releases. Try again.', { exact: true }).first()).toBeVisible()
  await expect(retryButton).toBeFocused()
  await retryButton.click()
  await expect(page.getByRole('listitem')).toHaveCount(40)
  await expect(page.locator('[data-release-id="01991a00-0000-7000-8000-000000000109"] a')).toBeFocused()
})

// oxlint-disable-next-line vitest/prefer-each -- Playwright's test API does not expose test.each.
for (const [target, expectedDate] of [
  ['/calendar', TODAY],
  ['/calendar?date=broken', TODAY],
  ['/calendar?date=2026-09-11', TODAY],
  ['/calendar?month=broken', TODAY],
  ['/calendar?month=2026-08', TODAY]
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

  const calendarDays = page.getByRole('grid', { name: 'Calendar days' })

  await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=9999-12-31`)
  await expect(calendarDays.getByRole('button')).toHaveCount(42)
  await expect(calendarDays.getByRole('row')).toHaveCount(7)
  await expect(calendarDays.getByRole('columnheader')).toHaveCount(7)
  await expect(calendarDays.locator('button[aria-pressed="true"]')).toHaveAccessibleName(/December 31, 9999/u)
  await expect(page.getByRole('button', { name: 'Next month' })).toBeDisabled()
})

test('reuses current-month releases while selecting another day and Today', async ({ page, context }) => {
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
})

test('loads a future month and keeps push navigation in browser history', async ({ page, context }) => {
  await openCalendar(page, context)

  const futureRequestPromise = page.waitForRequest(isOctoberReleaseRequest)

  await page.getByRole('button', { name: 'Next month' }).click()

  const futureRequest = await futureRequestPromise
  const futureUrl = new URL(futureRequest.url())

  await expect(page).toHaveURL(`${appBaseUrl}/calendar?month=2026-10`)
  await expect(page.getByLabel('Month navigation').getByText('October 2026', { exact: true })).toBeVisible()

  const futureItems = page.getByRole('list', { name: 'Releases in October 2026' }).getByRole('listitem')
  const calendarDays = page.getByRole('grid', { name: 'Calendar days' })

  await expect(calendarDays.locator('button[aria-pressed="true"]')).toHaveCount(0)
  await expect(calendarDays.locator('button[tabindex="0"]')).toHaveCount(1)
  await expect(futureItems).toHaveCount(23)
  await expect(futureItems.getByRole('heading', { name: 'American Horror Story' })).toHaveCount(10)
  await expect(futureItems.nth(0)).toContainText('Series · S13 · E4')
  expect(futureUrl.searchParams.get('from')).toBe('2026-10-01')
  expect(futureUrl.searchParams.get('to')).toBe('2026-10-31')

  await page.getByRole('button', {
    name: 'Today',
    exact: true
  }).click()

  await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=${TODAY}`)
  await page.goBack()
  await expect(page).toHaveURL(`${appBaseUrl}/calendar?month=2026-10`)
  await expect(calendarDays.locator('button[aria-pressed="true"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Previous month' })).toBeEnabled()
  await page.goForward()
  await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=${TODAY}`)
  await expect(page.getByRole('button', { name: 'Previous month' })).toBeDisabled()
})

test('opens today when the top Calendar mode is already active', async ({ page, context }) => {
  await openCalendar(page, context, '/calendar?month=2026-10')

  await page.getByRole('button', {
    name: 'Calendar',
    exact: true
  }).click()

  await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=${TODAY}`)
  await expect(page.locator('button[aria-current="date"]').last()).toHaveAttribute('aria-pressed', 'true')
})

test('shows movie, series, nullable metadata, and separate episodes', async ({ page, context }) => {
  await page.setViewportSize({
    height: 1024,
    width: 768
  })

  await openCalendar(page, context)

  const todayList = page.getByRole('list', { name: 'Releases for selected day' })
  const calendarDays = page.getByRole('grid', { name: 'Calendar days' })
  const todayButton = calendarDays.locator('button[aria-current="date"]')

  await expect(todayList.getByRole('listitem')).toHaveCount(1)
  await expect(todayButton.locator('[data-type="movie"]')).toHaveText('M')
  await expect(todayList.getByRole('listitem')).toContainText('Movie')
  await expect(todayList.getByRole('listitem')).not.toContainText('·')

  const movieCue = todayList.locator('[data-type="movie"]')

  await expect(movieCue).toHaveCount(1)

  const movieRadius = await movieCue.evaluate(element => globalThis.getComputedStyle(element).borderRadius)

  await expect(todayList.getByRole('time')).toHaveAttribute('datetime', TODAY)
  await expect(todayList.getByRole('link')).toHaveAttribute('href', /\/titles\//u)
  await page.getByRole('button', { name: /Sunday, September 13, 2026.*2 releases/u }).click()
  await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=2026-09-13`)

  const episodeRows = page.getByRole('list', { name: 'Releases for selected day' }).getByRole('listitem')

  await expect(episodeRows).toHaveCount(2)
  await expect(episodeRows.nth(0)).toContainText('Series · S2 · E7')
  await expect(episodeRows.nth(1)).toContainText('Series · S2 · E8')

  const episodeCue = episodeRows.nth(0).locator('[data-type="episode"]')

  await expect(episodeCue).toHaveCount(1)

  const episodeRadius = await episodeCue.evaluate(element => globalThis.getComputedStyle(element).borderRadius)

  expect(episodeRadius).not.toBe(movieRadius)

  await expect(calendarDays.getByRole('button', {
    name: /Sunday, September 13, 2026/u
  }).locator('[data-type="episode"]')).toHaveCount(2)

  await expect(episodeRows.getByRole('heading', {
    name: 'Dark',
    exact: true
  })).toHaveCount(2)

  await page.getByRole('button', { name: 'Next month' }).click()
  await expect(page.getByLabel('Month navigation').getByText('October 2026', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Next month' }).click()
  await expect(page.getByLabel('Month navigation').getByText('November 2026', { exact: true })).toBeVisible()

  const genericSeriesDay = calendarDays.getByRole('button', {
    name: /Friday, November 20, 2026/u
  })

  await expect(genericSeriesDay.locator('[data-type="series"]')).toHaveText('S')
  await expect(genericSeriesDay.locator('[data-type="movie"]')).toHaveText('M')
  await genericSeriesDay.click()

  const genericSeriesCue = page.getByRole('list', { name: 'Releases for selected day' }).locator('[data-type="series"]')
  const genericSeriesBounds = await getVisibleBounds(genericSeriesCue)

  expect(genericSeriesBounds.width).toBeGreaterThan(genericSeriesBounds.height)
})

test('opens the exact catalog title from a calendar release', async ({ page, context }) => {
  await openCalendar(page, context)

  const duneLink = page.getByRole('list', { name: 'Releases for selected day' }).getByRole('link', {
    name: /Dune/u
  })

  await expect(duneLink).toHaveAttribute('href', `/titles/${dune.id}`)
  await duneLink.click()
  await expect(page).toHaveURL(`${appBaseUrl}/titles/${dune.id}`)

  await expect(page.getByRole('heading', {
    name: 'Dune',
    exact: true
  })).toBeVisible()
})

test('defaults mobile to Agenda and keeps Month open after selecting a day', async ({ page, context }) => {
  await page.setViewportSize({
    height: 844,
    width: 390
  })

  await openCalendar(page, context)

  const calendarDays = page.getByRole('grid', { name: 'Calendar days' })
  const selectedWeek = page.getByRole('group', { name: 'Selected week' })

  await expect(page.getByRole('button', {
    name: 'Agenda',
    exact: true
  })).toHaveAttribute('aria-pressed', 'true')

  await expect(selectedWeek).toBeVisible()
  await expect(calendarDays).toBeHidden()

  await page.getByRole('button', {
    name: 'Month',
    exact: true
  }).click()

  await expect(selectedWeek).toBeHidden()
  await expect(calendarDays).toBeVisible()

  const selectedDay = page.getByRole('button', { name: /Sunday, September 13, 2026.*2 releases/u })

  await selectedDay.click()
  await expect(calendarDays).toBeVisible()

  await expect(page.getByRole('button', {
    name: 'Agenda',
    exact: true
  })).toHaveAttribute('aria-pressed', 'false')

  await expect(page.getByRole('button', {
    name: 'Month',
    exact: true
  })).toHaveAttribute('aria-pressed', 'true')

  await expect(page.getByRole('list', { name: 'Releases for selected day' }).getByRole('listitem')).toHaveCount(2)
  await expect(selectedDay).toBeFocused()
})

test('navigates mobile Agenda by week and selects its first release', async ({ page, context }) => {
  await page.setViewportSize({
    height: 844,
    width: 390
  })

  await openCalendar(page, context)
  await expect(page.getByRole('button', { name: 'Previous week' })).toBeDisabled()
  await page.getByRole('button', { name: 'Next week' }).click()
  await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=2026-09-16`)
  await expect(page.getByText('Sep 14 – Sep 20, 2026', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'South Park' })).toBeVisible()
})

test('keeps a month URL in mobile Month across reload and opens Agenda at its first day', async ({ page, context }) => {
  await page.setViewportSize({
    height: 844,
    width: 390
  })

  await openCalendar(page, context)

  await page.getByRole('button', {
    name: 'Month',
    exact: true
  }).click()

  await expect(page.getByRole('group', { name: 'Selected week' })).toBeHidden()
  await page.getByRole('button', { name: 'Next month' }).click()
  await expect(page).toHaveURL(`${appBaseUrl}/calendar?month=2026-10`)
  await expect(page.getByRole('grid', { name: 'Calendar days' }).locator('button[aria-pressed="true"]')).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Releases in October 2026' }).getByRole('listitem')).toHaveCount(23)
  await expect(page.getByLabel('Calendar period navigation').getByText('October 2026', { exact: true })).toBeVisible()
  await page.reload()
  await waitForHydration(page)

  await expect(page.getByRole('button', {
    name: 'Month',
    exact: true
  })).toHaveAttribute('aria-pressed', 'true')

  await expect(page.getByRole('grid', { name: 'Calendar days' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Selected week' })).toBeHidden()
  await expect(page.getByRole('grid', { name: 'Calendar days' }).locator('button[aria-pressed="true"]')).toHaveCount(0)

  await page.getByRole('button', {
    name: 'Agenda',
    exact: true
  }).click()

  await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=2026-10-01`)
  await expect(page.getByRole('group', { name: 'Selected week' })).toBeVisible()
})

test('loads a cross-month week before selecting its first release', async ({ page, context }) => {
  await page.setViewportSize({
    height: 844,
    width: 390
  })

  await openCalendar(page, context, '/calendar?date=2026-09-25')

  const nextWeekRequest = page.waitForRequest('**/api/catalog/releases?**')

  await page.getByRole('button', { name: 'Next week' }).click()

  const request = await nextWeekRequest
  const requestUrl = new URL(request.url())

  expect(requestUrl.searchParams.get('from')).toBe(TODAY)
  expect(requestUrl.searchParams.get('to')).toBe('2026-10-04')
  await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=2026-09-30`)
  await expect(page.getByRole('heading', { name: 'South Park' })).toBeVisible()
})

test('restores mobile Month mode when browser history returns to a month URL', async ({ page, context }) => {
  await page.setViewportSize({
    height: 844,
    width: 390
  })

  await openCalendar(page, context)

  await page.getByRole('button', {
    name: 'Month',
    exact: true
  }).click()

  await page.getByRole('button', { name: 'Next month' }).click()
  await expect(page).toHaveURL(`${appBaseUrl}/calendar?month=2026-10`)

  await page.getByRole('button', {
    name: 'Agenda',
    exact: true
  }).click()

  await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=2026-10-01`)
  await page.goBack()
  await expect(page).toHaveURL(`${appBaseUrl}/calendar?month=2026-10`)

  await expect(page.getByRole('button', {
    name: 'Month',
    exact: true
  })).toHaveAttribute('aria-pressed', 'true')

  await expect(page.getByRole('grid', { name: 'Calendar days' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Selected week' })).toBeHidden()
})

test('opens the last partial supported week and disables navigation at its end', async ({ page, context }) => {
  await page.setViewportSize({
    height: 844,
    width: 390
  })

  await openCalendar(page, context, '/calendar?date=9999-12-25')

  const nextWeek = page.getByRole('button', { name: 'Next week' })

  await expect(nextWeek).toBeEnabled()
  await nextWeek.click()
  await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=9999-12-27`)
  await expect(page.getByText('Dec 27 – Dec 31, 9999', { exact: true })).toBeVisible()
  await expect(nextWeek).toBeDisabled()
})

test('keeps empty outcomes visible in mobile Month', async ({ page, context }) => {
  await page.setViewportSize({
    height: 844,
    width: 390
  })

  await openCalendar(page, context)

  await page.getByRole('button', {
    name: 'Month',
    exact: true
  }).click()

  await page.getByRole('button', { name: /Monday, September 14, 2026.*0 releases/u }).click()
  await expect(page.getByRole('heading', { name: 'Nothing releases on this day' })).toBeVisible()
  await expect(page.getByRole('grid', { name: 'Calendar days' })).toBeVisible()
  await addCookie(context, 'empty_calendar', '1')
  await page.getByRole('button', { name: 'Next month' }).click()
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

  await page.getByRole('button', {
    name: 'Month',
    exact: true
  }).click()

  await expect(page.getByRole('alert')).toHaveText('We couldn’t load your release calendar. Try again.')
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
})

test('shows month and agenda together from tablet and uses one month-grid tab stop', async ({ page, context }) => {
  await page.setViewportSize({
    height: 1024,
    width: 768
  })

  await openCalendar(page, context)

  const calendarDays = page.getByRole('grid', { name: 'Calendar days' })
  const agenda = page.getByRole('list', { name: 'Releases for selected day' })
  const todayButton = calendarDays.locator('button[aria-current="date"]')

  await expect(calendarDays).toBeVisible()
  await expect(agenda).toBeVisible()
  await expect(calendarDays.locator('button[tabindex="0"]')).toHaveCount(1)
  await todayButton.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(todayButton).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(todayButton).toBeFocused()
  await page.keyboard.press('ArrowRight')

  const nextDay = calendarDays.getByRole('button', { name: /Sunday, September 13, 2026/u })

  await expect(nextDay).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(todayButton).toBeFocused()
  await page.keyboard.press('ArrowDown')

  const nextWeekDay = calendarDays.getByRole('button', { name: /Saturday, September 19, 2026/u })

  await expect(nextWeekDay).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(todayButton).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(nextDay).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(`${appBaseUrl}/calendar?date=2026-09-13`)
  await expect(nextDay).toHaveAttribute('aria-pressed', 'true')
  await expect(calendarDays.locator('button[tabindex="0"]')).toHaveCount(1)
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
  await page.getByRole('button', { name: 'Next month' }).click()
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

  const loadingMonth = page.getByRole('status', { name: 'Loading month' })
  const loadingAgenda = page.getByRole('status', { name: 'Loading agenda' })

  await expect(loadingMonth.locator(':scope > div')).toHaveCount(42)
  await expect(loadingAgenda.locator(':scope > div')).toHaveCount(3)

  const loadingMonthBounds = await getVisibleBounds(loadingMonth.locator('xpath=../..'))
  const loadingAgendaBounds = await getVisibleBounds(loadingAgenda.locator('xpath=..'))
  const calendarDays = page.getByRole('grid', { name: 'Calendar days' })

  await expect(calendarDays).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dune' })).toBeVisible()

  const loadedMonthBounds = await getVisibleBounds(calendarDays.locator('xpath=..'))

  const loadedAgendaBounds = await getVisibleBounds(
    page.getByRole('list', { name: 'Releases for selected day' }).locator('xpath=..')
  )

  expect(loadedMonthBounds.width).toBe(loadingMonthBounds.width)
  expect(loadedMonthBounds.height).toBe(loadingMonthBounds.height)
  expect(loadedAgendaBounds.width).toBe(loadingAgendaBounds.width)
  expect(loadedAgendaBounds.y).toBe(loadingAgendaBounds.y)
  expect(loadingAgendaBounds.height).toBeGreaterThanOrEqual(loadedAgendaBounds.height)
})

test('cancels a stale month request and renders only the current month', async ({ page, context }) => {
  await page.clock.setFixedTime(FIXED_NOW)
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'slow_calendar', '1')

  const staleRequestFailure = page.waitForEvent('requestfailed', isStaleSeptemberReleaseRequest)

  await page.goto(`/calendar?date=${TODAY}`)
  await expect(page.getByRole('heading', { name: 'Release calendar' })).toBeVisible()
  await page.getByRole('button', { name: 'Next month' }).click()

  const failedRequest = await staleRequestFailure

  expect(failedRequest.failure()?.errorText).toMatch(/abort|cancel/iu)
  await expect(page.getByRole('heading', { name: 'Dune' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'American Horror Story' })).toHaveCount(10)
})

test('clears one account private releases before loading another account', async ({ page, context }) => {
  await openCalendar(page, context)
  await expect(page.getByRole('heading', { name: 'Dune' })).toBeVisible()
  await addCookie(context, 'tv_session', 'e2e-long-email-session')
  await addCookie(context, 'slow_calendar', '1')
  await page.evaluate(() => { globalThis.dispatchEvent(new Event('focus')) })
  await expect(page.getByRole('status', { name: 'Loading agenda' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dune' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Nothing releases on this day' })).toBeVisible()
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
  await expect(page.getByRole('grid', { name: 'Calendar days' })).toBeVisible()
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
  const upcoming = await context.request.get(`/api/catalog/releases/upcoming?from=${TODAY}`)

  expect(releases.status()).toBe(200)
  expect(releases.headers()['cache-control']).toBe('no-store')
  expect(upcoming.status()).toBe(200)
  expect(upcoming.headers()['cache-control']).toBe('no-store')
})
