import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { requestedMovie, similarMovie } from './fixtures.ts'
import { expectRequestCancelled, holdResponse, openRequestForm, reviewRequest, searchRequestSource } from './helpers.ts'

test.describe('request selection cancellation', () => {
  test.beforeEach(async ({ context }) => {
    await addCookie(context, 'tv_session', 'e2e-session')
  })

  const changes = [{
    name: 'name',
    query: 'Similar title',
    type: 'Movie',
    title: similarMovie.title,

    reset: async (page: Page): Promise<void> => {
      await page.getByRole('searchbox', { name: 'Title name' }).fill('Similar title')
    }
  }, {
    name: 'type',
    query: 'Requested title',
    type: 'Series',
    title: 'Requested series',

    reset: async (page: Page): Promise<void> => {
      await page.getByRole('radio', {
        name: 'Series',
        exact: true
      }).check()
    }
  }]

  for (const change of changes) {
    test(`changing the ${change.name} cancels a pending preview before any stale card can return`, async ({ page }) => {
      await openRequestForm(page)
      await searchRequestSource(page)

      const held = await holdResponse(page, '**/api/catalog/requests/preview?**', {
        card: requestedMovie,
        similar: [],
        catalogItemId: null
      })

      try {
        await test.step('keep the old movie preview pending through the reset', async () => {
          await page.getByRole('button', {
            name: 'Review Requested movie',
            exact: true
          }).click()

          const pending = await held.started

          await expectRequestCancelled(page, pending, async () => {
            await change.reset(page)
          })

          await expect(page.getByRole('region', { name: 'Review title request' })).toHaveCount(0)
          await expect(page.getByRole('region', { name: 'TMDB search results' })).toHaveCount(0)
          await expect(page.getByRole('button', { name: 'Search TMDB for a missing title' })).toHaveCount(0)
          held.release()
        })

        await test.step('render only the new query and source type after a fresh catalog search', async () => {
          await searchRequestSource(page, change.query, change.type)
          await reviewRequest(page, change.title)

          await expect(page.getByRole('heading', {
            name: requestedMovie.title,
            exact: true
          })).toHaveCount(0)
        })
      } finally {
        held.release()
      }
    })
  }
})
