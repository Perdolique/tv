import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { dune } from './details.fixtures.ts'
import { waitForHydration } from './helpers.ts'

const path = `/titles/${dune.id}`
const viewingsApi = `/api/catalog/items/${dune.id}/viewings`

test.beforeEach(async ({ context }) => {
  await addCookie(context, 'tv_session', 'e2e-session')
})

test.describe('current viewing conflict recovery', () => {
  const ratingApi = `/api/catalog/items/${dune.id}/rating`

  test.use({ expectedHttpErrors: { values: [{
    pathname: ratingApi,
    status: 409
  }] } })

  for (const width of [390, 768, 1440]) {
    const testName = `restores rating focus after refreshing a changed current viewing at ${width}px`

    test(testName, async ({ page }) => {
      await page.setViewportSize({
        width,
        height: 1024
      })

      await page.goto(path)
      await waitForHydration(page)

      const editor = page.getByRole('region', {
        name: 'Your rating',
        exact: true
      })

      const rate = editor.getByRole('button', {
        name: 'Rate',
        exact: true
      })

      const viewingId = '01991a00-0000-7000-8000-000000000099'

      await rate.click()

      const ratingRoute = `**${ratingApi}`

      await page.route(ratingRoute, async route => {
        await route.fulfill({
          status: 409,
          json: { error: { code: 'CONFLICT' } }
        })
      }, { times: 1 })

      await editor.getByRole('button', {
        name: '8 out of 10',
        exact: true
      }).click()

      await expect(editor.getByRole('alert')).toContainText('Refresh')

      const routePattern = `**${viewingsApi}`

      await page.route(routePattern, async route => {
        await route.fulfill({ json: {
          items: [{
            id: viewingId,
            catalogItemId: dune.id,
            status: 'completed',
            startedOn: null,
            completedOn: '2026-10-17',
            recordedAt: '2026-01-01T12:00:00.123456Z',
            revision: 1,
            score: null,
            isRewatch: false,
            canCancelRewatch: false
          }],

          summary: {
            completedCount: 1,
            currentViewingId: viewingId,
            contextVersion: 1,
            currentViewingScore: null,
            currentVoteScore: null
          },

          nextCursor: null
        } })
      }, { times: 1 })

      const refresh = editor.getByRole('button', { name: 'Refresh rating' })

      await refresh.focus()
      await page.keyboard.press('Enter')
      await expect(editor.getByRole('dialog')).toHaveCount(0)
      await expect(rate).toBeFocused()
      await expect(page.getByRole('region', { name: 'Personal score' })).toContainText('Current viewing')
    })
  }
})
