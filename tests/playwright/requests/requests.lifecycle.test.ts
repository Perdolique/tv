import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { waitForHydration } from '../catalog/helpers.ts'
import { pendingMovieRequest } from './fixtures.ts'
import { expectRequestCancelled, holdResponse, openRequestForm, reviewRequest, searchRequestSource } from './helpers.ts'

async function openPaginatedRequests(page: Page, manager = false): Promise<void> {
  const endpoint = manager ? '/api/catalog/manage/requests' : '/api/catalog/requests'
  const routePattern = `**${endpoint}?**`
  const previousPath = manager ? '/manage/requests?access=previous' : '/requests?account=previous'

  // Keep a real earlier list URL in history, then enter the mocked list through client navigation.
  // Browser routes cannot intercept the fake Worker's server-rendered list request.
  await page.goto(previousPath)
  await waitForHydration(page)

  await page.getByRole('navigation', {
    name: 'Main navigation',
    exact: true
  }).getByRole('link', {
    name: 'Request title',
    exact: true
  }).click()

  await expect(page.getByRole('heading', {
    name: 'Request a title',
    exact: true
  })).toBeVisible()

  await page.route(routePattern, async route => {
    await route.fulfill({ json: {
      items: [pendingMovieRequest],
      nextPage: 2
    } })
  }, { times: 1 })

  const destination = manager
    ? page.getByRole('navigation', {
      name: 'Main navigation',
      exact: true
    }).getByRole('link', {
      name: 'Incoming requests',
      exact: true
    })
    : page.getByRole('main').getByRole('link', {
      name: 'Your requests',
      exact: true
    })

  await destination.click()

  await expect(page.getByRole('heading', {
    name: 'Requested movie',
    exact: true
  })).toBeVisible()

  await expect(page.getByRole('button', {
    name: 'Next',
    exact: true
  })).toBeEnabled()
}

test.describe('request account lifecycle', () => {
  test.beforeEach(async ({ context }) => {
    await addCookie(context, 'tv_session', 'e2e-session')
  })

  test('clears the request selection on an account switch while its submit response is pending', async ({ page, context }) => {
    await openRequestForm(page, '/request-title?account=previous')
    await searchRequestSource(page)
    await reviewRequest(page)

    const owner = await page.getByRole('main').elementHandle()

    const held = await holdResponse(page, '**/api/catalog/requests', {
      request: pendingMovieRequest,
      catalogItemId: null
    })

    try {
      await page.getByRole('button', {
        name: 'Submit request',
        exact: true
      }).click()

      const pending = await held.started

      await test.step('refresh the new identity without replacing the mounted page', async () => {
        await addCookie(context, 'tv_session', 'e2e-long-email-session')

        await expectRequestCancelled(page, pending, async () => {
          await page.getByRole('navigation', {
            name: 'Main navigation',
            exact: true
          }).getByRole('link', {
            name: 'Request title',
            exact: true
          }).click()
        })

        const retainedOwner = await owner.evaluate(element => element.isConnected)

        expect(retainedOwner).toBe(true)
        await expect(page.getByRole('region', { name: 'Review title request' })).toHaveCount(0)
        await expect(page.getByRole('region', { name: 'TMDB search results' })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Search TMDB for a missing title' })).toHaveCount(0)
      })

      held.release()
      await expect(page.getByRole('link', { name: 'View your requests' })).toHaveCount(0)
      await searchRequestSource(page)
      await reviewRequest(page)

      await expect(page.getByRole('button', {
        name: 'Submit request',
        exact: true
      })).toBeEnabled()
    } finally {
      held.release()
    }
  })

  test('clears personal entries and cancels the old page before the next account receives its own list', async ({ page, context }) => {
    await openPaginatedRequests(page)

    const owner = await page.getByRole('main').elementHandle()

    const held = await holdResponse(page, '**/api/catalog/requests?page=2', {
      items: [pendingMovieRequest],
      nextPage: null
    })

    try {
      await page.getByRole('button', {
        name: 'Next',
        exact: true
      }).click()

      const pending = await held.started

      await test.step('change identity while the old personal page remains pending', async () => {
        await addCookie(context, 'tv_session', 'e2e-long-email-session')

        await expectRequestCancelled(page, pending, async () => {
          const refreshed = page.waitForURL('/requests?account=previous')

          await page.evaluate(() => { globalThis.history.go(-2) })

          await refreshed
        })

        const retainedOwner = await owner.evaluate(element => element.isConnected)

        expect(retainedOwner).toBe(true)

        await expect(page.getByRole('heading', {
          name: 'Requested movie',
          exact: true
        })).toHaveCount(0)

        await expect(page.getByText('You have no title requests yet.', { exact: true })).toBeVisible()

        await expect(page.getByRole('button', {
          name: 'Previous',
          exact: true
        })).toHaveCount(0)
      })

      held.release()

      await expect(page.getByRole('heading', {
        name: 'Requested movie',
        exact: true
      })).toHaveCount(0)

      await expect(page.getByRole('button', {
        name: 'Next',
        exact: true
      })).toHaveCount(0)
    } finally {
      held.release()
    }
  })

  test('signing out cancels a pending submission and removes the reviewed personal card', async ({ page }) => {
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

      const pending = await held.started

      await expectRequestCancelled(page, pending, async () => {
        await page.getByRole('button', {
          name: 'Sign out',
          exact: true
        }).click()
      })

      await expect(page).toHaveURL('/')
      await expect(page.getByRole('region', { name: 'Review title request' })).toHaveCount(0)
      held.release()
      await expect(page.getByRole('link', { name: 'View your requests' })).toHaveCount(0)

      await expect(page.getByRole('link', {
        name: 'Sign in',
        exact: true
      })).toBeVisible()
    } finally {
      held.release()
    }
  })

  test('signing out cancels a pending personal list page and removes its loaded entries', async ({ page }) => {
    await openPaginatedRequests(page)

    const held = await holdResponse(page, '**/api/catalog/requests?page=2', {
      items: [pendingMovieRequest],
      nextPage: null
    })

    try {
      await page.getByRole('button', {
        name: 'Next',
        exact: true
      }).click()

      const pending = await held.started

      await expectRequestCancelled(page, pending, async () => {
        await page.getByRole('button', {
          name: 'Sign out',
          exact: true
        }).click()
      })

      await expect(page).toHaveURL('/')

      await expect(page.getByRole('heading', {
        name: 'Requested movie',
        exact: true
      })).toHaveCount(0)

      held.release()

      await expect(page.getByRole('button', {
        name: 'Next',
        exact: true
      })).toHaveCount(0)

      await expect(page.getByRole('link', {
        name: 'Sign in',
        exact: true
      })).toBeVisible()
    } finally {
      held.release()
    }
  })
})

test.describe('incoming request access lifecycle', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: '/api/catalog/imports/access',
    status: 403
  }] } })

  test('revoking management access clears loaded incoming requests and cancels their pending page', async ({ page, context }) => {
    await addCookie(context, 'tv_session', 'e2e-session')
    await addCookie(context, 'catalog_manager', '1')
    await openPaginatedRequests(page, true)

    const owner = await page.getByRole('main').elementHandle()

    const held = await holdResponse(page, '**/api/catalog/manage/requests?page=2', {
      items: [pendingMovieRequest],
      nextPage: null
    })

    try {
      await page.getByRole('button', {
        name: 'Next',
        exact: true
      }).click()

      const pending = await held.started

      await test.step('refresh revoked access while the incoming response remains pending', async () => {
        await addCookie(context, 'catalog_manager', '0')

        await expectRequestCancelled(page, pending, async () => {
          const refreshed = page.waitForURL('/manage/requests?access=previous')

          await page.evaluate(() => { globalThis.history.go(-2) })

          await refreshed
        })

        const retainedOwner = await owner.evaluate(element => element.isConnected)

        expect(retainedOwner).toBe(true)
        await expect(page.getByRole('alert')).toHaveText('You do not have access to catalog management.')

        await expect(page.getByRole('heading', {
          name: 'Requested movie',
          exact: true
        })).toHaveCount(0)

        await expect(page.getByRole('link', {
          name: 'Review import',
          exact: true
        })).toHaveCount(0)
      })

      held.release()

      await expect(page.getByRole('button', {
        name: 'Next',
        exact: true
      })).toHaveCount(0)

      await expect(page.getByRole('button', {
        name: 'Check access again',
        exact: true
      })).toBeEnabled()
    } finally {
      held.release()
    }
  })
})
