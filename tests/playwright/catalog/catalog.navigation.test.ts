import { expect, test } from '../fixtures/global.fixtures.ts'
import { waitForHydration } from './helpers.ts'

test('keeps public catalog navigation and search usable while account restoration is pending', async ({ page }) => {
  await page.goto('/sign-in')
  await waitForHydration(page)

  const started = Promise.withResolvers<null>()
  const release = Promise.withResolvers<null>()
  const finished = Promise.withResolvers<null>()

  await page.route('**/api/auth/session', async route => {
    started.resolve(null)

    await release.promise

    try {
      await route.fulfill({ json: { user: null } })
    } finally {
      finished.resolve(null)
    }
  }, { times: 1 })

  try {
    await page.getByRole('link', { name: 'TV home' }).click()

    await started.promise

    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { name: 'Your catalog starts here.' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Discover titles' })).toBeVisible()

    const input = page.getByRole('textbox', { name: 'Search movies and series' })

    await input.fill('Dark')
    await input.press('Enter')
    await expect(page.getByRole('region', { name: 'Search results' }).getByRole('listitem')).toHaveCount(2)
    release.resolve(null)

    await finished.promise

    await expect(page.getByRole('link', {
      name: 'Sign in',
      exact: true
    })).toBeVisible()

    await expect(page.getByRole('region', { name: 'Search results' }).getByRole('listitem')).toHaveCount(2)
  } finally {
    release.resolve(null)
    await page.unrouteAll({ behavior: 'wait' })
  }
})

