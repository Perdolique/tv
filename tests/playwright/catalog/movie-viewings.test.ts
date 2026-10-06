import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { dune, chernobyl } from './details.fixtures.ts'
import { waitForHydration } from './helpers.ts'

const path = `/titles/${dune.id}`
const api = `/api/catalog/items/${dune.id}/viewings`

function history(page: Page) {
  return page.getByRole('list', {
    name: 'Movie viewings',
    exact: true
  })
}

function observeViewingRequests(page: Page): string[] {
  const requests: string[] = []

  page.on('request', request => { if (request.url().includes('/viewings')) { requests.push(request.url()) } })

  return requests
}
function observeCreationKeys(page: Page): string[] {
  const keys: string[] = []

  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/viewings')) {
      const body: unknown = request.postDataJSON()

      if (typeof body === 'object' && body !== null && 'requestId' in body) { keys.push(String(body.requestId)) }
    }
  })

  return keys
}
async function getViewingLink(page: Page): Promise<string> {
  const link = await history(page).getByRole('listitem').first().getByRole('link', { name: 'Link to viewing' }).getAttribute('href')

  if (link === null) { throw new Error('Missing viewing link') }

  return link
}

test('records first, repeat and past viewings, edits dates, cancels and confirms deletion, and opens exact dashboard links', async ({ context, page }) => {
  const repeat = page.getByRole('button', {
    name: 'Watched again',
    exact: true
  })

  await test.step('record the first viewing and a repeat with the keyboard', async () => {
    await addCookie(context, 'tv_session', 'e2e-session')
    await page.goto(path)

    await page.getByRole('button', {
      name: 'Mark as watched',
      exact: true
  }).click()

  await expect(repeat).toBeEnabled()
  await expect(history(page).getByRole('listitem')).toHaveCount(1)
  await repeat.focus()
  await page.keyboard.press('Enter')
  await expect(history(page).getByRole('listitem')).toHaveCount(2)
  await expect(repeat).toBeFocused()
  await expect(history(page).getByText('Current', { exact: true })).toHaveCount(1)

  })

  await test.step('add a past viewing and edit its dates', async () => {
    await page.getByRole('button', {
      name: 'Add past viewing',
      exact: true
  }).click()

  await expect(page.getByLabel('Started on', { exact: true })).toBeFocused()
  await page.getByLabel('Started on', { exact: true }).fill('2020-01-01')
  await page.getByLabel('Completed on', { exact: true }).fill('2019-12-31')

  await page.getByRole('button', {
    name: 'Save viewing',
    exact: true
  }).focus()

  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Completed on', { exact: true })).toBeFocused()
  await expect(page.getByLabel('Completed on', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  await page.getByLabel('Completed on', { exact: true }).fill('2020-01-02')

  await page.getByRole('button', {
    name: 'Save viewing',
    exact: true
  }).click()

  await expect(history(page).getByRole('listitem')).toHaveCount(3)

  const past = history(page).getByRole('listitem').first()

  await expect(past.getByText('Current', { exact: true })).toHaveCount(0)

  await past.getByRole('button', {
    name: 'Edit dates',
    exact: true
  }).click()

  await page.getByLabel('Completed on', { exact: true }).fill('2020-02-03')

  await page.getByRole('button', {
    name: 'Save viewing',
    exact: true
  }).click()

  await expect(past.getByText('Feb 3, 2020', { exact: true })).toBeVisible()

  const saved = page.getByRole('status').filter({ hasText: 'Viewing dates saved.' })

  await expect(saved).toBeVisible()

  await past.getByRole('button', {
    name: 'Edit dates',
    exact: true
  }).click()

  await expect(saved).toHaveCount(0)
  await page.getByLabel('Completed on', { exact: true }).fill('2020-02-04')

  await page.getByRole('button', {
    name: 'Save viewing',
    exact: true
  }).click()

  await expect(past.getByText('Feb 4, 2020', { exact: true })).toBeVisible()
  await expect(saved).toBeVisible()

  })

  const link = await getViewingLink(page)

  expect(link).toContain('?viewingId=')

  await test.step('cancel and confirm deletion of the current viewing', async () => {

    const current = history(page).getByRole('listitem').filter({ hasText: 'Current' })

    await current.getByRole('button', {
      name: 'Delete',
      exact: true
  }).click()

  await current.getByRole('button', {
    name: 'Cancel',
    exact: true
  }).click()

  await expect(history(page).getByRole('listitem')).toHaveCount(3)

  await current.getByRole('button', {
    name: 'Delete',
    exact: true
  }).click()

  await current.getByRole('button', {
    name: 'Delete viewing',
    exact: true
  }).click()

  await expect(history(page).getByRole('listitem')).toHaveCount(2)
  await expect(history(page).getByText('Current', { exact: true })).toHaveCount(0)
  })

  await test.step('reload and open the exact viewing link', async () => {
    await page.reload()
    await expect(history(page).getByRole('listitem')).toHaveCount(2)
    await page.goto(link)
    await expect(history(page).getByRole('listitem')).toHaveCount(2)
    await expect(history(page).getByText('Current', { exact: true })).toHaveCount(0)
  })

  await test.step('show separate dashboard rows and return to the exact viewing', async () => {
    await page.goto('/dashboard')
    await expect(page.locator('dd')).toHaveText(['2', '0'])
    await expect(page.getByText('Movie viewings', { exact: true })).toBeVisible()

    const entries = page.getByRole('list', { name: 'Viewing entries' }).getByRole('listitem')

    await expect(entries).toHaveCount(2)

    await expect(entries.getByRole('heading', {
      name: 'Dune',
      exact: true
  })).toHaveCount(2)

  await expect(entries.first().getByRole('link')).toHaveAttribute('href', /\?viewingId=.+#viewing-/u)
  await entries.first().getByRole('link').click()
  await expect(page).toHaveURL(/\?viewingId=/u)
  await expect(history(page).locator('[data-linked]')).toHaveCount(1)
  })
})

test('asks a guest to sign in for a linked movie and sends no private requests for series', async ({ page, context }) => {
  const requests = observeViewingRequests(page)

  await page.goto(`${path}?viewingId=${dune.id}#viewing-${dune.id}`)
  await waitForHydration(page)

  await expect(page.getByRole('link', {
    name: 'Sign in to view your history',
    exact: true
  }).last()).toBeVisible()

  expect(requests).toStrictEqual([])
  await addCookie(context, 'tv_session', 'e2e-session')
  await page.goto(`/titles/${chernobyl.id}`)
  await waitForHydration(page)

  await expect(page.getByRole('heading', {
    name: 'Your viewings',
    exact: true
  })).toHaveCount(0)

  expect(requests).toStrictEqual([])
})

test.describe('viewing failure recovery', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: api,
    status: 503
  }] } })

  test('keeps typed dates after failure and retries the creation key without an optimistic entry', async ({ page, context }) => {
    await addCookie(context, 'tv_session', 'e2e-session')
    await page.goto(path)

    await page.getByRole('button', {
      name: 'Add past viewing',
      exact: true
    }).click()

    await page.getByLabel('Started on', { exact: true }).fill('2020-01-01')
    await addCookie(context, 'fail_watched', '1')

    const keys = observeCreationKeys(page)

    await page.getByRole('button', {
      name: 'Save viewing',
      exact: true
    }).click()

    await expect(page.getByRole('alert')).toContainText('couldn’t save')
    await expect(page.getByLabel('Started on', { exact: true })).toHaveValue('2020-01-01')
    await expect(history(page).getByRole('listitem')).toHaveCount(0)

    await page.getByRole('button', {
      name: 'Save viewing',
      exact: true
    }).click()

    await expect(history(page).getByRole('listitem')).toHaveCount(1)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
  })
})
