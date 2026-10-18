import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { appBaseUrl } from '../constants.ts'
import { dune } from './details.fixtures.ts'

const ratingPath = `/api/catalog/items/${dune.id}/rating`
const titlePath = `/titles/${dune.id}`
const ratingRoute = `**${ratingPath}`
const viewingPath = `/api/catalog/items/${dune.id}/viewings`

test.beforeEach(async ({ context }) => {
  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])
})

async function holdRatingFailure(page: Page, routePattern = ratingRoute) {
  const response = Promise.withResolvers<boolean>()

  await page.route(routePattern, async route => {
    await response.promise

    await route.fulfill({
      status: 503,
      json: { error: { code: 'SERVICE_UNAVAILABLE' } }
    })
  }, { times: 1 })

  return () => { response.resolve(true) }
}

test.describe('rating failures', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: ratingPath,
    status: 503
  }] } })

  test('retries a failed score button without false saved state', async ({ page }) => {
    const panel = page.getByRole('region', { name: 'Your rating' })

    const chosenScore = panel.getByRole('button', {
      name: '7 out of 10',
      exact: true
    })

    await page.goto(titlePath)

    await page.getByRole('button', {
      name: 'Rate',
      exact: true
    }).click()

    const release = await holdRatingFailure(page)

    try {
      await chosenScore.focus()
      await page.keyboard.press('Space')
      await expect(chosenScore).toBeDisabled()
      release()
      await expect(panel.getByRole('alert')).toHaveText('We couldn’t confirm whether this change was saved. Retry to check the same change.')

      await expect(panel.getByRole('button', {
        name: 'Retry rating',
        exact: true
      })).toBeFocused()

      await expect(chosenScore).toHaveAttribute('aria-pressed', 'false')

      await expect(panel.getByRole('button', {
        name: 'Rate',
        exact: true
      })).toBeVisible()

      await expect(panel.getByRole('status')).toBeEmpty()
      await page.keyboard.press('Enter')

      await expect(panel.getByRole('button', {
        name: 'Rate, your rating: 7 out of 10',
        exact: true
      })).toHaveText('Rate')
    } finally {
      release()
    }
  })

  test('keeps the confirmed score after failed removal and allows retry', async ({ page }) => {
    const panel = page.getByRole('region', { name: 'Your rating' })
    const rate = page.getByRole('button', { name: /^(?:Rate|Rate, your rating: \d+ out of 10)$/u })
    const remove = panel.getByRole('button', { name: 'Remove rating' })

    await page.goto(titlePath)
    await rate.click()

    await panel.getByRole('button', {
      name: '7 out of 10',
      exact: true
    }).click()

    await expect(panel.getByRole('button', {
      name: 'Rate, your rating: 7 out of 10',
      exact: true
    })).toHaveText('Rate')

    await rate.click()

    const release = await holdRatingFailure(page)

    try {
      await remove.focus()
      await page.keyboard.press('Enter')
      await expect(remove).toBeDisabled()
      release()
      await expect(panel.getByRole('alert')).toHaveText('We couldn’t confirm whether this change was saved. Retry to check the same change.')

      await expect(panel.getByRole('button', {
        name: 'Retry rating',
        exact: true
      })).toBeFocused()

      await expect(panel.getByRole('button', {
        name: 'Rate, your rating: 7 out of 10',
        exact: true
      })).toHaveText('Rate')

      await expect(panel.getByRole('status')).toBeEmpty()
      await page.keyboard.press('Enter')

      await expect(panel.getByRole('button', {
        name: 'Rate',
        exact: true
      })).toBeVisible()

      await expect(rate).toBeFocused()
    } finally {
      release()
    }
  })

  test('does not steal focus after a failed save when the user moved to another control', async ({ page }) => {
    const panel = page.getByRole('region', { name: 'Your rating' })

    const chosenScore = panel.getByRole('button', {
      name: '7 out of 10',
      exact: true
    })

    const follow = page.getByRole('button', {
      name: 'Follow',
      exact: true
    })

    await page.goto(titlePath)

    await page.getByRole('button', {
      name: 'Rate',
      exact: true
    }).click()

    const release = await holdRatingFailure(page)

    try {
      await chosenScore.focus()
      await page.keyboard.press('Enter')
      await expect(chosenScore).toBeDisabled()
      await follow.focus()
      release()
      await expect(panel.getByRole('alert')).toHaveText('We couldn’t confirm whether this change was saved. Retry to check the same change.')
      await expect(follow).toBeFocused()
      await expect(chosenScore).toHaveAttribute('aria-pressed', 'false')
    } finally {
      release()
    }
  })

  test.describe('failed read retry', () => {
    test.use({ expectedHttpErrors: { values: [{
      pathname: viewingPath,
      status: 503
    }, {
      pathname: viewingPath,
      status: 503
    }] } })

    test('offers retry instead of showing an unrated score when reading fails', async ({ page }) => {
      const viewingRoute = `**${viewingPath}`
      const first = await holdRatingFailure(page, viewingRoute)

      first()
      await page.goto(titlePath)

      const panel = page.getByRole('region', { name: 'Your rating' })
      const retry = panel.getByRole('button', { name: 'Retry rating' })

      await expect(page.getByRole('alert')).toHaveText('We couldn’t refresh your viewings. Try again.')

      await expect(panel.getByRole('button', {
        name: 'Rate',
        exact: true
      })).toHaveCount(0)

      const release = await holdRatingFailure(page, viewingRoute)

      try {
        await retry.focus()
        await page.keyboard.press('Enter')
        await expect(panel.getByRole('button', { name: 'Rate, loading rating…' })).toBeDisabled()
        await expect(page.getByRole('region', { name: 'Personal score' })).toContainText('Loading…')
        await expect(retry).toHaveCount(0)
        release()
        await expect(page.getByRole('alert')).toHaveText('We couldn’t refresh your viewings. Try again.')
        await expect(retry).toBeFocused()
        await page.keyboard.press('Enter')

        await expect(panel.getByRole('button', {
          name: 'Rate',
          exact: true
        })).toBeVisible()

        await expect(page.getByRole('button', {
          name: 'Rate',
          exact: true
        })).toBeFocused()
      } finally {
        release()
      }
    })
  })
})
