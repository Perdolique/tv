/* oxlint-disable vitest/prefer-each -- Browser viewport scenarios keep their names in reports. */
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { dune } from './details.fixtures.ts'
import { openEpisodes, waitForHydration } from './helpers.ts'

import {
  mockHistory,
  mockHistoryWithNextPageFailure,
  mockRatingTimeline,
  movieViewports,
  timelinePath,
  titlePath
} from './timeline.fixtures.ts'

test.use({ timezoneId: 'Europe/Tallinn' })

test('shows six rows, expands all history and pages older activity', async ({ context, page }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await mockHistory(page)
  await page.goto(titlePath)
  await waitForHydration(page)

  const timeline = page.getByRole('region', { name: 'Your timeline' })
  const activityRows = timeline.locator(':scope > div > ol > li')

  await expect(activityRows).toHaveCount(6)
  await expect(timeline.getByText('Updated rating', { exact: true })).toBeVisible()
  await expect(timeline.getByText('8 → 9', { exact: true })).toBeVisible()
  await expect(timeline.getByText('Watched 25 episodes', { exact: true })).toBeVisible()
  await expect(timeline.getByText('Started watching', { exact: true })).toHaveCount(0)
  await timeline.getByRole('button', { name: 'Show full history' }).click()
  await expect(activityRows).toHaveCount(7)
  await expect(timeline.getByText('Started watching', { exact: true })).toBeVisible()

  await timeline.getByRole('button', {
    name: 'Load more',
    exact: true
  }).click()

  await expect(timeline.getByRole('button', {
    name: 'Load more',
    exact: true
  })).toHaveCount(0)

  await expect(timeline.getByRole('heading', { name: 'Your timeline' })).toBeFocused()
})

async function expectNarrowMovieTimelineAfterViewings(page: Page, viewportName: string): Promise<void> {
  if (viewportName === 'desktop') { return }

  const viewingsBox = await page.getByRole('region', { name: 'Your viewings' }).boundingBox()
  const timelineBox = await page.getByRole('region', { name: 'Your timeline' }).boundingBox()

  expect(viewingsBox).not.toBeNull()
  expect(timelineBox).not.toBeNull()

  if (viewingsBox === null || timelineBox === null) { throw new Error('Movie history layout is missing') }

  expect(timelineBox.y).toBeGreaterThan(viewingsBox.y + viewingsBox.height)
}

for (const viewport of movieViewports) {
test(`links a movie timeline to the exact viewing at ${viewport.name}`, async ({ context, page }) => {
  const movieTimelinePath = `/api/catalog/items/${dune.id}/timeline`
  const movieViewingId = '40000000-0000-7000-8000-000000000010'

  await addCookie(context, 'tv_session', 'e2e-session')
  await page.setViewportSize(viewport)

  const movieTimelineRoute = `**${movieTimelinePath}?*`

  await page.route(movieTimelineRoute, async (route) => {
    await route.fulfill({ json: {
      items: [{
        id: '50000000-0000-7000-8000-000000000010',
        kind: 'movie_viewing',
        occurredAt: '2026-10-06T12:00:00.000000Z',
        viewingId: movieViewingId,
        startedOn: '2020-02-01',
        completedOn: '2020-02-02'
      }],

      nextCursor: null
    } })
  })

  const movieTitlePath = `/titles/${dune.id}`

  await page.goto(movieTitlePath)

  const timeline = page.getByRole('region', { name: 'Your timeline' })
  const link = timeline.getByRole('link', { name: 'Watched movie' })

  await expect(link).toHaveAttribute('href', `/titles/${dune.id}?viewingId=${movieViewingId}#viewing-${movieViewingId}`)
  await expect(page.getByText('Started Feb 1, 2020 · Finished Feb 2, 2020', { exact: true })).toBeVisible()
  await expectNarrowMovieTimelineAfterViewings(page, viewport.name)
})
}

test.describe('timeline next-page recovery', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: timelinePath,
    status: 503
  }] } })

  test('keeps visible history and moves focus to retry after a next-page failure', async ({ context, page }) => {
    await addCookie(context, 'tv_session', 'e2e-session')
    await mockHistoryWithNextPageFailure(page)
    await page.goto(titlePath)

    const timeline = page.getByRole('region', { name: 'Your timeline' })

    await timeline.getByRole('button', { name: 'Show full history' }).click()

    await timeline.getByRole('button', {
      name: 'Load more',
      exact: true
    }).click()

    await expect(timeline.getByText('We couldn’t load more history. Try again.')).toBeVisible()
    await expect(timeline.getByText('Started watching', { exact: true })).toBeVisible()
    await expect(timeline.getByText('Watched 25 episodes', { exact: true })).toBeVisible()
    await expect(timeline.getByRole('button', { name: 'Retry history' })).toBeFocused()
    await timeline.getByRole('button', { name: 'Retry history' }).click()
    await expect(timeline.getByText('We couldn’t load more history. Try again.')).toHaveCount(0)
    await expect(timeline.getByText('Watched 25 episodes', { exact: true })).toBeVisible()
    await expect(timeline.getByRole('heading', { name: 'Your timeline' })).toBeFocused()
  })

  test('keeps the user’s chosen focus while a pending next page fails', async ({ context, page }) => {
    const pending = Promise.withResolvers<null>()

    await addCookie(context, 'tv_session', 'e2e-session')
    await mockHistoryWithNextPageFailure(page)

    const historyRoute = `**${timelinePath}?*`

    await page.route(historyRoute, async (route) => {
      const request = route.request()
      const requestUrl = request.url()
      const url = new URL(requestUrl)
      const hasCursor = url.searchParams.has('cursor')

      // oxlint-disable-next-line vitest/no-conditional-in-test -- Only the next page waits for the user to move focus.
      if (hasCursor) { await pending.promise }

      await route.fallback()
    })

    await page.goto(titlePath)

    const timeline = page.getByRole('region', { name: 'Your timeline' })

    await timeline.getByRole('button', { name: 'Show full history' }).click()

    await timeline.getByRole('button', {
      name: 'Load more',
      exact: true
    }).click()

    const selectedControl = timeline.getByRole('heading', { name: 'Your timeline' })

    await selectedControl.focus()
    pending.resolve(null)
    await expect(timeline.getByRole('button', { name: 'Retry history' })).toBeVisible()
    await expect(selectedControl).toBeFocused()
  })
})

test('refreshes the timeline after title, season, and episode ratings', async ({ context, page }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await mockRatingTimeline(page)
  await page.goto(titlePath)
  await waitForHydration(page)

  const timeline = page.getByRole('region', { name: 'Your timeline' })

  await page.getByRole('button', {
    name: 'Rate',
    exact: true
  }).click()

  await page.getByRole('button', {
    name: '8 out of 10',
    exact: true
  }).click()

  await expect(timeline.getByText('Rated', { exact: true })).toBeVisible()
  await openEpisodes(page)

  await page.getByRole('region', {
    name: 'Season 1 ratings',
    exact: true
  }).getByRole('button', {
    name: 'Rate season 1',
    exact: true
  }).click()

  await page.getByRole('button', {
    name: '7 out of 10',
    exact: true
  }).click()

  await expect(timeline.getByText('Season 1', { exact: true })).toBeVisible()

  await page.getByRole('region', {
    name: 'Ratings for season 1, episode 1',
    exact: true
  }).getByRole('button', { name: /^Rate episode,/u }).click()

  await page.getByRole('button', {
    name: '9 out of 10',
    exact: true
  }).click()

  await expect(timeline.getByText('S1 E1', { exact: true })).toBeVisible()
})
