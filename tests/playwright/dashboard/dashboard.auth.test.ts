import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { waitForHydration } from '../catalog/helpers.ts'
import { appBaseUrl } from '../constants.ts'

function marks(page: Page) {
  return page.getByRole('list', {
    name: 'Watched marks',
    exact: true
  }).getByRole('listitem')
}

async function expectOtherSection(page: Page, target: string): Promise<void> {
  const assertion = target === 'history'
    ? expect(page.locator('dd')).toHaveText(['0', '25'])
    : expect(marks(page)).toHaveCount(20)

  await assertion
}

for (const target of ['history', 'summary'] as const) {
  const pathname = `/api/catalog/viewing-${target}`

  const initialExpiredTest = test.extend({ expectedHttpErrors: { values: [{
    pathname,
    status: 401
  }] } })

  initialExpiredTest(`clears the dashboard after a current initial ${target} 401`, async ({ page, context }) => {
    await addCookie(context, 'tv_session', 'e2e-session')
    await addCookie(context, 'paginated_viewing', '1')
    await page.goto('/')
    await waitForHydration(page)

    const responseGate = Promise.withResolvers<boolean>()

    await page.route(`**${pathname}`, async (route) => {
      await responseGate.promise

      await route.fulfill({
        status: 401,
        headers: { 'Set-Cookie': 'tv_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax' },

        json: { error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required.'
        } }
      })
    })

    try {
      await page.getByRole('link', {
        name: 'Dashboard',
        exact: true
      }).click()

      await expectOtherSection(page, target)
    } finally {
      responseGate.resolve(true)
    }

    await expect(page).toHaveURL(`${appBaseUrl}/sign-in?redirectTo=/dashboard`)
    await expect(marks(page)).toHaveCount(0)
    await expect(page.getByRole('list', { name: 'Watched episodes by series' })).toHaveCount(0)
    await expect(page.locator('dd')).toHaveCount(0)
  })
}

