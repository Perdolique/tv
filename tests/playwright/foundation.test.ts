import { expect, test } from './fixtures/global.fixtures.ts'

test.describe('TV foundation', () => {
  test('hydrates the routed application without browser errors', async ({ page }) => {
    await page.goto('/sign-in')
    await expect(page).toHaveTitle('Sign in · TV')

    await expect(page.getByRole('heading', {
      level: 1,
      name: 'Welcome back'
    })).toBeVisible()
  })
})
