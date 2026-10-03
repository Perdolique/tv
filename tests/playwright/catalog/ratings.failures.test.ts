import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { appBaseUrl } from '../constants.ts'
import { dune } from './details.fixtures.ts'

const ratingPath = `/api/catalog/items/${dune.id}/rating`
const titlePath = `/titles/${dune.id}`
const ratingRoute = `**${ratingPath}`

test.beforeEach(async ({ context }) => {
  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])
})

async function holdRatingFailure(page: Page) {
  const response = Promise.withResolvers<boolean>()

  await page.route(ratingRoute, async route => {
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
      await expect(panel.getByRole('alert')).toContainText('Try again')
      await expect(chosenScore).toBeFocused()
      await expect(chosenScore).toHaveAttribute('aria-pressed', 'false')

      await expect(panel.getByRole('button', {
        name: 'Rate',
        exact: true
      })).toBeVisible()

      await expect(panel.getByRole('status')).toBeEmpty()
      await page.keyboard.press('Enter')
      await expect(panel.getByText('7 / 10', { exact: true })).toBeVisible()
    } finally {
      release()
    }
  })

  test('keeps the confirmed score after failed removal and allows retry', async ({ page }) => {
    const panel = page.getByRole('region', { name: 'Your rating' })
    const rate = page.getByRole('button', { name: /^(?:Rate|\d+ \/ 10)$/u })
    const remove = panel.getByRole('button', { name: 'Remove rating' })

    await page.goto(titlePath)
    await rate.click()

    await panel.getByRole('button', {
      name: '7 out of 10',
      exact: true
    }).click()

    await expect(panel.getByText('7 / 10', { exact: true })).toBeVisible()
    await rate.click()

    const release = await holdRatingFailure(page)

    try {
      await remove.focus()
      await page.keyboard.press('Enter')
      await expect(remove).toBeDisabled()
      release()
      await expect(panel.getByRole('alert')).toContainText('Try again')
      await expect(remove).toBeFocused()
      await expect(panel.getByText('7 / 10', { exact: true })).toBeVisible()
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
      await expect(panel.getByRole('alert')).toContainText('Try again')
      await expect(follow).toBeFocused()
      await expect(chosenScore).toHaveAttribute('aria-pressed', 'false')
    } finally {
      release()
    }
  })

  test.describe('failed read retry', () => {
    test.use({ expectedHttpErrors: { values: [{
      pathname: ratingPath,
      status: 503
    }, {
      pathname: ratingPath,
      status: 503
    }] } })

    test('offers retry instead of showing an unrated score when reading fails', async ({ page }) => {
      const first = await holdRatingFailure(page)

      first()
      await page.goto(titlePath)

      const panel = page.getByRole('region', { name: 'Your rating' })
      const retry = panel.getByRole('button', { name: 'Retry rating' })

      await expect(panel.getByRole('alert')).toContainText('load your rating')

      await expect(panel.getByRole('button', {
        name: 'Rate',
        exact: true
      })).toHaveCount(0)

      const release = await holdRatingFailure(page)

      try {
        await retry.focus()
        await page.keyboard.press('Enter')
        await expect(panel.getByText('Loading rating…')).toBeVisible()
        await expect(retry).toHaveCount(0)
        release()
        await expect(panel.getByRole('alert')).toContainText('load your rating')
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
