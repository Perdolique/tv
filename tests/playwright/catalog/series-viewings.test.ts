import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { chernobyl } from './details.fixtures.ts'
import { openEpisodes, waitForHydration } from './helpers.ts'

const path = `/titles/${chernobyl.id}`

function history(page: Page) {
  return page.getByRole('list', {
    name: 'Series viewings',
    exact: true
  })
}

function episodeRating(page: Page) {
  return page.getByRole('region', {
    name: 'Ratings for season 1, episode 1',
    exact: true
  })
}

async function rateSeries(page: Page, score: number): Promise<void> {
  const panel = page.getByRole('region', {
    name: 'Your rating',
    exact: true
  })

  await panel.getByRole('button', { name: /^Rate(?:, your rating: \d+ out of 10)?$/u }).click()

  await panel.getByRole('button', {
    name: `${score} out of 10`,
    exact: true
  }).click()
}

async function rateEpisode(page: Page, score: number): Promise<void> {
  const panel = episodeRating(page)

  await panel.getByRole('button', { name: /^(?:Rate episode, Your rating for season 1, episode 1|Your rating for season 1, episode 1: \d+ out of 10)$/u }).click()

  await panel.getByRole('button', {
    name: `${score} out of 10`,
    exact: true
  }).click()
}

test.beforeEach(async ({ context, page }) => {
  await addCookie(context, 'tv_session', 'e2e-session')

  const now = new Date('2026-10-17T12:00:00Z')

  await page.clock.setFixedTime(now)
})

test('completes partial progress, reopens the same viewing and isolates historical scores from the new viewing vote', async ({ page }) => {
  await page.goto(path)
  await waitForHydration(page)
  await rateSeries(page, 6)
  await openEpisodes(page)
  await rateEpisode(page, 8)
  await expect(page.getByText('1 watched episode', { exact: true })).toBeVisible()

  const first = history(page).getByRole('listitem').first()

  await test.step('complete and reopen while keeping partial progress and scores', async () => {
    await first.getByRole('button', {
      name: 'Complete viewing',
      exact: true
    }).click()

    await first.getByLabel('Completed on', { exact: true }).fill('2026-10-17')

    await first.getByRole('button', {
      name: 'Save viewing',
      exact: true
    }).click()

    await expect(first.getByRole('heading', { name: /^Completed viewing/u })).toBeVisible()
    await expect(page.getByText('1 watched episode', { exact: true })).toBeVisible()
    await expect(episodeRating(page).getByText('8/10', { exact: true })).toBeVisible()

    await expect(page.getByRole('button', {
      name: 'Watched',
      exact: true
    }).and(page.locator('[aria-pressed="true"]'))).toHaveCount(1)

    await first.getByRole('button', {
      name: 'Reopen viewing',
      exact: true
    }).click()

    await first.getByRole('button', {
      name: 'Save viewing',
      exact: true
    }).click()

    await expect(first.getByRole('heading', { name: /^Watching viewing/u })).toBeVisible()
    await expect(history(page).getByRole('listitem')).toHaveCount(1)

    await expect(first.getByRole('button', {
      name: 'Current viewing rating: 6 out of 10',
      exact: true
    })).toBeVisible()

    await expect(episodeRating(page).getByText('8/10', { exact: true })).toBeVisible()
  })

  await test.step('start and rate an independent rewatch', async () => {
    await page.getByRole('button', {
      name: 'Start rewatch',
      exact: true
    }).click()

    const dialog = page.getByRole('dialog', {
      name: 'Start a rewatch',
      exact: true
    })

    await dialog.getByRole('button', {
      name: 'Complete current viewing and start rewatch',
      exact: true
    }).click()

    await expect(history(page).getByRole('listitem')).toHaveCount(2)
    await expect(page.getByText('0 watched episodes', { exact: true })).toBeVisible()
    await expect(episodeRating(page).getByText('8/10', { exact: true })).toHaveCount(0)
    await rateSeries(page, 4)
    await rateEpisode(page, 2)

    await expect(page.getByRole('button', {
      name: 'Cancel rewatch',
      exact: true
    })).toHaveCount(0)

    await expect(episodeRating(page).getByText('1 rating', { exact: true })).toBeVisible()
    await expect(episodeRating(page).getByText('2 out of 10', { exact: true })).toBeVisible()
  })

  const previous = history(page).getByRole('listitem').filter({ has: page.getByRole('button', {
    name: 'Past viewing rating: 6 out of 10',
    exact: true
  }) })

  await test.step('select and correct the previous episode without replacing the public vote', async () => {
    const selectPrevious = previous.getByRole('button', {
      name: 'View season and episode ratings',
      exact: true
    })

    await selectPrevious.click()
    await expect(selectPrevious).toHaveAttribute('aria-pressed', 'true')
    await expect(episodeRating(page).getByText('8/10', { exact: true })).toBeVisible()
    await rateEpisode(page, 9)
    await expect(episodeRating(page).getByText('9/10', { exact: true })).toBeVisible()
    await expect(episodeRating(page).getByText('2 out of 10', { exact: true })).toBeVisible()
    await expect(episodeRating(page).getByText('1 rating', { exact: true })).toBeVisible()

    await history(page).getByRole('listitem').filter({ hasText: 'Current' }).getByRole('button', {
      name: 'View season and episode ratings',
      exact: true
    }).click()

    await expect(episodeRating(page).getByText('2/10', { exact: true })).toBeVisible()
  })

  await test.step('delete the vote source and retain the older viewing without reviving its votes', async () => {
    const current = history(page).getByRole('listitem').filter({ hasText: 'Current' })

    await current.getByRole('button', {
      name: 'Delete',
      exact: true
    }).click()

    await current.getByRole('button', {
      name: 'Delete viewing',
      exact: true
    }).click()

    await expect(history(page).getByRole('listitem')).toHaveCount(1)

    await expect(previous.getByRole('button', {
      name: 'Past viewing rating: 6 out of 10',
      exact: true
    })).toBeVisible()

    await expect(page.getByRole('region', {
      name: 'TV viewer rating',
      exact: true
    }).getByText('0 ratings', { exact: true })).toBeVisible()

    await previous.getByRole('button', {
      name: 'View season and episode ratings',
      exact: true
    }).click()

    await expect(episodeRating(page).getByText('9/10', { exact: true })).toBeVisible()
    await expect(episodeRating(page).getByText('0 ratings', { exact: true })).toBeVisible()
  })
})

test('confirms removing a rated watched episode and preserves the score when confirmation is cancelled', async ({ page }) => {
  await page.goto(path)
  await openEpisodes(page)
  await rateEpisode(page, 8)

  const watched = page.getByRole('listitem').filter({ hasText: '1:23:45' }).getByRole('button', {
    name: 'Watched',
    exact: true
  })

  await watched.click()

  const dialog = page.getByRole('dialog', {
    name: 'Remove watched episode and rating',
    exact: true
  })

  await expect(dialog).toBeVisible()

  await dialog.getByRole('button', {
    name: 'Keep watched',
    exact: true
  }).click()

  await expect(watched).toHaveAttribute('aria-pressed', 'true')
  await expect(episodeRating(page).getByText('8/10', { exact: true })).toBeVisible()
  await watched.focus()
  await page.keyboard.press('Enter')

  await dialog.getByRole('button', {
    name: 'Remove mark and rating',
    exact: true
  }).click()

  await expect(dialog).not.toBeVisible()
  await expect(watched).toHaveAttribute('aria-pressed', 'false')
  await expect(episodeRating(page).getByText('8/10', { exact: true })).toHaveCount(0)
  await expect(episodeRating(page).getByText('0 ratings', { exact: true })).toBeVisible()
  await expect(watched).toBeFocused()
  await expect(history(page).getByRole('listitem')).toHaveCount(1)
  await page.reload()
  await openEpisodes(page)
  await expect(watched).toHaveAttribute('aria-pressed', 'false')
  await expect(episodeRating(page).getByText('0 ratings', { exact: true })).toBeVisible()
})

test.describe('selected viewing deletion recovery', () => {
  const api = `/api/catalog/items/${chernobyl.id}/viewings`
  const previousApi = `${api}/${chernobyl.id}`

  test.use({ expectedHttpErrors: { values: [{
    pathname: previousApi,
    status: 503
  }, {
    pathname: previousApi,
    status: 409
  }, {
    pathname: previousApi,
    status: 404
  }] } })

  test('returns selected episode ratings to the current viewing after a committed deletion retry returns a conflict', async ({ context, page }) => {
    await addCookie(context, 'tv_episode_rating_first_30000000-0000-7000-8000-000000000001', '8')
    await page.goto(path)
    await openEpisodes(page)
    await expect(episodeRating(page).getByText('8/10', { exact: true })).toBeVisible()

    await page.getByRole('button', {
      name: 'Start rewatch',
      exact: true
    }).click()

    await page.getByRole('dialog', {
      name: 'Start a rewatch',
      exact: true
    }).getByRole('button', {
      name: 'Complete current viewing and start rewatch',
      exact: true
    }).click()

    const previous = history(page).getByRole('listitem').filter({ has: page.getByRole('heading', { name: /^Completed viewing/u }) })

    const selectPrevious = previous.getByRole('button', {
      name: 'View season and episode ratings',
      exact: true
    })

    await selectPrevious.click()
    await expect(selectPrevious).toHaveAttribute('aria-pressed', 'true')
    await expect(episodeRating(page).getByText('8/10', { exact: true })).toBeVisible()

    const deletions: unknown[] = []
    const previousRoute = `**${previousApi}`

    await page.route(previousRoute, async route => {
      const request = route.request()

      // oxlint-disable-next-line vitest/no-conditional-in-test -- Reconciliation confirms the committed deletion with a point read.
      if (request.method() !== 'DELETE') {
        await route.continue()

        return
      }

      const input: unknown = request.postDataJSON()

      deletions.push(input)

      const committed = await route.fetch()

      // oxlint-disable-next-line vitest/no-conditional-in-test -- Only the first committed response is lost; the exact retry keeps the service's 409.
      if (deletions.length === 1) {
        expect(committed.status()).toBe(200)

        await route.fulfill({
          status: 503,
          json: { error: { code: 'SERVICE_UNAVAILABLE' } }
        })

        return
      }

      expect(committed.status()).toBe(409)
      await route.fulfill({ response: committed })
    })

    await previous.getByRole('button', {
      name: 'Delete',
      exact: true
    }).click()

    await previous.getByRole('button', {
      name: 'Delete viewing',
      exact: true
    }).click()

    const panel = page.getByRole('region', {
      name: 'Your viewings',
      exact: true
    })

    await expect(panel.getByRole('alert')).toContainText('Retry to check the same change.')

    const retryResponse = page.waitForResponse(previousRoute)

    await panel.getByRole('button', {
      name: 'Retry change',
      exact: true
    }).click()

    const retried = await retryResponse

    expect(retried.status()).toBe(409)
    expect(deletions).toHaveLength(2)
    expect(deletions[1]).toStrictEqual(deletions[0])
    await expect(history(page).getByRole('listitem')).toHaveCount(1)
    await expect(history(page).getByRole('heading', { name: /^Completed viewing/u })).toHaveCount(0)

    await expect(panel.getByRole('button', {
      name: 'Delete viewing',
      exact: true
    })).toHaveCount(0)

    await expect(panel.getByRole('button', {
      name: 'Retry change',
      exact: true
    })).toHaveCount(0)

    const currentSelection = history(page).getByRole('listitem').getByRole('button', {
      name: 'View season and episode ratings',
      exact: true
    })

    await expect(currentSelection).toHaveAttribute('aria-pressed', 'true')
    await expect(episodeRating(page).getByText('8/10', { exact: true })).toHaveCount(0)

    await expect(episodeRating(page).getByRole('button', {
      name: 'Rate episode, Your rating for season 1, episode 1',
      exact: true
    })).toBeEnabled()
  })
})
