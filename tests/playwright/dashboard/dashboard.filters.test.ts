import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { waitForHydration } from '../catalog/helpers.ts'
import { paginatedHistory } from './fixtures.ts'

// Filtering is URL navigation; the summary remains an independent all-time response.
test('filters by keyboard, restores Back/Forward and reload, and focuses View all', async ({ page, context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'paginated_viewing', '1')
  await page.goto('/dashboard')
  await waitForHydration(page)

  const entries = page.getByRole('list', { name: 'Viewing entries' }).getByRole('listitem')

  const all = page.getByRole('radio', {
    name: 'All',
    exact: true
  })

  const watching = page.getByRole('radio', {
    name: 'Watching',
    exact: true
  })

  const completed = page.getByRole('radio', {
    name: 'Completed',
    exact: true
  })

  const requests: string[] = []

  page.on('request', request => { requests.push(request.url()) })
  await expect(all).toBeChecked()
  await expect(entries).toHaveCount(20)
  await expect(page.getByRole('list', { name: 'Currently watching series' }).getByRole('listitem')).toHaveCount(5)
  await all.focus()
  await page.keyboard.press('ArrowRight')
  await expect(watching).toBeChecked()
  await expect(watching).toBeFocused()
  await expect(page).toHaveURL(/\/dashboard\?status=watching$/u)
  await expect(entries).toHaveCount(7)
  await expect(page.locator('dd')).toHaveText(['0', '18', '7', '0'])
  await page.keyboard.press('ArrowRight')
  await expect(completed).toBeChecked()
  await expect(entries).toHaveCount(18)
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0)
  await page.goBack()
  await expect(watching).toBeChecked()
  await expect(entries).toHaveCount(7)
  await page.goForward()
  await expect(completed).toBeChecked()
  await expect(entries).toHaveCount(18)

  const privateRequests = requests.filter(url => url.includes('/api/catalog/viewing-'))

  expect(privateRequests.every(url => !url.includes('viewing-summary'))).toBe(true)
  expect(privateRequests.every(url => !url.includes('cursor='))).toBe(true)
  await page.reload()
  await waitForHydration(page)
  await expect(completed).toBeChecked()
  await expect(entries).toHaveCount(18)

  await page.getByRole('link', {
    name: 'View all',
    exact: true
  }).click()

  await expect(watching).toBeChecked()

  await expect(page.getByRole('heading', {
    name: 'Viewing history',
    exact: true
  })).toBeFocused()

  await expect(entries).toHaveCount(7)
})

test('offers Show all for an empty filter and regular title links for every viewing', async ({ page, context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await page.goto('/dashboard?status=watching')
  await waitForHydration(page)
  await expect(page.getByRole('heading', { name: 'No viewings with this status' })).toBeVisible()
  await page.getByRole('button', { name: 'Show all' }).click()
  await expect(page).toHaveURL(/\/dashboard$/u)
  await expect(page.getByRole('heading', { name: 'No viewings yet' })).toBeVisible()

  await expect(page.getByRole('heading', {
    name: 'Viewing history',
    exact: true
  })).toBeFocused()

  await addCookie(context, 'paginated_viewing', '1')
  await page.getByRole('button', { name: 'Refresh history' }).click()
  await expect(page.getByRole('list', { name: 'Viewing entries' }).getByRole('link')).toHaveCount(20)

  const hrefs = await page.getByRole('list', { name: 'Viewing entries' }).getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('href')))

  expect(hrefs).toStrictEqual(paginatedHistory.slice(0, 20).map(item => `/titles/${item.id}`))
  await expect(page.getByText('Not rated', { exact: true })).toHaveCount(10)
  await expect(page.getByText('8/10', { exact: true })).toHaveCount(10)
})

test('aborts an obsolete continuation when the status changes and preserves the new filter', async ({ page, context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'paginated_viewing', '1')
  await page.goto('/dashboard')
  await waitForHydration(page)

  const started = Promise.withResolvers<boolean>()
  const gate = Promise.withResolvers<boolean>()

  await page.route('**/api/catalog/viewing-history?cursor=*', async route => {
    started.resolve(true)

    await gate.promise

    await route.abort()
  })

  const cancelled = page.waitForEvent('requestfailed', request => request.url().includes('cursor='))

  await page.getByRole('button', { name: 'Load more' }).click()

  await started.promise

  await page.getByRole('radio', {
    name: 'Watching',
    exact: true
  }).check()

  const aborted = await cancelled

  expect(aborted.failure()?.errorText).toBe('net::ERR_ABORTED')
  gate.resolve(true)
  await expect(page.getByRole('list', { name: 'Viewing entries' }).getByRole('listitem')).toHaveCount(7)

  await expect(page.getByRole('radio', {
    name: 'Watching',
    exact: true
  })).toBeFocused()

  await expect(page.getByRole('region', {
    name: 'Viewing history',
    exact: true
  }).getByRole('status')).toHaveText('')
})
