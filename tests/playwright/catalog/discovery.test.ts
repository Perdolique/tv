import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { waitForHydration } from './helpers.ts'
import { discoveryCollection, discoveryItems } from './discovery.fixtures.ts'
import { arrival, dark } from './fixtures.ts'
import { dune } from './details.fixtures.ts'

async function mockDiscoveryPagination(page: Page): Promise<void> {
  const [base] = discoveryItems

  const items = Array.from({ length: 25 }, (_value, index) => {
    const position = index + 1
    const idPart = String(position)
    const idSuffix = idPart.padStart(12, '0')

    return {
      ...base,
      id: `019f0010-0000-7000-8000-${idSuffix}`,
      title: `Pagination movie ${position}`
    }
  })

  await page.route('**/api/catalog/discovery/recent*', async route => {
    const request = route.request()
    const requestUrl = request.url()
    const url = new URL(requestUrl)
    const pageNumber = url.searchParams.get('page')
    const secondPage = pageNumber === '2'
    const pageItems = secondPage ? items.slice(24) : items.slice(0,24)

    await route.fulfill({ json: {
      items: pageItems,
      nextPage: secondPage ? null : 2
    } })
  })

}

test('lets a guest discover, search, clear, and browse a related collection without duplicate hydration fetches', async ({ page, context }) => {
  await addCookie(context, 'catalog_discovery', '1')

  const reads: string[] = []

  page.on('request', request => { reads.push(request.url()) })

  const response = await page.goto('/')
  const html = await response?.text()

  expect(html).toContain('Screen worlds')
  await waitForHydration(page)
  await expect(page.getByRole('heading', { name: 'Recently added' })).toBeVisible()

  const browserDiscoveryReads = reads.filter(url => url.includes('/api/catalog/discovery'))

  expect(browserDiscoveryReads).toStrictEqual([])

  const input = page.getByRole('textbox', { name: 'Search movies and series' })

  await input.fill('Dark')
  await expect(page.getByRole('region', { name: 'Search results' }).getByRole('listitem')).toHaveCount(2)
  await expect(page.getByRole('region', { name: 'Discover titles' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(page.getByRole('heading', { name: 'Recently added' })).toBeVisible()

  await page.getByRole('region', {
    name: 'Screen worlds',
    exact: true
  }).getByRole('link', { name: 'View collection' }).click()

  await expect(page).toHaveURL(`/collections/${discoveryCollection.id}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Screen worlds')

  await page.getByRole('link').filter({ has: page.getByRole('heading', {
    name: 'Dune',
    exact: true
  }) }).click()

  await expect(page).toHaveURL(`/titles/${dune.id}`)

  const related = page.getByRole('region', {
    name: 'Screen worlds',
    exact: true
  })

  await expect(related.getByText('Current title')).toBeVisible()
  await expect(related.locator('a[aria-current="page"]')).toContainText('Dune')
})

test('publishes a mixed manual collection, reorders it with the keyboard, and makes saved edits public', async ({ page, context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'catalog_manager', '1')
  await page.goto('/manage/collections/new')
  await waitForHydration(page)
  await page.getByRole('textbox', { name: 'Collection name' }).fill('A science fiction evening')
  await page.getByRole('textbox', { name: 'Description (optional)' }).fill('Movies and series in our viewing order.')
  await page.getByRole('checkbox', { name: 'Show on home' }).check()
  await page.getByRole('searchbox', { name: 'Search catalog' }).fill('Arrival')

  await page.getByRole('button', {
    name: 'Search',
    exact: true
  }).click()

  await page.getByRole('button', {
    name: 'Add Arrival',
    exact: true
  }).click()

  await page.getByRole('searchbox', { name: 'Search catalog' }).fill('Dark')

  await page.getByRole('button', {
    name: 'Search',
    exact: true
  }).click()

  await page.getByRole('button', {
    name: 'Add Dark',
    exact: true
  }).click()

  await page.getByRole('button', {
    name: 'Move Dark up',
    exact: true
  }).focus()

  await page.keyboard.press('Enter')

  const ordered = page.getByRole('region', { name: 'Titles in order' })
  const darkRow = ordered.getByRole('listitem').filter({ hasText: 'Dark' })

  await expect(ordered.getByRole('listitem').locator('strong')).toHaveText(['Dark','Arrival'])
  await expect(darkRow).toBeFocused()
  await expect(page.getByRole('button', { name: 'Move Dark up' })).toBeDisabled()
  await page.getByRole('button', { name: 'Move Dark down' }).focus()
  await page.keyboard.press('Enter')
  await expect(ordered.getByRole('listitem').locator('strong')).toHaveText(['Arrival','Dark'])
  await expect(darkRow).toBeFocused()
  await expect(page.getByRole('button', { name: 'Move Dark down' })).toBeDisabled()
  await page.getByRole('button', { name: 'Move Dark up' }).focus()
  await page.keyboard.press('Enter')
  await expect(ordered.getByRole('listitem').locator('strong')).toHaveText(['Dark','Arrival'])
  await expect(darkRow).toBeFocused()
  await page.getByRole('button', { name: 'Save and publish' }).click()
  await expect(page.getByRole('heading', { name: 'Edit collection' })).toBeVisible()
  await expect(ordered.getByRole('listitem').locator('strong')).toHaveText(['Dark','Arrival'])

  await page.getByRole('link', {
    name: 'View collection',
    exact: true
  }).click()

  await expect(page.getByRole('listitem').getByRole('heading')).toHaveText(['Dark','Arrival'])
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('A science fiction evening')
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
  await page.getByRole('link', { name: 'Back to catalog' }).click()

  await expect(page.getByRole('region', { name: 'A science fiction evening' }).getByRole('heading', {
    name: 'Dark',
    exact: true
  })).toBeVisible()
})

const conflictTest = test.extend({ expectedHttpErrors: { values: [{
  pathname: `/api/catalog/manage/collections/${discoveryCollection.id}`,
  status: 409
}] } })

// oxlint-disable-next-line vitest/require-hook -- This is a Playwright test with expected HTTP errors.
conflictTest('keeps an editor draft after a stale save without overwriting the newer public version', async ({ page, context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'catalog_manager', '1')
  await addCookie(context, 'catalog_discovery', '1')

  const editorReads: string[] = []

  page.on('request', request => { editorReads.push(request.url()) })
  await page.goto(`/manage/collections/${discoveryCollection.id}`)
  await waitForHydration(page)

  const browserEditorReads = editorReads.filter(url => url.includes(`/api/catalog/manage/collections/${discoveryCollection.id}`))

  expect(browserEditorReads).toStrictEqual([])
  await page.getByRole('textbox', { name: 'Collection name' }).fill('My unsaved collection name')

  const response = await context.request.put(`/api/catalog/manage/collections/${discoveryCollection.id}`, { data: {
    title: 'Changed elsewhere',
    description: null,
    isFeatured: true,
    revision: 1,
    itemIds: [dark.id,arrival.id]
  } })

  expect(response.status()).toBe(200)
  await page.getByRole('button', { name: 'Save and publish' }).click()
  await expect(page.getByRole('alert')).toContainText('changed elsewhere')
  await expect(page.getByRole('textbox', { name: 'Collection name' })).toHaveValue('My unsaved collection name')

  await page.getByRole('link', {
    name: 'View collection',
    exact: true
  }).click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Changed elsewhere')
  await expect(page.getByRole('listitem').getByRole('heading')).toHaveText(['Dark','Arrival'])
})

const failureTest = test.extend({ expectedHttpErrors: { values: [{
  pathname: '/api/catalog/discovery',
  status: 503
}] } })

// oxlint-disable-next-line vitest/require-hook -- This is a Playwright test with expected HTTP errors.
failureTest('recovers discovery after a client failure while keeping search available', async ({ page, context }) => {
  await addCookie(context, 'catalog_discovery', '1')
  await page.goto('/?query=Dark')
  await waitForHydration(page)

  await page.route('**/api/catalog/discovery', async route => {
    await route.fulfill({
      status: 503,

      json: { error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'private database detail'
      } }
    })
  }, { times: 1 })

  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(page.getByRole('alert')).toContainText('You can still search')
  await expect(page.getByRole('textbox', { name: 'Search movies and series' })).toBeVisible()
  await expect(page.getByText('private database detail')).toHaveCount(0)
  await page.getByRole('button', { name: 'Retry collections' }).focus()
  await page.keyboard.press('Enter')

  await expect(page.getByRole('region', {
    name: 'Screen worlds',
    exact: true
  })).toBeVisible()

  await expect(page.getByRole('alert')).toHaveCount(0)

  await expect(page.getByRole('heading', {
    name: 'Recently added',
    exact: true
  })).toBeFocused()
})

test('loads the next public page without duplicates and keeps keyboard focus on the added title', async ({ page, context }) => {
  await addCookie(context, 'catalog_discovery', '1')
  await mockDiscoveryPagination(page)
  await page.goto('/')
  await waitForHydration(page)

  await page.getByRole('region', {
    name: 'Recently added',
    exact: true
  }).getByRole('link', { name: 'View all' }).click()

  await expect(page.getByRole('listitem')).toHaveCount(24)
  await page.getByRole('button', { name: 'Load more' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('listitem')).toHaveCount(25)
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0)

  await expect(page.getByRole('link').filter({ has: page.getByRole('heading', {
    name: 'Pagination movie 25',
    exact: true
  }) })).toBeFocused()
})

test('keeps collection editing behind sign-in and returns to the public catalog after signing out', async ({ page, context }) => {
  await page.goto('/manage/collections/new')
  await expect(page).toHaveURL(/\/sign-in\?redirectTo=/u)
  await expect(page.getByRole('textbox', { name: 'Collection name' })).toHaveCount(0)
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'catalog_manager', '1')
  await page.goto('/manage/collections/new')
  await waitForHydration(page)
  await page.getByRole('textbox', { name: 'Collection name' }).fill('Unpublished draft')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('textbox', { name: 'Collection name' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Your catalog starts here.' })).toBeVisible()
})

test('cancels collection deletion with focus intact and deletes only after confirmation', async ({ page, context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'catalog_manager', '1')
  await addCookie(context, 'catalog_discovery', '1')
  await page.goto(`/manage/collections/${discoveryCollection.id}`)
  await waitForHydration(page)

  const deleteButton = page.getByRole('button', {
    name: 'Delete collection',
    exact: true
  })

  await deleteButton.click()

  await page.getByRole('button', {
    name: 'Cancel',
    exact: true
  }).click()

  await expect(deleteButton).toBeFocused()
  await expect(page.getByRole('textbox', { name: 'Collection name' })).toHaveValue('Screen worlds')
  await deleteButton.click()

  await page.getByRole('button', {
    name: 'Confirm deletion',
    exact: true
  }).click()

  await expect(page).toHaveURL('/manage/collections')
  await expect(page.getByText('No collections yet. Create one to start grouping titles.')).toBeVisible()

  const removed = await context.request.get(`/api/catalog/collections/${discoveryCollection.id}`)

  expect(removed.status()).toBe(404)

  const retained = await context.request.get(`/api/catalog/items/${dune.id}`)

  expect(retained.status()).toBe(200)
})
