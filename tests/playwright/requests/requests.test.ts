import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { waitForHydration } from '../catalog/helpers.ts'
import { dune } from '../catalog/details.fixtures.ts'
import { exactMovie, similarMovie } from './fixtures.ts'
import { openRequestForm, reviewRequest, searchRequestSource, submitRequest } from './helpers.ts'

test.describe('title requests', () => {
  test.beforeEach(async ({ context }) => {
    await addCookie(context, 'tv_session', 'e2e-session')
  })

  for (const { type, title } of [{
    type: 'Movie',
    title: 'Requested movie'
  }, {
    type: 'Series',
    title: 'Requested series'
  }]) {
    test(`requests a missing ${type.toLowerCase()} after catalog search and keeps it in personal history`, async ({ page }) => {
      await openRequestForm(page)
      await searchRequestSource(page, 'Requested title', type)
      await reviewRequest(page, title)
      await submitRequest(page)

      await test.step('open the saved personal request', async () => {
        await page.getByRole('link', { name: 'View your requests' }).click()
        await expect(page).toHaveURL('/requests')

        await expect(page.getByRole('heading', {
          name: title,
          exact: true
        })).toBeVisible()

        await expect(page.getByText('Pending', { exact: true })).toBeVisible()
      })
    })
  }

  test('opens an exact TMDB match instead of submitting a request', async ({ page }) => {
    await openRequestForm(page)
    await searchRequestSource(page, 'Exact title')
    await reviewRequest(page, exactMovie.title)

    const existing = page.getByRole('link', {
      name: 'Open title in TV',
      exact: true
    })

    const titlePath = `/titles/${dune.id}`

    await expect(existing).toHaveAttribute('href', titlePath)

    await expect(page.getByRole('button', {
      name: 'Submit request',
      exact: true
    })).toHaveCount(0)

    await expect(page.getByRole('heading', { name: 'Similar titles in TV' })).toHaveCount(0)
  })

  test('keeps a similarly named catalog title separate and allows the new adaptation request', async ({ page }) => {
    await openRequestForm(page)
    await searchRequestSource(page, 'Similar title')
    await reviewRequest(page, similarMovie.title)
    await expect(page.getByRole('heading', { name: 'Similar titles in TV' })).toBeVisible()
    await expect(page.getByText('These may be different titles. You can still submit your request.')).toBeVisible()

    const similarTitle = page.getByRole('link', {
      name: 'Dune · 2021',
      exact: true
    })

    const titlePath = `/titles/${dune.id}`

    await expect(similarTitle).toHaveAttribute('href', titlePath)

    await expect(page.getByRole('link', {
      name: 'Open title in TV',
      exact: true
    })).toHaveCount(0)

    await submitRequest(page)
  })
})

test.describe('incoming request import', () => {
  test.beforeEach(async ({ context }) => {
    await addCookie(context, 'tv_session', 'e2e-session')
    await addCookie(context, 'catalog_manager', '1')
  })

  test('opens a grouped incoming request in manual import with its TMDB title selected', async ({ page }) => {
    await openRequestForm(page)
    await searchRequestSource(page)
    await reviewRequest(page)
    await submitRequest(page)

    await test.step('continue the incoming movie through manual import', async () => {
      await page.goto('/manage/requests')
      await waitForHydration(page)
      await expect(page.getByText('1 requester', { exact: true })).toBeVisible()

      await page.getByRole('link', {
        name: 'Review import',
        exact: true
      }).click()

      await expect(page.getByRole('heading', {
        name: 'Requested movie',
        exact: true
      })).toBeVisible()

      await expect(page.getByRole('button', {
        name: 'Review import',
        exact: true
      })).toBeEnabled()
    })
  })

  test('keeps explicit TVMaze selection when opening an incoming series request', async ({ page }) => {
    await openRequestForm(page)
    await searchRequestSource(page, 'Requested series', 'Series')
    await reviewRequest(page, 'Requested series')
    await submitRequest(page)

    await test.step('require the episode source before reviewing the series import', async () => {
      await page.goto('/manage/requests')
      await waitForHydration(page)

      await page.getByRole('link', {
        name: 'Review import',
        exact: true
      }).click()

      await expect(page.getByRole('heading', { name: 'Match the episode source' })).toBeVisible()
      await expect(page.getByRole('searchbox', { name: 'TVMaze show name' })).toHaveValue('Original requested title')

      await expect(page.getByRole('button', {
        name: 'Review import',
        exact: true
      })).toBeDisabled()
    })
  })
})

test.describe('request recovery', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: '/api/catalog/requests',
    status: 503
  }] } })

  test('keeps the reviewed card after a lost save response and retries without a duplicate', async ({ page, context }) => {
    await addCookie(context, 'tv_session', 'e2e-session')
    await openRequestForm(page)
    await searchRequestSource(page)
    await reviewRequest(page)

    await test.step('lose the response after the server saves the request', async () => {
      await page.route('**/api/catalog/requests', async route => {
        await route.fetch()

        await route.fulfill({
          status: 503,
          json: { error: { code: 'SERVICE_UNAVAILABLE' } }
        })
      }, { times: 1 })

      await page.getByRole('button', {
        name: 'Submit request',
        exact: true
      }).click()

      await expect(page.getByRole('alert')).toContainText('Your selection is still here')

      await expect(page.getByRole('region', { name: 'Review title request' }).getByRole('heading', {
        name: 'Requested movie',
        exact: true
      })).toBeVisible()
    })

    await test.step('retry the saved selection once and see one personal entry', async () => {
      await submitRequest(page)
      await page.getByRole('link', { name: 'View your requests' }).click()
      await expect(page).toHaveURL('/requests')

      await expect(page.getByRole('heading', {
        name: 'Requested movie',
        exact: true
      })).toHaveCount(1)
    })
  })
})
