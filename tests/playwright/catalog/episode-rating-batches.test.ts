import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { episodeEdgeSeries } from './details.fixtures.ts'
import { openEpisodes } from './helpers.ts'

const titlePath = `/titles/${episodeEdgeSeries.id}`

function episodeRegion(page: Page) {
  return page.getByRole('region', {
    name: 'Ratings for season 2, episode 1',
    exact: true
  })
}

test.describe('private episode batch errors', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: `/api/catalog/items/${episodeEdgeSeries.id}/seasons/2/episodes/ratings`,
    status: 503
  }] } })

  test('keeps the episode list usable after a private batch failure', async ({ context, page }) => {
    const batchPath = `/api/catalog/items/${episodeEdgeSeries.id}/seasons/2/episodes/ratings`

    await addCookie(context, 'tv_session', 'e2e-session')

    await page.route(`**${batchPath}`, async route => {
      await route.fulfill({
        status: 503,

        json: { error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Unavailable'
        } }
      })
    }, { times: 1 })

    await page.goto(titlePath)
    await openEpisodes(page)
    await expect(page.getByRole('alert')).toHaveText('We couldn’t load your episode ratings. The episode list is still available.')

    await expect(page.getByRole('button', {
      name: 'Watched',
      exact: true
    }).first()).toBeEnabled()

    await expect(episodeRegion(page).getByText('0 ratings', { exact: true })).toBeVisible()

    await page.getByRole('button', {
      name: 'Retry your episode ratings',
      exact: true
    }).click()

    await expect(episodeRegion(page).getByRole('button', { name: /^Rate episode,/u })).toBeEnabled()
    await expect(page.getByRole('alert')).toHaveCount(0)

    await expect(page.getByRole('region', {
      name: 'Season 2 episode ratings',
      exact: true
    })).toBeFocused()
  })

})

test.describe('public episode batch errors', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: `/api/catalog/items/${episodeEdgeSeries.id}/seasons/2/episodes/rating-summaries`,
    status: 503
  }] } })

  test('keeps the episode list usable and restores focus after a public batch retry', async ({ context, page }) => {
    const batchPath = `/api/catalog/items/${episodeEdgeSeries.id}/seasons/2/episodes/rating-summaries`

    await addCookie(context, 'tv_session', 'e2e-session')

    await page.route(`**${batchPath}`, async route => {
      await route.fulfill({
        status: 503,

        json: { error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Unavailable'
        } }
      })
    }, { times: 1 })

    await page.goto(titlePath)
    await openEpisodes(page)
    await expect(page.getByRole('alert')).toHaveText('We couldn’t load episode viewer ratings. The episode list is still available.')

    await expect(page.getByRole('button', {
      name: 'Watched',
      exact: true
    }).first()).toBeEnabled()

    const first = episodeRegion(page)

    await expect(first.getByRole('button', { name: /^Rate episode,/u })).toBeEnabled()

    const retry = page.getByRole('button', {
      name: 'Retry episode viewer ratings',
      exact: true
    })

    await retry.focus()
    await page.keyboard.press('Enter')
    await expect(first.getByText('0 ratings', { exact: true })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(retry).toHaveCount(0)

    await expect(page.getByRole('region', {
      name: 'Season 2 episode ratings',
      exact: true
    })).toBeFocused()
  })
})
