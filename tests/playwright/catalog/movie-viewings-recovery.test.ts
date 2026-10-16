import type { Page } from '@playwright/test'
import type { CatalogViewing } from '../../../packages/shared/src/catalog-viewings.ts'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { dune } from './details.fixtures.ts'

const path = `/titles/${dune.id}`
const api = `/api/catalog/items/${dune.id}/viewings`

function history(page: Page) {
  return page.getByRole('list', {
    name: 'Movie viewings',
    exact: true
  })
}

async function mockHistoryPages(page: Page, first: CatalogViewing[], remaining: CatalogViewing[]): Promise<void> {
  const summary = {
    completedCount: 21,
    currentViewingId: null,
    contextVersion: 0,
    currentViewingScore: null,
    currentVoteScore: null
  }

  let fail = true

  await page.route(`**${api}**`, async route => {
    const url = new URL(route.request().url())
    const more = url.searchParams.has('cursor')

    if (more && fail) {
      fail = false

      await route.fulfill({
        status: 503,

        json: { error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Unavailable.'
        } }
      })

      return
    }

    await route.fulfill({ json: {
      items: more ? remaining : first,
      summary,
      nextCursor: more ? null : 'older'
    } })
  })

}

test.describe('viewing read recovery', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: api,
    status: 503
  }] } })

  test('announces an initial history failure once', async ({ page, context }) => {
    await addCookie(context, 'tv_session', 'e2e-session')
    await addCookie(context, 'fail_watched_load', '1')
    await page.goto(path)
    await expect(page.getByRole('alert')).toHaveCount(1)
    await expect(page.getByRole('alert')).toContainText('refresh your viewings')

    await page.getByRole('button', {
      name: 'Refresh viewings',
      exact: true
    }).click()

    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('disables linked viewing edits until the history context has loaded', async ({ page, context }) => {
    const linked: CatalogViewing = {
      id: '01991a00-0000-7000-8000-000000000099',
      catalogItemId: dune.id,
      status: 'completed',
      startedOn: null,
      completedOn: null,
      recordedAt: '2020-01-01T12:00:00.123456Z',
      revision: 1,
      score: null
    }

    const linkedPath = `${api}/${linked.id}`
    let failed = false

    await page.route(`**${api}**`, async route => {
      const request = route.request()
      const requestUrl = request.url()
      const url = new URL(requestUrl)
      const isPointRead = url.pathname === linkedPath

      // oxlint-disable-next-line vitest/no-conditional-in-test -- The point read succeeds independently of the history context.
      if (isPointRead) {
        await route.fulfill({ json: { viewing: linked } })

        return
      }

      // oxlint-disable-next-line vitest/no-conditional-in-test -- The first history read fails before a successful retry.
      if (!failed) {
        failed = true

        await route.fulfill({
          status: 503,
          json: { error: { code: 'SERVICE_UNAVAILABLE' } }
        })

        return
      }

      await route.fulfill({ json: {
        items: [],
        nextCursor: null,

        summary: {
          completedCount: 1,
          currentViewingId: linked.id,
          contextVersion: 4,
          currentViewingScore: null,
          currentVoteScore: null
        }
      } })
    })

    await addCookie(context, 'tv_session', 'e2e-session')

    const location = `${path}?viewingId=${linked.id}#viewing-${linked.id}`

    await page.goto(location)

    const row = page.locator(`#viewing-${linked.id}`)

    const edit = row.getByRole('button', {
      name: 'Edit dates',
      exact: true
    })

    const remove = row.getByRole('button', {
      name: 'Delete',
      exact: true
    })

    await expect(row).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('refresh your viewings')
    await expect(edit).toBeDisabled()
    await expect(remove).toBeDisabled()

    await page.getByRole('button', {
      name: 'Refresh viewings',
      exact: true
    }).click()

    await expect(edit).toBeEnabled()
    await expect(remove).toBeEnabled()
  })

  test('keeps loaded rows after a page failure and announces only a successful retry', async ({ page, context }) => {
    const all: CatalogViewing[] = Array.from({ length: 21 }, (_value, index) => {
      const ordinal = String(21 - index)
      const suffix = ordinal.padStart(12, '0')

      return {
        id: `01991a00-0000-7000-8000-${suffix}`,
        catalogItemId: dune.id,
        status: 'completed',
        startedOn: null,
        completedOn: null,
        recordedAt: '2020-01-01T12:00:00.123456Z',
        revision: 1,
        score: null
      }
    })

    const first = all.slice(0, 20)
    const remaining = all.slice(20)

    await mockHistoryPages(page, first, remaining)
    await addCookie(context, 'tv_session', 'e2e-session')
    await page.goto(path)
    await expect(history(page).getByRole('listitem')).toHaveCount(20)

    await page.getByRole('button', {
      name: 'Load more viewings',
      exact: true
    }).click()

    await expect(page.getByRole('alert')).toContainText('load more')
    await expect(history(page).getByRole('listitem')).toHaveCount(20)
    await expect(page.getByRole('status').filter({ hasText: '0 more viewings loaded.' })).toHaveCount(0)

    await page.getByRole('button', {
      name: 'Load more viewings',
      exact: true
    }).click()

    await expect(history(page).getByRole('listitem')).toHaveCount(21)
    await expect(page.getByRole('status').filter({ hasText: '1 more viewings loaded.' })).toBeVisible()
  })

})
