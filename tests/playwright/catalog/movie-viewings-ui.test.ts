import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { dune } from './details.fixtures.ts'
import { waitForHydration } from './helpers.ts'
import type { Page } from '@playwright/test'

test.use({ timezoneId: 'America/Los_Angeles' })

const path = `/titles/${dune.id}`

function observePointReads(page: Page): string[] {
  const paths: string[] = []

  page.on('request', request => {
    const requestUrl = request.url()
    const url = new URL(requestUrl)
    const method = request.method()
    const isViewingRecord = /\/viewings\/[^/]+$/u.test(url.pathname)
    const isPointRead = method === 'GET' && isViewingRecord

    if (isPointRead) { paths.push(url.pathname) }
  })

  return paths
}

test('keeps the movie watched command neutral and repeatable after saving', async ({ page, context }) => {
  const localEvening = new Date('2026-10-18T02:00:00Z')

  await page.clock.setFixedTime(localEvening)
  await addCookie(context, 'tv_session', 'e2e-session')
  await page.goto(path)
  await waitForHydration(page)

  const action = page.getByRole('region', { name: 'Watched action' })

  const button = action.getByRole('button', {
    name: 'Mark as watched',
    exact: true
  })

  const originalColor = await button.evaluate(element => {
    const styles = globalThis.getComputedStyle(element)

    return styles.color
  })

  await button.click()
  await expect(page.getByRole('list', { name: 'Movie viewings' }).getByRole('listitem')).toHaveCount(1)
  await expect(page.getByRole('list', { name: 'Movie viewings' }).getByText('Oct 17, 2026', { exact: true })).toBeVisible()
  await expect(button).toBeEnabled()
  await expect(button).not.toHaveClass(/is-watched/u)
  await expect(button).not.toHaveAttribute('aria-pressed')
  await expect(button).toHaveCSS('color', originalColor)
  await expect(action.getByText(/^\d+ viewings?$/u)).toHaveCount(0)
  await button.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('list', { name: 'Movie viewings' }).getByRole('listitem')).toHaveCount(2)
  await expect(button).toBeFocused()
  await page.goto('/dashboard')

  const dates = page.getByRole('list', { name: 'Viewing entries' }).locator('time')

  await expect(dates).toHaveCount(2)
  await expect(dates).toHaveText(['Oct 17, 2026', 'Oct 17, 2026'])
  await expect(dates.first()).toHaveAttribute('datetime', '2026-10-17')
})

test('requires one watched date when adding and editing a movie viewing', async ({ page, context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await page.goto(path)

  await page.getByRole('button', {
    name: 'Add past viewing',
    exact: true
  }).click()

  const date = page.getByLabel('Watched on', { exact: true })

  await expect(date).toBeFocused()
  await expect(page.locator('input[type="date"]')).toHaveCount(1)
  await date.fill('2020-02-03')

  await page.getByRole('button', {
    name: 'Save viewing',
    exact: true
  }).click()

  const row = page.getByRole('list', { name: 'Movie viewings' }).getByRole('listitem')

  await expect(row.getByText('Feb 3, 2020', { exact: true })).toBeVisible()
  await expect(row.getByText('Started on', { exact: true })).toHaveCount(0)
  await expect(row.getByRole('link', { name: 'Link to viewing' })).toHaveCount(0)

  await row.getByRole('button', {
    name: 'Edit date',
    exact: true
  }).click()

  await expect(date).toHaveValue('2020-02-03')
  await date.clear()

  await page.getByRole('button', {
    name: 'Save viewing',
    exact: true
  }).click()

  await expect(date).toBeFocused()
  await expect(date).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByText('Use a valid calendar date.', { exact: true })).toBeVisible()
  await expect(row.getByText(/^Recorded /u)).toHaveCount(0)
  await date.fill('2020-02-04')

  await page.getByRole('button', {
    name: 'Save viewing',
    exact: true
  }).click()

  await expect(row.getByText('Feb 4, 2020', { exact: true })).toBeVisible()
})

test('ignores an old viewing URL through deletion and reload while preserving other query values', async ({ page, context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
  await addCookie(context, 'tv_watched_item', dune.id)

  const staleId = '01991a00-0000-7000-8000-000000000099'
  const pointReads = observePointReads(page)
  const location = `${path}?viewingId=${staleId}&query=Dune#viewing-${staleId}`
  const cleanLocation = `${path}?query=Dune`

  await page.goto(location)
  await waitForHydration(page)
  await expect(page).toHaveURL(cleanLocation)

  const rows = page.getByRole('list', { name: 'Movie viewings' }).getByRole('listitem')

  await expect(rows).toHaveCount(1)

  await rows.getByRole('button', {
    name: 'Delete',
    exact: true
  }).click()

  await rows.getByRole('button', {
    name: 'Delete viewing',
    exact: true
  }).click()

  await expect(rows).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.reload()
  await waitForHydration(page)
  await expect(rows).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Retry linked viewing' })).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(pointReads).toStrictEqual([])
})
