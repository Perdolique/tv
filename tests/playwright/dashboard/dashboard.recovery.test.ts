import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { waitForHydration } from '../catalog/helpers.ts'
import { paginatedHistory } from './fixtures.ts'

const cursorRecoveryTest = test.extend({ expectedHttpErrors: { values: [
  {
      pathname: '/api/catalog/viewing-history',
      status: 400
    },
  {
      pathname: '/api/catalog/viewing-history',
      status: 503
    },
  {
      pathname: '/api/catalog/viewing-summary',
      status: 503
    }
] } })

// oxlint-disable-next-line vitest/require-hook -- The fixture declares cursor rejection and failed explicit refreshes.
cursorRecoveryTest('keeps loaded rows and totals until an explicit refresh succeeds', async ({ page, context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'paginated_viewing', '1')
  await page.goto('/dashboard')
  await waitForHydration(page)

  const rows = page.getByRole('list', {
    name: 'Viewing entries',
    exact: true
  }).getByRole('listitem')

  const history = page.getByRole('region', {
    name: 'Viewing history',
    exact: true
  })

  const refresh = page.getByRole('button', {
    name: 'Refresh history',
    exact: true
  })

  const more = page.getByRole('button', {
    name: 'Load more',
    exact: true
  })

  const pendingRefresh = Promise.withResolvers<boolean>()
  let firstPages = 0

  await expect(rows).toHaveCount(20)

  await page.route('**/api/catalog/viewing-history**', async route => {
    const url = new URL(route.request().url())

    if (url.searchParams.has('cursor')) {
      await route.fulfill({
        status: 400,

        json: { error: {
          code: 'INVALID_REQUEST',
          fields: { cursor: 'Refresh history.' }
        } }
      })

      return
    }

    firstPages += 1

    if (firstPages === 1) {
      await pendingRefresh.promise

      await route.fulfill({
        status: 503,
        json: { error: { code: 'SERVICE_UNAVAILABLE' } }
      })

      return
    }

    await route.fulfill({ json: {
      items: [paginatedHistory.at(-1)],
      nextCursor: null
    } })
  })

  await more.click()
  await expect(history.getByRole('status')).toHaveText('Your viewings changed. Refresh history to load more.')
  await expect(rows).toHaveCount(20)
  await expect(more).toHaveCount(0)
  expect(firstPages).toBe(0)
  await addCookie(context, 'fail_viewing_summary', '1')
  await refresh.click()
  await expect(refresh).toHaveAttribute('aria-busy', 'true')
  await expect(rows).toHaveCount(20)
  await expect(page.locator('dd')).toHaveText(['0', '18', '7', '0'])
  pendingRefresh.resolve(true)
  await expect(history.getByRole('alert')).toContainText('We couldn’t refresh your history.')
  await expect(page.getByRole('region', { name: 'Viewing summary error' }).getByRole('alert')).toContainText('Your previous totals are still here.')
  await expect(refresh).toBeFocused()
  await expect(rows).toHaveCount(20)
  await expect(history.getByRole('status')).toHaveText('')
  await refresh.click()
  await expect(rows).toHaveCount(1)
  await expect(rows.getByRole('link')).toHaveAttribute('data-viewing-id', paginatedHistory.at(-1)?.viewingId ?? '')
  await expect(history.getByRole('alert')).toHaveCount(0)
  await expect(history.getByRole('status')).toHaveText('History refreshed.')
  await expect(page.getByRole('region', { name: 'Viewing summary error' })).toHaveCount(0)
})

test('does not move newer focus after a delayed continuation', async ({ page, context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'paginated_viewing', '1')
  await page.goto('/dashboard')
  await waitForHydration(page)

  const gate = Promise.withResolvers<boolean>()
  const started = Promise.withResolvers<boolean>()

  await page.route('**/api/catalog/viewing-history?cursor=*', async route => {
    started.resolve(true)

    await gate.promise

    await route.fulfill({ json: {
      items: paginatedHistory.slice(20),
      nextCursor: null
    } })
  })

  await page.getByRole('button', { name: 'Load more' }).click()

  await started.promise

  const all = page.getByRole('radio', {
    name: 'All',
    exact: true
  })

  await all.focus()
  gate.resolve(true)
  await expect(page.getByRole('list', { name: 'Viewing entries' }).getByRole('listitem')).toHaveCount(25)
  await expect(all).toBeFocused()
})

for (const target of ['history', 'summary'] as const) {
  const pathname = `/api/catalog/viewing-${target}`

  const retryTest = test.extend({ expectedHttpErrors: { values: [{
    pathname,
    status: 503
  }] } })

  retryTest(`keeps the ${target} retry action stable and respects newer focus`, async ({ page, context }) => {
    await addCookie(context, 'tv_session', 'e2e-session')
    await addCookie(context, 'paginated_viewing', '1')
    await page.goto('/')
    await waitForHydration(page)
    await addCookie(context, `fail_viewing_${target}`, '1')

    await page.getByRole('link', {
      name: 'Dashboard',
      exact: true
    }).click()

    const retry = page.getByRole('button', {
      name: `Retry ${target}`,
      exact: true
    })

    await expect(retry).toBeVisible()

    const gate = Promise.withResolvers<boolean>()
    const started = Promise.withResolvers<boolean>()

    await page.route(`**${pathname}`, async route => {
      const response = await route.fetch()

      started.resolve(true)

      await gate.promise

      await route.fulfill({ response })
    })

    await retry.click()

    await started.promise

    await expect(retry).toBeFocused()
    await expect(retry).toHaveAttribute('aria-busy', 'true')

    const all = page.getByRole('radio', {
      name: 'All',
      exact: true
    })

    await all.focus()
    gate.resolve(true)
    await expect(retry).toHaveCount(0)
    await expect(all).toBeFocused()
  })
}
