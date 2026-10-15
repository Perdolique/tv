import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { paginatedHistory } from './fixtures.ts'

const cursorRecoveryTest = test.extend({ expectedHttpErrors: { values: [{
  pathname: '/api/catalog/viewing-history',
  status: 400
}, {
  pathname: '/api/catalog/viewing-history',
  status: 503
}, {
  pathname: '/api/catalog/viewing-history',
  status: 400
}] } })

// oxlint-disable-next-line vitest/require-hook -- The fixture declares the rejected cursor and failed first-page recovery.
cursorRecoveryTest('retains dashboard rows when cursor recovery fails and announces a successful refresh honestly', async ({ page, context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'paginated_viewing', '1')
  await page.goto('/dashboard')

  await expect(page.getByRole('list', {
    name: 'Viewing entries',
    exact: true
  }).getByRole('listitem')).toHaveCount(20)

  let failed = false

  await page.route('**/api/catalog/viewing-history**', async route => {
    const request = route.request()
    const requestUrl = request.url()
    const url = new URL(requestUrl)
    const hasCursor = url.searchParams.has('cursor')

    if (hasCursor) {
      await route.fulfill({
        status: 400,
        json: { error: { code: 'INVALID_CURSOR' } }
      })

      return
    }

    if (!failed) {
      failed = true

      await route.fulfill({
        status: 503,
        json: { error: { code: 'SERVICE_UNAVAILABLE' } }
      })

      return
    }

    const lastEntry = paginatedHistory.at(-1)

    await route.fulfill({ json: {
      items: [lastEntry],
      nextCursor: null
    } })
  })

  const button = page.getByRole('button', {
    name: 'Load more',
    exact: true
  })

  const history = page.getByRole('region', {
    name: 'Viewing history',
    exact: true
  })

  await button.click()
  await expect(history.getByRole('alert')).toHaveText('We couldn’t load older marks. Try again.')

  await expect(page.getByRole('list', {
    name: 'Viewing entries',
    exact: true
  }).getByRole('listitem')).toHaveCount(20)

  await expect(button).toBeEnabled()
  await expect(button).toBeFocused()
  await expect(history.getByRole('status')).toHaveText('')
  await button.click()

  await expect(page.getByRole('list', {
    name: 'Viewing entries',
    exact: true
  }).getByRole('listitem')).toHaveCount(1)

  await expect(page.getByRole('list', {
    name: 'Viewing entries',
    exact: true
  }).getByRole('listitem')).toContainText('Episode 1')

  await expect(history.getByRole('alert')).toHaveCount(0)
  await expect(history.getByRole('status')).toHaveText('History refreshed.')
})

