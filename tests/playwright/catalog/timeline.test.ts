/* oxlint-disable vitest/prefer-each -- Playwright names the two closing choices as separate scenarios. */
import type { Page } from '@playwright/test'
import * as v from 'valibot'

import {
  catalogSeriesBulkWatchSchema,
  catalogSeriesRewatchSchema,
  catalogSeriesWatchSchema
} from '../../../packages/shared/src/catalog-series.ts'

import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { chernobyl, dune } from './details.fixtures.ts'
import { openEpisodes, waitForHydration } from './helpers.ts'

import {
  firstEpisodeId,
  mockHistory,
  mockHistoryWithNextPageFailure,
  mockRatingTimeline,
  movieViewports,
  nextViewingId,
  rewatchHistory,
  seriesResponse,
  timelinePath,
  titlePath,
  viewingId,
  watchedPath
} from './timeline.fixtures.ts'

const closeLabels = {
  paused: 'Pause current viewing',
  completed: 'Complete current viewing'
} as const

test.use({ timezoneId: 'Europe/Tallinn' })

test('shows six rows, expands all history and pages an inline episode group with gaps', async ({ context, page }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await mockHistory(page)
  await page.goto(titlePath)
  await waitForHydration(page)

  const timeline = page.getByRole('region', { name: 'Your timeline' })
  const activityRows = timeline.locator(':scope > div > ol > li')

  await expect(activityRows).toHaveCount(6)
  await expect(timeline.getByText('Updated rating', { exact: true })).toBeVisible()
  await expect(timeline.getByText('8 → 9', { exact: true })).toBeVisible()
  await expect(timeline.getByText('S1 E1, E3–E26', { exact: true })).toBeVisible()
  await expect(timeline.getByText('Started watching', { exact: true })).toHaveCount(0)

  const expand = timeline.getByRole('button', { name: 'View episodes' })

  await expand.focus()
  await page.keyboard.press('Enter')
  await expect(timeline.getByRole('button', { name: 'Hide episodes' })).toHaveAttribute('aria-expanded', 'true')
  await expect(timeline.getByText(/^History episode \d+$/u)).toHaveCount(20)
  await timeline.getByRole('button', { name: 'Load more episodes' }).click()
  await expect(timeline.getByText(/^History episode \d+$/u)).toHaveCount(25)
  await expect(timeline.getByRole('button', { name: 'Hide episodes' })).toBeFocused()
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

const viewingScenarios = [
  {
    closeStatus: 'paused',
    bulkPath: 'seasons/1/watched',
    bulkLabel: 'Mark released episodes in season 1'
  },
  {
    closeStatus: 'completed',
    bulkPath: 'episodes/watched',
    bulkLabel: 'Mark all released episodes'
  }
] as const

for (const { closeStatus, bulkPath, bulkLabel } of viewingScenarios) {
  test(`first mark, released episodes, then a ${closeStatus} rewatch keeps old history and starts empty`, async ({ context, page }) => {
    let state = seriesResponse()
    let rewatched = false

    await addCookie(context, 'tv_session', 'e2e-session')

    const watchedRoute = `**${watchedPath}`

    await page.route(watchedRoute, async (route) => { await route.fulfill({ json: state }) })

    const episodeWatchedRoute = `**/api/catalog/episodes/${firstEpisodeId}/watched`

    await page.route(episodeWatchedRoute, async (route) => {
      const request = route.request()
      const raw: unknown = request.postDataJSON()
      const body = v.parse(catalogSeriesWatchSchema, raw)

      expect(body.currentViewingId).toBeNull()
      expect(body.timeZone).toBe('Europe/Tallinn')

      state = seriesResponse([firstEpisodeId], viewingId, 1)

      await route.fulfill({ json: state })
    })

    const bulkWatchedRoute = `**/api/catalog/items/${chernobyl.id}/${bulkPath}`

    await page.route(bulkWatchedRoute, async (route) => {
      const request = route.request()
      const method = request.method()

      // oxlint-disable-next-line vitest/no-conditional-in-test -- The all-released POST shares the current-viewing GET path.
      if (method === 'GET') {
        await route.fallback()

        return
      }

      const raw: unknown = request.postDataJSON()
      const body = v.parse(catalogSeriesBulkWatchSchema, raw)

      expect(body.currentViewingId).toBe(viewingId)
      expect(body.contextVersion).toBe(1)

      const episodeIds = Array.from({ length: 5 }, (_value, index) => {
        const sequence = String(index + 1)
        const suffix = sequence.padStart(12, '0')
        const episodeId = `30000000-0000-7000-8000-${suffix}`

        return episodeId
      })

      state = seriesResponse(episodeIds, viewingId, 1)

      await route.fulfill({ json: state })
    })

    const rewatchRoute = `**/api/catalog/items/${chernobyl.id}/rewatch`

    await page.route(rewatchRoute, async (route) => {
      const request = route.request()
      const raw: unknown = request.postDataJSON()
      const body = v.parse(catalogSeriesRewatchSchema, raw)

      expect(body.closeStatus).toBe(closeStatus)
      expect(body.currentViewingId).toBe(viewingId)

      state = seriesResponse([], nextViewingId, 2)
      rewatched = true

      await route.fulfill({ json: state })
    })

    const historyRoute = `**${timelinePath}?*`

    await page.route(historyRoute, async (route) => {
      const rows = rewatchHistory(closeStatus, rewatched, state.watchedEpisodeIds.length > 0)

      await route.fulfill({ json: {
        items: rows,
        nextCursor: null
      } })
    })

    await page.goto(titlePath)
    await openEpisodes(page)

    await expect(page.getByRole('button', {
      name: 'Start rewatch',
      exact: true
    })).toHaveCount(0)

    await page.getByRole('listitem').filter({ hasText: '1:23:45' }).getByRole('button', {
      name: 'Watched',
      exact: true
    }).click()

    await expect(page.getByText('1 watched episode', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: bulkLabel }).click()
    await expect(page.getByText('5 watched episodes', { exact: true })).toBeVisible()

    const rewatch = page.getByRole('button', {
      name: 'Start rewatch',
      exact: true
    })

    await expect(rewatch).toBeEnabled()
    await rewatch.focus()
    await expect(rewatch).toBeFocused()
    await page.keyboard.press('Enter')

    const dialog = page.getByRole('dialog', { name: 'Start a rewatch' })

    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Pause current viewing' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(rewatch).toBeFocused()
    await page.keyboard.press('Enter')
    await dialog.getByRole('button', { name: closeLabels[closeStatus] }).click()
    await expect(dialog).not.toBeVisible()
    await expect(rewatch).toBeFocused()
    await expect(page.getByText('0 watched episodes', { exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Your timeline' }).getByText('Watched 25 episodes')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Your timeline' }).getByText('Started rewatch')).toBeVisible()
  })
}

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
    await timeline.getByRole('button', { name: 'View episodes' }).click()
    await expect(timeline.getByText(/^History episode \d+$/u)).toHaveCount(20)

    await timeline.getByRole('button', {
      name: 'Load more',
      exact: true
    }).click()

    await expect(timeline.getByText('We couldn’t load more history. Try again.')).toBeVisible()
    await expect(timeline.getByText('Started watching', { exact: true })).toBeVisible()
    await expect(timeline.getByText(/^History episode \d+$/u)).toHaveCount(20)
    await expect(timeline.getByRole('button', { name: 'Retry history' })).toBeFocused()
    await timeline.getByRole('button', { name: 'Retry history' }).click()
    await expect(timeline.getByText('We couldn’t load more history. Try again.')).toHaveCount(0)
    await expect(timeline.getByText(/^History episode \d+$/u)).toHaveCount(20)
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

    const selectedControl = timeline.getByRole('button', { name: 'View episodes' })

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
