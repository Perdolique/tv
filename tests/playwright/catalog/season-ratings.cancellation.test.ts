import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { episodeEdgeSeries } from './details.fixtures.ts'
import { openEpisodes } from './helpers.ts'

const titlePath = `/titles/${episodeEdgeSeries.id}`
const seasonPath = `/api/catalog/items/${episodeEdgeSeries.id}/seasons/2/rating`
const seasonRoute = `**${seasonPath}`

test('finishes a season rating in the cache while its editor is closed', async ({ context, page }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await page.goto(titlePath)
  await openEpisodes(page)

  const season = page.getByRole('region', {
    name: 'Season 2 ratings',
    exact: true
  })

  const release = Promise.withResolvers<boolean>()

  const ratingDialogs = page.getByRole('dialog', {
    name: /^Your rating for season/u,
    includeHidden: true
  })

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
    await expect(page.getByRole('button', { name: /^Rate season 1/u })).toBeDisabled()
    await expect(ratingDialogs).toHaveCount(0)
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

    await expect(ratingDialogs).toHaveCount(0)
  } finally {
    release.resolve(true)
  }
})
