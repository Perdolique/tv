import { expect, test } from '../fixtures/global.fixtures.ts'
import { appBaseUrl } from '../constants.ts'
import { addCookie } from '../helpers.ts'
import { chernobyl, episodeEdgeSeries } from './details.fixtures.ts'
import { openEpisodes, waitForHydration } from './helpers.ts'

const series = episodeEdgeSeries
const titlePath = `/titles/${series.id}`
const seasonPath = `/api/catalog/items/${series.id}/seasons/2/rating`
const seasonRoute = `**${seasonPath}`
const summaryRoute = `**${seasonPath}-summary`

test('loads the season summary only after a guest opens Episodes without private reads', async ({ page }) => {
  const requestedUrls: string[] = []

  page.on('request', request => { requestedUrls.push(request.url()) })

  const response = await page.goto(titlePath)
  const html = await response?.text()

  expect(html).not.toContain('Season 2 viewer rating')
  expect(html).not.toContain('Season 2 ratings')
  await waitForHydration(page)

  const privateRatingUrl = `${appBaseUrl}${seasonPath}`
  const summaryUrl = `${appBaseUrl}${seasonPath}-summary`

  expect(requestedUrls).not.toContain(privateRatingUrl)
  expect(requestedUrls).not.toContain(summaryUrl)
  await openEpisodes(page)

  const season = page.getByRole('region', {
    name: 'Season 2 ratings',
    exact: true
  })

  await expect(season.getByText('0 ratings', { exact: true })).toBeVisible()

  await expect(season.getByRole('link', {
    name: 'Rate season 2',
    exact: true
  })).toHaveAttribute('href', /^\/sign-in\?redirectTo=/u)

  expect(requestedUrls).not.toContain(privateRatingUrl)
  expect(requestedUrls.filter(url => url === summaryUrl)).toHaveLength(1)
})

test('keeps season scores separate across seasons, titles and sessions', async ({ context, page }) => {
  await page.clock.setFixedTime(new Date('2099-03-01T12:00:00Z'))

  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])

  await page.goto(titlePath)
  await openEpisodes(page)

  const firstSeason = page.getByRole('region', {
    name: 'Season 1 ratings',
    exact: true
  })

  const secondSeason = page.getByRole('region', {
    name: 'Season 2 ratings',
    exact: true
  })

  const wholeTitle = page.getByRole('region', {
    name: 'Personal score',
    exact: true
  })

  const firstSeasonToggle = page.getByRole('button', {
    name: 'Season 1',
    exact: true
  })

  const secondSeasonToggle = page.getByRole('button', {
    name: 'Season 2',
    exact: true
  })

  await expect(secondSeason.getByText('Not rated', { exact: true })).toBeVisible()

  await secondSeason.getByRole('button', {
    name: 'Rate season 2',
    exact: true
  }).click()

  await secondSeason.getByRole('button', {
    name: '7 out of 10',
    exact: true
  }).click()

  await expect(secondSeason.getByText('1 rating', { exact: true })).toBeVisible()
  await expect(wholeTitle).toHaveText(/^Your rating\s*—\s*$/u)

  await expect(page.getByRole('button', {
    name: 'Watched',
    exact: true
  }).first()).toHaveAttribute('aria-pressed', 'false')

  await firstSeasonToggle.click()
  await expect(firstSeason.getByText('Not rated', { exact: true })).toBeVisible()

  await firstSeason.getByRole('button', {
    name: 'Rate season 1',
    exact: true
  }).click()

  await firstSeason.getByRole('button', {
    name: '4 out of 10',
    exact: true
  }).click()

  await expect(firstSeason.getByText('1 rating', { exact: true })).toBeVisible()
  await secondSeasonToggle.click()

  await expect(secondSeason.getByRole('button', {
    name: 'Rate season 2, your rating: 7 out of 10',
    exact: true
  })).toBeVisible()

  await page.getByRole('tab', {
    name: 'Overview',
    exact: true
  }).click()

  await expect(secondSeason).toHaveCount(0)

  await page.getByRole('tab', {
    name: 'Episodes',
    exact: true
  }).click()

  await expect(secondSeason.getByRole('button', {
    name: 'Rate season 2, your rating: 7 out of 10',
    exact: true
  })).toBeVisible()

  const otherTitlePath = `/titles/${chernobyl.id}`

  await page.goto(otherTitlePath)
  await openEpisodes(page)
  await expect(firstSeason.getByText('Not rated', { exact: true })).toBeVisible()

  await expect(firstSeason.getByRole('button', {
    name: 'Rate season 1',
    exact: true
  })).toBeVisible()

  await page.goto(titlePath)
  await page.reload()
  await openEpisodes(page)

  await expect(secondSeason.getByRole('button', {
    name: 'Rate season 2, your rating: 7 out of 10',
    exact: true
  })).toBeVisible()

  await context.clearCookies({ name: 'tv_session' })
  await page.reload()
  await openEpisodes(page)

  await expect(secondSeason.getByRole('link', {
    name: 'Rate season 2',
    exact: true
  })).toHaveAttribute('href', /^\/sign-in\?redirectTo=/u)

  await expect(secondSeason.getByText('1 rating', { exact: true })).toBeVisible()

  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-long-email-session',
    url: appBaseUrl
  }])

  await page.reload()
  await openEpisodes(page)

  await expect(secondSeason.getByRole('button', {
    name: 'Rate season 2',
    exact: true
  })).toBeVisible()

  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])

  await page.reload()
  await openEpisodes(page)

  await secondSeason.getByRole('button', {
    name: 'Rate season 2, your rating: 7 out of 10',
    exact: true
  }).click()

  await secondSeason.getByRole('button', {
    name: '9 out of 10',
    exact: true
  }).click()

  await expect(secondSeason.getByRole('button', {
    name: 'Rate season 2, your rating: 9 out of 10',
    exact: true
  })).toBeFocused()

  await secondSeason.getByRole('button', {
    name: 'Rate season 2, your rating: 9 out of 10',
    exact: true
  }).click()

  await secondSeason.getByRole('button', {
    name: 'Remove rating',
    exact: true
  }).click()

  await expect(secondSeason.getByText('0 ratings', { exact: true })).toBeVisible()
  await firstSeasonToggle.click()

  await expect(firstSeason.getByRole('button', {
    name: 'Rate season 1, your rating: 4 out of 10',
    exact: true
  })).toBeVisible()
})

test.describe('season rating failures', () => {
  test.use({ expectedHttpErrors: { values: [
    {
        pathname: seasonPath,
        status: 503
      },
    {
        pathname: `${seasonPath}-summary`,
        status: 503
      }
  ] } })

test('keeps episodes usable on rating failures and retries the affected data', async ({ context, page }) => {
  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])

  await page.goto(titlePath)
  await openEpisodes(page)

  const season = page.getByRole('region', {
    name: 'Season 2 ratings',
    exact: true
  })

  const viewer = season.getByRole('region', {
    name: 'Season 2 viewer rating',
    exact: true
  })

  const rate = season.getByRole('button', {
    name: 'Rate season 2',
    exact: true
  })

  await page.route(seasonRoute, async route => {
    await route.fulfill({
      status: 503,

      json: { error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'private database details'
      } }
    })
  }, { times: 1 })

  await rate.click()

  await season.getByRole('button', {
    name: '8 out of 10',
    exact: true
  }).click()

  await expect(season.getByRole('alert')).toContainText('We couldn’t save your rating.')
  await expect(season).not.toContainText('private database details')
  await expect(season.getByRole('dialog')).toBeVisible()
  await expect(viewer).toContainText('Not rated')
  await page.unroute(seasonRoute)

  await page.route(summaryRoute, async route => route.fulfill({
    status: 503,
    json: { error: { code: 'SERVICE_UNAVAILABLE' } }
  }))

  await season.getByRole('button', {
    name: '8 out of 10',
    exact: true
  }).click()

  await expect(viewer.getByRole('alert')).toContainText('Viewer rating update failed.')

  await expect(season.getByRole('button', {
    name: 'Rate season 2, your rating: 8 out of 10',
    exact: true
  })).toBeVisible()

  await expect(page.getByRole('heading', {
    name: 'A future title',
    exact: true
  })).toBeVisible()

  await page.unroute(summaryRoute)

  await viewer.getByRole('button', {
    name: 'Retry viewer rating',
    exact: true
  }).click()

  await expect(viewer.getByText('8 out of 10', { exact: true })).toBeVisible()
  await expect(viewer).toBeFocused()
})

})

test('finishes a season rating in the cache while its editor is closed', async ({ context, page }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await page.goto(titlePath)
  await openEpisodes(page)

  const season = page.getByRole('region', {
    name: 'Season 2 ratings',
    exact: true
  })

  const release = Promise.withResolvers<boolean>()

  const firstSeason = page.getByRole('button', {
    name: 'Season 1',
    exact: true
  })

  await page.route(seasonRoute, async route => {
    await release.promise

    await route.continue()
  })

  try {
    await season.getByRole('button', {
      name: 'Rate season 2',
      exact: true
    }).click()

    await season.getByRole('button', {
      name: '9 out of 10',
      exact: true
    }).click()

    await expect(season.getByText('Updating rating…', { exact: true })).toBeVisible()

    const saved = page.waitForResponse(response => response.url().endsWith(seasonPath))

    await firstSeason.click()
    await expect(page.getByRole('button', { name: /^Rate season 1/u })).toBeEnabled()
    await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(0)
    release.resolve(true)

    const response = await saved

    expect(response.status()).toBe(200)
    await expect(firstSeason).toBeFocused()

    await page.getByRole('button', {
      name: 'Season 2',
      exact: true
    }).click()

    await expect(season.getByRole('button', {
      name: 'Rate season 2, your rating: 9 out of 10',
      exact: true
    })).toBeEnabled()

    await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(0)
  } finally {
    release.resolve(true)
  }
})
