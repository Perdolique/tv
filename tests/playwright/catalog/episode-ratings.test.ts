import type { Page, Request } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { chernobyl, episodeEdgeSeries, manyEpisodeSeries } from './details.fixtures.ts'
import { openEpisodes, waitForHydration } from './helpers.ts'

const titlePath = `/titles/${episodeEdgeSeries.id}`
const firstEpisodeId = '30000000-0000-7000-8000-000000000013'
const ratingPath = `/api/catalog/episodes/${firstEpisodeId}/rating`

function episodeRegion(page: Page, season = 2, episode = 1) {
  return page.getByRole('region', {
    name: `Ratings for season ${season}, episode ${episode}`,
    exact: true
  })
}

function isEpisodeRatingWrite(request: Request): boolean {
  const rawUrl = request.url()
  const requestUrl = new URL(rawUrl)

  return requestUrl.pathname === ratingPath && request.method() === 'PUT'
}

test('keeps episode ratings across sessions without changing watched, season or whole-title scores', async ({ context, page }) => {
  await page.clock.setFixedTime(new Date('2099-03-01T12:00:00Z'))

  const first = episodeRegion(page)

  const seasonRating = page.getByRole('region', {
    name: 'Season 2 ratings',
    exact: true
  })

  await test.step('open the episode list as the first account', async () => {
    await addCookie(context, 'tv_session', 'e2e-session')
    await page.goto(titlePath)
    await openEpisodes(page)
  })

  await test.step('save an episode rating without changing parent scores', async () => {
    await first.getByRole('button', { name: /^Rate episode,/u }).click()

    await first.getByRole('button', {
      name: '8 out of 10',
      exact: true
    }).click()

    await expect(first.getByText('8/10', { exact: true })).toBeVisible()
    await expect(first.getByText('1 rating', { exact: true })).toBeVisible()
    await expect(seasonRating.getByText('Not rated', { exact: true })).toBeVisible()

    await expect(page.getByRole('region', {
      name: 'Personal score',
      exact: true
    })).toHaveText(/^Your rating\s*—\s*$/u)
  })

  await test.step('toggle watched state without changing the rating', async () => {
    const watched = page.getByRole('button', {
      name: 'Watched',
      exact: true
    }).first()

    await expect(watched).toHaveAttribute('aria-pressed', 'false')
    await watched.click()
    await expect(watched).toHaveAttribute('aria-pressed', 'true')
    await watched.click()
    await expect(watched).toHaveAttribute('aria-pressed', 'false')
    await expect(first.getByText('8/10', { exact: true })).toBeVisible()
  })

  await test.step('rate an episode in another season and preserve both ratings', async () => {
    await page.getByRole('button', {
      name: 'Season 1',
      exact: true
    }).click()

    const missingMetadata = episodeRegion(page, 1)

    await missingMetadata.getByRole('button', { name: /^Rate episode,/u }).click()

    await missingMetadata.getByRole('button', {
      name: '3 out of 10',
      exact: true
    }).click()

    await expect(missingMetadata.getByText('3/10')).toBeVisible()

    await page.getByRole('button', {
      name: 'Season 2',
      exact: true
    }).click()

    await expect(first.getByText('8/10')).toBeVisible()
    await page.reload()
    await openEpisodes(page)
    await expect(first.getByText('8/10')).toBeVisible()
  })

  await test.step('keep the public rating after signing out', async () => {
    await context.clearCookies({ name: 'tv_session' })
    await page.reload()
    await openEpisodes(page)
    await expect(first.getByRole('link', { name: /^Rate episode,/u })).toHaveAttribute('href', /^\/sign-in\?redirectTo=/u)
    await expect(first.getByText('1 rating', { exact: true })).toBeVisible()
  })

  await test.step('combine ratings from two accounts', async () => {
    await addCookie(context, 'tv_session', 'e2e-long-email-session')
    await page.reload()
    await openEpisodes(page)
    await first.getByRole('button', { name: /^Rate episode,/u }).click()

    await first.getByRole('button', {
      name: '4 out of 10',
      exact: true
    }).click()

    await expect(first.getByText('2 ratings', { exact: true })).toBeVisible()
    await expect(first.getByText('6 out of 10', { exact: true })).toBeVisible()
  })

  await test.step('remove only the current account rating', async () => {
    await addCookie(context, 'tv_session', 'e2e-session')
    await page.reload()
    await openEpisodes(page)

    await first.getByRole('button', {
      name: 'Your rating for season 2, episode 1: 8 out of 10',
      exact: true
    }).click()

    await first.getByRole('button', {
      name: 'Remove rating',
      exact: true
    }).click()

    await expect(first.getByRole('button', { name: /^Rate episode,/u })).toBeVisible()
    await expect(first.getByText('1 rating', { exact: true })).toBeVisible()
    await expect(first.getByText('4 out of 10', { exact: true })).toBeVisible()
  })

  await test.step('keep another series unrated', async () => {
    await page.goto(`/titles/${chernobyl.id}`)
    await openEpisodes(page)
    await expect(episodeRegion(page, 1).getByRole('button', { name: /^Rate episode,/u })).toBeEnabled()
    await expect(episodeRegion(page, 1).getByText('0 ratings', { exact: true })).toBeVisible()
  })
})

test('loads twenty episode ratings once and reuses them after reopening Episodes', async ({ context, page }) => {
  const paths: string[] = []
  const seasonPath = `/api/catalog/items/${manyEpisodeSeries.id}/seasons/1/episodes`

  page.on('request', request => { paths.push(new URL(request.url()).pathname) })
  await addCookie(context, 'tv_session', 'e2e-session')

  const response = await page.goto(`/titles/${manyEpisodeSeries.id}`)
  const html = await response?.text()

  expect(html).not.toContain('Viewer rating for season 1, episode 20')
  await waitForHydration(page)
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  expect(paths.filter(path => path.startsWith(seasonPath))).toHaveLength(0)
  await openEpisodes(page)
  await expect(episodeRegion(page, 1, 20).getByRole('button', { name: /^Rate episode,/u })).toBeEnabled()
  expect(paths.filter(path => path === `${seasonPath}/ratings`)).toHaveLength(1)
  expect(paths.filter(path => path === `${seasonPath}/rating-summaries`)).toHaveLength(1)
  expect(paths.filter(path => /^\/api\/catalog\/episodes\/[^/]+\/rating/u.test(path))).toHaveLength(0)

  await page.getByRole('tab', {
    name: 'Overview',
    exact: true
  }).click()

  const previousCount = paths.length

  await expect(page.getByRole('region', {
    name: 'Ratings for season 1, episode 20',
    exact: true
  })).toHaveCount(0)

  expect(paths).toHaveLength(previousCount)

  await page.getByRole('tab', {
    name: 'Episodes',
    exact: true
  }).click()

  await expect(episodeRegion(page, 1, 20).getByRole('button', { name: /^Rate episode,/u })).toBeEnabled()
  await expect(episodeRegion(page, 1, 20).getByText('0 ratings', { exact: true })).toBeVisible()
  expect(paths.filter(path => path === `${seasonPath}/ratings`)).toHaveLength(1)
  expect(paths.filter(path => path === `${seasonPath}/rating-summaries`)).toHaveLength(1)
})

test.describe('episode write and summary errors', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: ratingPath,
    status: 503
  }, {
    pathname: `${ratingPath}-summary`,
    status: 503
  }] } })

  test('keeps failed writes unsaved and retries only the affected summary after a successful save', async ({ context, page }) => {
    await addCookie(context, 'tv_session', 'e2e-session')
    await page.goto(titlePath)
    await openEpisodes(page)

    const first = episodeRegion(page)

    await page.route(`**${ratingPath}`, async route => {
      await route.fulfill({
        status: 503,

        json: { error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Unavailable'
        } }
      })
    }, { times: 1 })

    await first.getByRole('button', { name: /^Rate episode,/u }).click()

    await first.getByRole('button', {
      name: '8 out of 10',
      exact: true
    }).click()

    await expect(first.getByRole('alert')).toHaveText('We couldn’t save your rating. Try again.')
    await expect(first.getByText('8/10')).toHaveCount(0)
    await expect(episodeRegion(page, 2, 2).getByRole('button', { name: /^Rate episode,/u })).toBeEnabled()

    await page.route(`**${ratingPath}-summary`, async route => {
      await route.fulfill({
        status: 503,

        json: { error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Unavailable'
        } }
      })
    }, { times: 1 })

    await first.getByRole('button', {
      name: '8 out of 10',
      exact: true
    }).click()

    await expect(first.getByText('8/10')).toBeVisible()
    await expect(first.getByRole('alert')).toHaveText('Viewer rating update failed. Try again.')
    await expect(first.getByText('0 ratings', { exact: true })).toBeVisible()

    await first.getByRole('button', {
      name: 'Retry viewer rating',
      exact: true
    }).click()

    await expect(first.getByText('1 rating', { exact: true })).toBeVisible()
    await expect(first.getByRole('alert')).toHaveCount(0)
  })
})

test('finishes an episode write in its cached season without reopening the editor or stealing focus', async ({ context, page }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await page.goto(titlePath)
  await openEpisodes(page)

  const started = Promise.withResolvers<boolean>()
  const release = Promise.withResolvers<boolean>()

  await page.route(`**${ratingPath}`, async route => {
    started.resolve(true)

    await release.promise

    await route.continue()
  }, { times: 1 })

  try {
    await episodeRegion(page).getByRole('button', { name: /^Rate episode,/u }).click()

    await episodeRegion(page).getByRole('button', {
      name: '9 out of 10',
      exact: true
    }).click()

    await started.promise

    const saved = page.waitForResponse(response => isEpisodeRatingWrite(response.request()))

    await page.getByRole('button', {
      name: 'Season 1',
      exact: true
    }).click()

    await expect(episodeRegion(page, 1).getByRole('button', { name: /^Rate episode,/u })).toBeEnabled()
    await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(0)
    release.resolve(true)

    const response = await saved

    expect(response.status()).toBe(200)

    await expect(page.getByRole('button', {
      name: 'Season 1',
      exact: true
    })).toBeFocused()

    await page.getByRole('button', {
      name: 'Season 2',
      exact: true
    }).click()

    await expect(episodeRegion(page).getByRole('button', {
      name: 'Your rating for season 2, episode 1: 9 out of 10',
      exact: true
    })).toBeEnabled()

    await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(0)
  } finally {
    release.resolve(true)
  }
})
