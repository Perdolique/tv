import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { waitForHydration } from './helpers.ts'
import { discoveryCollection } from './discovery.fixtures.ts'

const accessFailureTest = test.extend({ expectedHttpErrors: { values: [{
  pathname: '/api/catalog/imports/navigation',
  status: 503
}] } })

// oxlint-disable-next-line vitest/require-hook -- This is a Playwright test with expected HTTP errors.
accessFailureTest('keeps a collection draft when a delayed access check fails and is retried', async ({ page, context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'catalog_manager', '1')

  const started = Promise.withResolvers<null>()
  const release = Promise.withResolvers<null>()
  const finished = Promise.withResolvers<null>()

  await page.route('**/api/catalog/imports/navigation', async route => {
    started.resolve(null)

    await release.promise

    try {
      await route.fulfill({
        status: 503,

        json: { error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'private access details'
        } }
      })
    } finally {
      finished.resolve(null)
    }
  }, { times: 1 })

  try {
    await page.goto('/manage/collections/new')
    await waitForHydration(page)

    await started.promise

    await page.getByRole('textbox', { name: 'Collection name' }).fill('My unsaved collection')
    await page.getByRole('textbox', { name: 'Description (optional)' }).fill('Keep the draft until I publish it.')
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

    release.resolve(null)

    await finished.promise

    await page.getByRole('button', { name: 'Check access again' }).click()
    await expect(page.getByRole('textbox', { name: 'Collection name' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Collection name' })).toHaveValue('My unsaved collection')
    await expect(page.getByRole('textbox', { name: 'Description (optional)' })).toHaveValue('Keep the draft until I publish it.')
    await expect(page.getByRole('checkbox', { name: 'Show on home' })).toBeChecked()
    await expect(page.getByRole('region', { name: 'Titles in order' }).getByRole('listitem').locator('strong')).toHaveText(['Arrival'])
    await expect(page.getByText('private access details')).toHaveCount(0)
  } finally {
    release.resolve(null)
    await page.unrouteAll({ behavior: 'wait' })
  }
})

const repeatedLoadFailureTest = test.extend({ expectedHttpErrors: { values: [{
  pathname: `/api/catalog/manage/collections/${discoveryCollection.id}`,
  status: 503
}, {
  pathname: `/api/catalog/manage/collections/${discoveryCollection.id}`,
  status: 503
}, {
  pathname: `/api/catalog/manage/collections/${discoveryCollection.id}`,
  status: 503
}] } })

// oxlint-disable-next-line vitest/require-hook -- This is a Playwright test with expected HTTP errors.
repeatedLoadFailureTest('keeps failed collection load retries available after two more service failures', async ({ page, context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'catalog_manager', '1')
  await addCookie(context, 'catalog_discovery', '1')
  await page.goto('/manage/collections')
  await waitForHydration(page)

  const endpoint = `**/api/catalog/manage/collections/${discoveryCollection.id}`

  await page.route(endpoint, async route => {
    await route.fulfill({
      status: 503,

      json: { error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'private database details'
      } }
    })
  }, { times: 3 })

  await page.getByRole('link', {
    name: 'Edit',
    exact: true
  }).click()

  const retry = page.getByRole('button', {
    name: 'Try again',
    exact: true
  })

  await expect(page.getByRole('alert')).toContainText('load this collection')
  await expect(retry).toBeEnabled()

  // oxlint-disable eslint/no-await-in-loop -- Each keyboard retry must settle before the next retry reproduces an unchanged service failure.
  for (const attempt of [1, 2]) {
    const responsePromise = page.waitForResponse(endpoint)

    await retry.focus()
    await page.keyboard.press('Enter')

    const response = await responsePromise

    expect(response.status(), `retry ${attempt}`).toBe(503)
    await response.finished()
    await expect(retry).toBeEnabled()
    await expect(retry).toBeFocused()
    await expect(page.getByText('Loading collection…', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('alert')).toContainText('load this collection')
  }

  // oxlint-enable eslint/no-await-in-loop

  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Collection name' })).toHaveValue('Screen worlds')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('private database details')).toHaveCount(0)
})

