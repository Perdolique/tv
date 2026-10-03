import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { appBaseUrl } from '../constants.ts'
import { chernobyl, dune } from './details.fixtures.ts'
import { waitForHydration } from './helpers.ts'

const titlePath = `/titles/${dune.id}`
const summaryPath = `/api/catalog/items/${dune.id}/rating-summary`
const summaryRoute = `**${summaryPath}`

function observeSummaryReads(page: Page): string[] {
  const reads: string[] = []

  page.on('request', request => {
    if (request.url().endsWith(summaryPath)) {
      reads.push(request.url())
    }
  })

  return reads
}

test.describe('public viewer rating', () => {
  test('renders on the server for guests and reuses the result during hydration', async ({ page }) => {
    const browserReads = observeSummaryReads(page)
    const response = await page.goto(titlePath)

    expect(response?.status()).toBe(200)

    const html = await response?.text()

    expect(html).toContain('TV viewer rating')
    expect(html).toContain('Not rated')
    await waitForHydration(page)
    await expect(page.getByRole('region', { name: 'TV viewer rating' }).getByText('Not rated', { exact: true })).toBeVisible()

    await expect(page.getByRole('link', {
      name: 'Rate',
      exact: true
    })).toBeVisible()

    await expect(page.getByRole('region', { name: 'TV viewer rating' }).getByText('0 ratings', { exact: true })).toBeVisible()
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    expect(browserReads).toStrictEqual([])
  })

  test('shows a singular count without a disclosure control', async ({ context, page }) => {
    await context.addCookies([{
      name: `tv_rating_first_${dune.id}`,
      value: '8',
      url: appBaseUrl
    }])

    await page.goto(titlePath)
    await waitForHydration(page)

    const viewer = page.getByRole('region', { name: 'TV viewer rating' })

    await expect(viewer.getByText('1 rating', { exact: true })).toBeVisible()
    await expect(viewer.getByText('8 out of 10', { exact: true })).toBeVisible()
    await expect(viewer.getByRole('button')).toHaveCount(0)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
  })
})

test.describe('viewer rating updates', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([{
      name: 'tv_session',
      value: 'e2e-session',
      url: appBaseUrl
    }])
  })

  for (const item of [dune, chernobyl]) {
    test(`reloads the ${item.type} summary after saves and removal without optimistic averages`, async ({ page }) => {
      await page.goto(`/titles/${item.id}`)
      await waitForHydration(page)

      const viewer = page.getByRole('region', { name: 'TV viewer rating' })
      const personal = page.getByRole('region', { name: 'Your rating' })
      const summaryUrl = `/api/catalog/items/${item.id}/rating-summary`
      const release = Promise.withResolvers<boolean>()
      const readStarted = Promise.withResolvers<boolean>()

      await page.route(`**${summaryUrl}`, async route => {
        readStarted.resolve(true)

        await release.promise

        await route.continue()
      }, { times: 1 })

      try {
        await personal.getByRole('button', {
          name: 'Rate',
          exact: true
        }).click()

        await personal.getByRole('button', {
          name: '7 out of 10',
          exact: true
        }).click()

        await readStarted.promise

        await expect(personal.getByRole('status').filter({ hasText: 'Rating saved.' })).toHaveText('Rating saved.')
        await expect(personal.getByRole('dialog')).toHaveCount(0)
        await expect(viewer.getByText('Not rated', { exact: true })).toBeVisible()
        release.resolve(true)
        await expect(viewer.getByText('7 out of 10', { exact: true })).toBeVisible()
        await expect(viewer.getByText('1 rating', { exact: true })).toBeVisible()

        await personal.getByRole('button', {
          name: 'Rate, your rating: 7 out of 10',
          exact: true
        }).click()

        await personal.getByRole('button', {
          name: '9 out of 10',
          exact: true
        }).click()

        await expect(viewer.getByText('9 out of 10', { exact: true })).toBeVisible()

        await personal.getByRole('button', {
          name: 'Rate, your rating: 9 out of 10',
          exact: true
        }).click()

        await personal.getByRole('button', { name: 'Remove rating' }).click()
        await expect(personal.getByRole('status').filter({ hasText: 'Rating removed.' })).toHaveText('Rating removed.')
        await expect(viewer.getByText('Not rated', { exact: true })).toBeVisible()
        await expect(viewer.getByText('0 ratings', { exact: true })).toBeVisible()
      } finally {
        release.resolve(true)
      }
    })
  }

  test('keeps title HTTP status and personal controls when the initial summary fails', async ({ context, page }) => {
    await context.addCookies([{
      name: 'fail_rating_summary',
      value: '1',
      url: appBaseUrl
    }])

    const response = await page.goto(titlePath)

    expect(response?.status()).toBe(200)
    await waitForHydration(page)

    await expect(page.getByRole('heading', {
      name: 'Dune',
      exact: true
    })).toBeVisible()

    const viewer = page.getByRole('region', { name: 'TV viewer rating' })

    const rate = page.getByRole('button', {
      name: 'Rate',
      exact: true
    })

    await expect(viewer.getByText('Viewer rating unavailable', { exact: true })).toBeVisible()
    await expect(page.getByText('Not rated', { exact: true })).toHaveCount(0)
    await expect(page.getByText('private summary database details')).toHaveCount(0)
    await expect(rate).toBeEnabled()
    await rate.click()

    const dialog = page.getByRole('dialog', { name: 'Your rating' })

    await expect(dialog).toBeVisible()
    await expect(viewer.getByText('Viewer rating unavailable', { exact: true })).toBeVisible()

    await dialog.getByRole('button', {
      name: 'Close rating',
      exact: true
    }).click()

    await expect(dialog).toHaveCount(0)
    await context.clearCookies({ name: 'fail_rating_summary' })
    await page.getByRole('button', { name: 'Retry viewer rating' }).click()
    await expect(viewer.getByText('Not rated', { exact: true })).toBeVisible()
  })

  test.describe('failed refresh', () => {
    test.use({ expectedHttpErrors: { values: [{
      pathname: summaryPath,
      status: 503
    }] } })

    test('keeps the previous average and saved personal score, then retries the summary', async ({ context, page }) => {
      await context.addCookies([{
        name: `tv_rating_first_${dune.id}`,
        value: '7',
        url: appBaseUrl
      }])

      await page.goto(titlePath)
      await waitForHydration(page)

      await page.route(summaryRoute, async route => {
        await route.fulfill({
          status: 503,

          json: { error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'private database details'
          } }
        })
      }, { times: 1 })

      await page.getByRole('region', { name: 'Your rating' }).getByRole('button', {
        name: 'Rate, your rating: 7 out of 10',
        exact: true
      }).click()

      await page.getByRole('button', {
        name: '9 out of 10',
        exact: true
      }).click()

      await expect(page.getByRole('region', { name: 'Your rating' }).getByRole('status').filter({ hasText: 'Rating saved.' })).toHaveText('Rating saved.')
      await expect(page.getByRole('region', { name: 'TV viewer rating' }).getByText('7 out of 10', { exact: true })).toBeVisible()
      await expect(page.getByRole('region', { name: 'TV viewer rating' }).getByText('Viewer rating update failed. Try again.', { exact: true })).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByText('private database details')).toHaveCount(0)
      await page.getByRole('button', { name: 'Retry viewer rating' }).click()
      await expect(page.getByRole('region', { name: 'TV viewer rating' })).toBeFocused()
      await expect(page.getByRole('region', { name: 'TV viewer rating' }).getByText('9 out of 10', { exact: true })).toBeVisible()
      await expect(page.getByRole('region', { name: 'TV viewer rating' }).getByText('Viewer rating update failed. Try again.')).toHaveCount(0)
    })
  })
})

test.describe('unconfirmed rating writes', () => {
  const ratingPath = `/api/catalog/items/${dune.id}/rating`

  test.use({ expectedHttpErrors: { values: [{
    pathname: ratingPath,
    status: 503
  }] } })

  test('does not refresh the summary after a failed personal save', async ({ context, page }) => {
    await context.addCookies([
      {
        name: 'tv_session',
        value: 'e2e-session',
        url: appBaseUrl
      },
      {
        name: `tv_rating_first_${dune.id}`,
        value: '7',
        url: appBaseUrl
      }
    ])

    await page.goto(titlePath)
    await waitForHydration(page)

    const personal = page.getByRole('region', { name: 'Your rating' })

    await expect(personal.getByRole('button', {
      name: 'Rate, your rating: 7 out of 10',
      exact: true
    })).toBeEnabled()

    const reads = observeSummaryReads(page)

    await page.route(`**${ratingPath}`, async route => {
      await route.fulfill({
        status: 503,
        json: { error: { code: 'SERVICE_UNAVAILABLE' } }
      })
    }, { times: 1 })

    await personal.getByRole('button', {
      name: 'Rate, your rating: 7 out of 10',
      exact: true
    }).click()

    await personal.getByRole('button', {
      name: '9 out of 10',
      exact: true
    }).click()

    await expect(personal.getByRole('alert')).toHaveText('We couldn’t save your rating. Try again.')
    await expect(personal.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('region', { name: 'TV viewer rating' }).getByText('7 out of 10', { exact: true })).toBeVisible()
    expect(reads).toStrictEqual([])
  })
})
