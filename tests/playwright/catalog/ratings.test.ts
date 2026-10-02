/* oxlint-disable vitest/prefer-each -- Playwright uses generated tests for title and viewport variants. */
import { expect, test } from '../fixtures/global.fixtures.ts'
import { appBaseUrl } from '../constants.ts'
import { chernobyl, dune } from './details.fixtures.ts'
import { waitForHydration } from './helpers.ts'

const ratingPath = `/api/catalog/items/${dune.id}/rating`
const titlePath = `/titles/${dune.id}`

test.beforeEach(async ({ context }) => {
  await context.addCookies([{
    name: 'tv_session',
    value: 'e2e-session',
    url: appBaseUrl
  }])
})

for (const item of [dune, chernobyl]) {
  test(`rates ${item.type}, preserves the score across sessions and removes it`, async ({ context, page }) => {
    const path = `/titles/${item.id}`
    const panel = page.getByRole('region', { name: 'Your rating' })

    const rate = page.getByRole('button', {
      name: 'Rate',
      exact: true
    })

    await page.goto(path)
    await waitForHydration(page)
    await expect(panel.getByText('Not rated', { exact: true })).toBeVisible()
    await rate.click()
    await expect(panel.getByRole('button', { name: 'Save rating' })).toBeDisabled()

    await panel.getByRole('radio', {
      name: '7 out of 10',
      exact: true
    }).check()

    await panel.getByRole('button', { name: 'Save rating' }).click()
    await expect(panel.getByText('7 / 10', { exact: true })).toBeVisible()
    await expect(rate).toBeFocused()
    await expect(panel.getByRole('status')).toHaveText('Rating saved.')
    await rate.click()

    await panel.getByRole('radio', {
      name: '9 out of 10',
      exact: true
    }).check()

    await panel.getByRole('button', {
      name: 'Cancel',
      exact: true
    }).click()

    await expect(panel.getByText('7 / 10', { exact: true })).toBeVisible()
    await rate.click()

    await expect(panel.getByRole('radio', {
      name: '7 out of 10',
      exact: true
    })).toBeChecked()

    await panel.getByRole('radio', {
      name: '9 out of 10',
      exact: true
    }).check()

    await panel.getByRole('button', { name: 'Save rating' }).click()
    await expect(panel.getByText('9 / 10', { exact: true })).toBeVisible()
    await page.reload()
    await expect(panel.getByText('9 / 10', { exact: true })).toBeVisible()
    await context.clearCookies({ name: 'tv_session' })
    await page.reload()

    await expect(page.getByRole('link', {
      name: 'Rate',
      exact: true
    })).toBeVisible()

    await expect(panel.getByText('9 / 10', { exact: true })).toHaveCount(0)

    await context.addCookies([{
      name: 'tv_session',
      value: 'e2e-long-email-session',
      url: appBaseUrl
    }])

    await page.reload()
    await expect(panel.getByText('Not rated', { exact: true })).toBeVisible()

    await context.addCookies([{
      name: 'tv_session',
      value: 'e2e-session',
      url: appBaseUrl
    }])

    await page.reload()
    await expect(panel.getByText('9 / 10', { exact: true })).toBeVisible()
    await rate.click()
    await panel.getByRole('button', { name: 'Remove rating' }).click()
    await expect(panel.getByText('Not rated', { exact: true })).toBeVisible()
    await expect(rate).toBeFocused()

    await expect(page.getByRole('button', {
      name: 'Follow',
      exact: true
    })).toHaveAttribute('aria-pressed', 'false')
  })
}

test('shows loading, blocks overlapping writes and keeps the confirmed score until success', async ({ page }) => {
  const read = Promise.withResolvers<boolean>()
  const write = Promise.withResolvers<boolean>()
  const panel = page.getByRole('region', { name: 'Your rating' })

  const rate = page.getByRole('button', {
    name: 'Rate',
    exact: true
  })

  await page.route(`**${ratingPath}`, async route => {
    await read.promise

    await route.continue()
  }, { times: 1 })

  try {
    await page.goto(titlePath)
    await expect(panel.getByText('Loading rating…')).toBeVisible()
    await expect(rate).toBeDisabled()
    read.resolve(true)
    await rate.click()

    await panel.getByRole('radio', {
      name: '8 out of 10',
      exact: true
    }).check()

    await page.route(`**${ratingPath}`, async route => {
      await write.promise

      await route.continue()
    }, { times: 1 })

    await panel.getByRole('button', { name: 'Save rating' }).click()
    await expect(panel.getByText('Not rated', { exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Save rating' })).toBeDisabled()

    await expect(panel.getByRole('button', {
      name: 'Cancel',
      exact: true
    })).toBeDisabled()

    await expect(panel.getByRole('radio', {
      name: '9 out of 10',
      exact: true
    })).toBeDisabled()

    write.resolve(true)
    await expect(panel.getByText('8 / 10', { exact: true })).toBeVisible()

    await expect(page.getByRole('button', {
      name: 'Watched',
      exact: true
    })).toHaveAttribute('aria-pressed', 'false')
  } finally {
    read.resolve(true)
    write.resolve(true)
  }
})

test.describe('rating failures', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: ratingPath,
    status: 503
  }] } })

  test('keeps a failed draft and retries without false saved state', async ({ page }) => {
    const panel = page.getByRole('region', { name: 'Your rating' })

    await page.goto(titlePath)

    await page.getByRole('button', {
      name: 'Rate',
      exact: true
    }).click()

    await panel.getByRole('radio', {
      name: '7 out of 10',
      exact: true
    }).check()

    await page.route(`**${ratingPath}`, async route => {
      await route.fulfill({
        status: 503,

        json: { error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'The catalog is temporarily unavailable.'
        } }
      })
    }, { times: 1 })

    await panel.getByRole('button', { name: 'Save rating' }).click()
    await expect(panel.getByRole('alert')).toContainText('Try again')

    await expect(panel.getByRole('radio', {
      name: '7 out of 10',
      exact: true
    })).toBeChecked()

    await expect(panel.getByText('Not rated', { exact: true })).toBeVisible()
    await expect(panel.getByRole('status')).toBeEmpty()
    await panel.getByRole('button', { name: 'Save rating' }).click()
    await expect(panel.getByText('7 / 10', { exact: true })).toBeVisible()
  })

  test('keeps the confirmed score after failed removal and allows retry', async ({ page }) => {
    const panel = page.getByRole('region', { name: 'Your rating' })

    const rate = page.getByRole('button', {
      name: 'Rate',
      exact: true
    })

    await page.goto(titlePath)
    await rate.click()

    await panel.getByRole('radio', {
      name: '7 out of 10',
      exact: true
    }).check()

    await panel.getByRole('button', { name: 'Save rating' }).click()
    await expect(panel.getByText('7 / 10', { exact: true })).toBeVisible()
    await rate.click()

    await page.route(`**${ratingPath}`, async route => {
      await route.fulfill({
        status: 503,
        json: { error: { code: 'SERVICE_UNAVAILABLE' } }
      })
    }, { times: 1 })

    await panel.getByRole('button', { name: 'Remove rating' }).click()
    await expect(panel.getByRole('alert')).toContainText('Try again')
    await expect(panel.getByText('7 / 10', { exact: true })).toBeVisible()
    await expect(panel.getByRole('status')).toBeEmpty()
    await panel.getByRole('button', { name: 'Remove rating' }).click()
    await expect(panel.getByText('Not rated', { exact: true })).toBeVisible()
    await expect(rate).toBeFocused()
  })

  test('offers retry instead of showing an unrated score when reading fails', async ({ page }) => {
    await page.route(`**${ratingPath}`, async route => {
      await route.fulfill({
        status: 503,
        json: { error: { code: 'SERVICE_UNAVAILABLE' } }
      })
    }, { times: 1 })

    await page.goto(titlePath)

    const panel = page.getByRole('region', { name: 'Your rating' })

    await expect(panel.getByRole('alert')).toContainText('load your rating')
    await expect(panel.getByText('Not rated', { exact: true })).toHaveCount(0)
    await panel.getByRole('button', { name: 'Retry rating' }).click()
    await expect(panel.getByText('Not rated', { exact: true })).toBeVisible()

    await expect(page.getByRole('button', {
      name: 'Rate',
      exact: true
    })).toBeFocused()
  })
})

test.describe('expired rating session', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: ratingPath,
    status: 401
  }] } })

  test('sends a failed write to sign-in with a return path', async ({ context, page }) => {
    await page.goto(titlePath)

    await page.getByRole('button', {
      name: 'Rate',
      exact: true
    }).click()

    await page.getByRole('radio', {
      name: '7 out of 10',
      exact: true
    }).check()

    await context.clearCookies({ name: 'tv_session' })

    await page.route(`**${ratingPath}`, async route => {
      await route.fulfill({
        status: 401,
        json: { error: { code: 'AUTHENTICATION_REQUIRED' } }
      })
    }, { times: 1 })

    await page.getByRole('button', { name: 'Save rating' }).click()
    await expect(page).toHaveURL(/\/sign-in\?redirectTo=/u)

    const location = new URL(page.url())

    expect(location.searchParams.get('redirectTo')).toBe(titlePath)
  })
})
