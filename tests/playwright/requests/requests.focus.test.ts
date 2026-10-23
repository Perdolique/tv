import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { pendingMovieRequest, requestedMovie } from './fixtures.ts'
import { holdResponse, openRequestForm, reviewRequest, searchRequestSource } from './helpers.ts'

test.describe('request focus ownership', () => {
  test.beforeEach(async ({ context }) => {
    await addCookie(context, 'tv_session', 'e2e-session')
  })

  test('a delayed preview keeps focus on the field the user chose while waiting', async ({ page }) => {
    await openRequestForm(page)
    await searchRequestSource(page)

    const held = await holdResponse(page, '**/api/catalog/requests/preview?**', {
      card: requestedMovie,
      similar: [],
      catalogItemId: null
    })

    try {
      await page.getByRole('button', {
        name: 'Review Requested movie',
        exact: true
      }).click()

      await held.started

      const input = page.getByRole('searchbox', { name: 'Title name' })

      await input.focus()
      held.release()
      await expect(page.getByRole('region', { name: 'Review title request' })).toBeVisible()
      await expect(input).toBeFocused()
    } finally {
      held.release()
    }
  })

  test('keyboard submission focuses the confirmed request link and Enter opens personal history', async ({ page }) => {
    await openRequestForm(page)
    await searchRequestSource(page)
    await reviewRequest(page)

    const submit = page.getByRole('button', {
      name: 'Submit request',
      exact: true
    })

    const held = await holdResponse(page, '**/api/catalog/requests', {
      request: pendingMovieRequest,
      catalogItemId: null
    })

    try {
      await test.step('submit from the keyboard and wait for server confirmation', async () => {
        await submit.focus()
        await submit.press('Enter')

        await held.started

        await expect(page.getByRole('link', { name: 'View your requests' })).toHaveCount(0)
        await expect(submit).toBeDisabled()
        held.release()
      })

      await test.step('continue through the useful focused confirmation link', async () => {
        const confirmed = page.getByRole('link', { name: 'View your requests' })

        await expect(confirmed).toBeFocused()
        await confirmed.press('Enter')
        await expect(page).toHaveURL('/requests')

        await expect(page.getByRole('heading', {
          name: 'Your requests',
          exact: true
        })).toBeVisible()
      })
    } finally {
      held.release()
    }
  })

  test('a delayed submission keeps newer user focus when its confirmation arrives', async ({ page }) => {
    await openRequestForm(page)
    await searchRequestSource(page)
    await reviewRequest(page)

    const held = await holdResponse(page, '**/api/catalog/requests', {
      request: pendingMovieRequest,
      catalogItemId: null
    })

    try {
      await page.getByRole('button', {
        name: 'Submit request',
        exact: true
      }).click()

      await held.started

      const input = page.getByRole('searchbox', { name: 'Title name' })

      await input.focus()
      held.release()
      await expect(page.getByRole('link', { name: 'View your requests' })).toBeVisible()
      await expect(input).toBeFocused()
    } finally {
      held.release()
    }
  })
})
