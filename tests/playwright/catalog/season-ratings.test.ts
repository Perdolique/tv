import { expect, test } from '../fixtures/global.fixtures.ts'
import { appBaseUrl } from '../constants.ts'
import { chernobyl, episodeEdgeSeries } from './details.fixtures.ts'
import { waitForHydration } from './helpers.ts'

const series = episodeEdgeSeries
const titlePath = `/titles/${series.id}`
const seasonPath = `/api/catalog/items/${series.id}/seasons/2/rating`
const seasonRoute = `**${seasonPath}`
const summaryRoute = `**${seasonPath}-summary`

test('renders the selected season summary for guests on the server without private reads', async ({ page }) => {
  const requestedUrls: string[] = []

  page.on('request', request => { requestedUrls.push(request.url()) })

  const response = await page.goto(titlePath)
  const html = await response?.text()

  expect(html).toContain('Season 2 viewer rating')
  expect(html).toContain('Season 2 ratings')
  await waitForHydration(page)

  const season = page.getByRole('region', {
    name: 'Season 2 ratings',
    exact: true
  })

  await expect(season.getByText('0 ratings', { exact: true })).toBeVisible()

  await expect(season.getByRole('link', {
    name: 'Rate season 2',
    exact: true
  })).toHaveAttribute('href', /^\/sign-in\?redirectTo=/u)

  const privateRatingUrl = `${appBaseUrl}${seasonPath}`
  const summaryUrl = `${appBaseUrl}${seasonPath}-summary`

  expect(requestedUrls).not.toContain(privateRatingUrl)
  expect(requestedUrls).not.toContain(summaryUrl)
})

test('keeps season scores separate across seasons, titles and sessions', async ({ context, page }) => {
  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])

  await page.goto(titlePath)
  await waitForHydration(page)

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

  const selector = page.getByRole('combobox', {
    name: 'Season',
    exact: true
  })

  await expect(selector).toHaveValue('2')
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

  await selector.selectOption('1')
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
  await selector.selectOption('2')

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

  await expect(selector).toHaveValue('2')

  await expect(secondSeason.getByRole('button', {
    name: 'Rate season 2, your rating: 7 out of 10',
    exact: true
  })).toBeVisible()

  const otherTitlePath = `/titles/${chernobyl.id}`

  await page.goto(otherTitlePath)
  await expect(firstSeason.getByText('Not rated', { exact: true })).toBeVisible()

  await expect(firstSeason.getByRole('button', {
    name: 'Rate season 1',
    exact: true
  })).toBeVisible()

  await page.goto(titlePath)
  await page.reload()

  await expect(secondSeason.getByRole('button', {
    name: 'Rate season 2, your rating: 7 out of 10',
    exact: true
  })).toBeVisible()

  await context.clearCookies({ name: 'tv_session' })
  await page.reload()

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
  await selector.selectOption('1')

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
  await waitForHydration(page)

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

test('aborts pending season requests on selection changes without blocking the new season', async ({ context, page }) => {
  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])

  await page.goto(titlePath)
  await waitForHydration(page)

  const season = page.getByRole('region', {
    name: 'Season 2 ratings',
    exact: true
  })

  const started = Promise.withResolvers<boolean>()
  const release = Promise.withResolvers<boolean>()

  await page.route(seasonRoute, async route => {
    started.resolve(true)

    await release.promise

    // The route is aborted by the component disposal; do not fulfill it afterwards.
    await route.abort().catch(() => {
      // The browser may have already released the aborted route.
    })
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

    await started.promise

    const aborted = page.waitForEvent('requestfailed', request => request.url().endsWith(seasonPath))

    await page.getByRole('combobox', {
      name: 'Season',
      exact: true
    }).selectOption('1')

    const request = await aborted

    expect(request.failure()?.errorText).toContain('ERR_ABORTED')

    await expect(page.getByRole('region', {
      name: 'Season 1 ratings',
      exact: true
    }).getByRole('button', {
      name: 'Rate season 1',
      exact: true
    })).toBeEnabled()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByText('Rating saved.', { exact: true })).toHaveCount(0)
  } finally {
    release.resolve(true)
  }
})
