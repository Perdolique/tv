/* oxlint-disable vitest/prefer-each -- Playwright defines a separate scenario for each viewport and theme. */
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie, expectNoHorizontalOverflow } from '../helpers.ts'
import { dune } from './details.fixtures.ts'
import { waitForHydration } from './helpers.ts'

for (const colorScheme of ['light', 'dark'] as const) {
  for (const [name, width, height] of [['mobile', 390, 844], ['tablet', 768, 1024], ['desktop', 1440, 1024]] as const) {
    test(`${name} movie viewing history and dashboard in ${colorScheme}`, async ({ page, context }, testInfo) => {
      await addCookie(context, 'tv_session', 'e2e-session')

      await page.setViewportSize({
        width,
        height
      })

      await page.emulateMedia({ colorScheme })
      await page.goto(`/titles/${dune.id}`)
      await waitForHydration(page)

      await page.getByRole('button', {
        name: 'Mark as watched',
        exact: true
      }).click()

      await page.getByRole('button', {
        name: 'Watched again',
        exact: true
      }).click()

      await expect(page.getByText('2 viewings', { exact: true })).toBeVisible()

      const overview = page.getByRole('heading', {
        name: 'Overview',
        exact: true
      })

      const viewings = page.getByRole('heading', {
        name: 'Your viewings',
        exact: true
      })

      const overviewBox = await overview.boundingBox()
      const viewingBox = await viewings.boundingBox()

      expect(viewingBox?.y).toBeGreaterThan(Number(overviewBox?.y))
      await expectNoHorizontalOverflow(page)

      await page.screenshot({
        path: testInfo.outputPath(`title-${colorScheme}-${name}.png`),
        fullPage: true
      })

      await page.getByRole('button', {
        name: 'Add past viewing',
        exact: true
      }).click()

      await expect(page.getByLabel('Started on', { exact: true })).toBeFocused()
      await expectNoHorizontalOverflow(page)
      await page.keyboard.press('Escape')

      await expect(page.getByRole('button', {
        name: 'Add past viewing',
        exact: true
      })).toBeFocused()

      await page.goto('/dashboard')
      await expect(page.locator('dd')).toHaveText(['2', '0'])
      await expectNoHorizontalOverflow(page)

      await page.screenshot({
        path: testInfo.outputPath(`dashboard-${colorScheme}-${name}.png`),
        fullPage: true
      })
    })
  }
}
