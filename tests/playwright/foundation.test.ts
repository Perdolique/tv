import { expect, test } from './fixtures/global.fixtures.ts'

test.describe('TV foundation', () => {
  test('hydrates the landing page without browser errors', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveTitle('TV')
    await expect(page.getByRole('heading', { level: 1, name: 'TV' })).toBeVisible()
    await expect(page.getByText('TV repository foundation is running.')).toBeVisible()
  })
})

test.describe('TV SSR', () => {
  test.use({ javaScriptEnabled: false })

  test('renders the landing page without client JavaScript', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveTitle('TV')
    await expect(page.getByRole('heading', { level: 1, name: 'TV' })).toBeVisible()
    await expect(page.getByText('TV repository foundation is running.')).toBeVisible()
  })
})
