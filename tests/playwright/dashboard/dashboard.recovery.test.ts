import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { waitForHydration } from '../catalog/helpers.ts'
import { paginatedHistory } from './fixtures.ts'

const cursorRecoveryTest = test.extend({ expectedHttpErrors: { values: [
  {
      pathname: '/api/catalog/viewing-history',
      status: 400
    }
] } })

// oxlint-disable-next-line vitest/require-hook -- The fixture declares cursor rejection during pagination.
cursorRecoveryTest('keeps loaded rows and totals after cursor rejection and recovers with a browser reload', async ({ page, context }) => {
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

  const more = page.getByRole('button', {
    name: 'Load more',
    exact: true
  })

  const refresh = page.getByRole('button', {
    name: 'Refresh history',
    exact: true
  })

  await expect(rows).toHaveCount(20)
  await expect(refresh).toHaveCount(0)

  await page.route('**/api/catalog/viewing-history?cursor=*', async route => {
    await route.fulfill({
      status: 400,

      json: { error: {
        code: 'INVALID_REQUEST',
        fields: { cursor: 'Your viewings changed.' }
      } }
    })
  })

  await more.click()
  await expect(more).toHaveCount(0)
  await expect(refresh).toHaveCount(0)
  await expect(history.getByRole('status')).toHaveText('Your viewings changed. Reload this page to load more.')
  await expect(rows).toHaveCount(20)
  await expect(page.locator('dd')).toHaveText(['0', '18', '7', '0'])
  await page.reload()
  await waitForHydration(page)
  await expect(rows).toHaveCount(20)
  await expect(more).toBeVisible()
  await expect(history.getByRole('status')).toHaveText('')
  await expect(history.getByText('Your viewings changed.', { exact: false })).toHaveCount(0)
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
