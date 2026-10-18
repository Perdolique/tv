import type { Page, BrowserContext, Response } from '@playwright/test'
import * as v from 'valibot'

import {
  catalogViewingUpdateSchema,
  catalogHistoricalRatingSaveSchema,
  type CatalogViewing,
  type CatalogRatingMutationResponse
} from '../../../packages/shared/src/catalog-viewings.ts'

import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { dune } from './details.fixtures.ts'

const path = `/titles/${dune.id}`
const api = `/api/catalog/items/${dune.id}/viewings`
const olderId = '01991a00-0000-7000-8000-000000000099'
const olderApi = `${api}/${olderId}`
const olderRatingApi = `${olderApi}/rating`
const olderRowSelector = `#viewing-${olderId}`

function isOlderViewingRead(response: Response): boolean {
  const url = new URL(response.url())

  return url.pathname === olderApi && response.request().method() === 'GET'
}

function viewingRecords() {
  const older: CatalogViewing = {
    id: olderId,
    catalogItemId: dune.id,
    status: 'completed',
    startedOn: null,
    completedOn: '2019-01-01',
    recordedAt: '2019-01-01T12:00:00.123456Z',
    revision: 1,
    score: null,
    isRewatch: false,
    canCancelRewatch: false
  }

  const recent: CatalogViewing[] = Array.from({ length: 20 }, (_value, index) => {
    const ordinal = String(20 - index)
    const suffix = ordinal.padStart(12, '0')

    return {
      id: `01991a00-0000-7000-8000-${suffix}`,
      catalogItemId: dune.id,
      status: 'completed',
      startedOn: null,
      completedOn: '2026-10-17',
      recordedAt: '2020-01-01T12:00:00.123456Z',
      revision: 1,
      score: null,
      isRewatch: false,
      canCancelRewatch: false
    }
  })

  return {
    older,
    recent
  }
}

async function mockOlderViewing(page: Page, older: CatalogViewing, recent: CatalogViewing[]): Promise<void> {
  const summary = {
    completedCount: 21,
    currentViewingId: null,
    contextVersion: 0,
    currentViewingScore: null,
    currentVoteScore: null
  }

  let revision = 1
  let { score } = older

  await page.route(`**${api}**`, async route => {
    const request = route.request()
    const requestUrl = request.url()
    const url = new URL(requestUrl)
    const target = url.pathname === olderApi
    const method = request.method()
    const savingHistoricalRating = url.pathname === olderRatingApi && method === 'PUT'

    if (savingHistoricalRating) {
      const raw: unknown = request.postDataJSON()
      const { revision: inputRevision, score: nextScore } = v.parse(catalogHistoricalRatingSaveSchema, raw)

      expect(inputRevision).toBe(revision)

      if (revision === 1) {
        revision = 2
        score = 7

        await route.fulfill({
          status: 409,
          json: { error: { code: 'CONFLICT' } }
        })

        return
      }

      revision += 1
      score = nextScore

      await route.fulfill({ json: {
        score,

        viewing: {
          ...older,
          revision,
          score
        },

        summary
      } satisfies CatalogRatingMutationResponse })

      return
    }

    if (target && method === 'PATCH') {
      const raw: unknown = request.postDataJSON()
      const input = v.parse(catalogViewingUpdateSchema, raw)

      expect(input.revision).toBe(revision)

      if (revision === 1) {
        revision = 2

        await route.fulfill({
          status: 409,

          json: { error: {
            code: 'CONFLICT',
            message: 'Refresh and try again.'
          } }
        })

        return
      }

      revision = 3

      const viewing = {
        ...older,
        startedOn: input.startedOn,
        completedOn: input.completedOn,
        revision
      }

      await route.fulfill({ json: {
        viewing,
        summary
      } })

      return
    }

    if (target) {
      await route.fulfill({ json: { viewing: {
        ...older,
        revision,
        score
      } } })

      return
    }

    const more = url.searchParams.has('cursor')

    await route.fulfill({ json: {
      items: more ? [older] : recent,
      summary,
      nextCursor: more ? null : 'older'
    } })
  })

}

async function openOlderViewing(page: Page, context: BrowserContext): Promise<void> {
  await addCookie(context, 'tv_session', 'e2e-session')
  await page.goto(path)

  await page.getByRole('button', {
    name: 'Load more viewings',
    exact: true
  }).click()
}

test.describe('older viewing conflicts', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: olderApi,
    status: 409
  }] } })

    test('refreshes an older paged viewing without losing its draft', async ({ page, context }) => {
      const { older, recent } = viewingRecords()

      await mockOlderViewing(page, older, recent)
      await openOlderViewing(page, context)

      const row = page.locator(olderRowSelector)

      await row.getByRole('button', {
        name: 'Edit date',
        exact: true
      }).click()

      await page.getByLabel('Watched on', { exact: true }).fill('2018-01-01')

      await page.getByRole('button', {
        name: 'Save viewing',
        exact: true
      }).click()

      await expect(page.getByRole('alert')).toContainText('Refresh')

      const refreshedPoint = page.waitForResponse(isOlderViewingRead)

      await page.getByRole('button', {
        name: 'Refresh viewings',
        exact: true
      }).click()

      await refreshedPoint

      await expect(page.getByLabel('Watched on', { exact: true })).toHaveValue('2018-01-01')

      await page.getByRole('button', {
        name: 'Save viewing',
        exact: true
      }).click()

      await expect(page.getByLabel('Watched on', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('status').filter({ hasText: 'Viewing date saved.' })).toBeVisible()
    })

  test.describe('historical rating recovery', () => {
    test.use({ expectedHttpErrors: { values: [{
      pathname: olderRatingApi,
      status: 409
    }] } })

    test('refreshes a paged historical rating and keeps its confirmed score outside the first page', async ({ page, context }) => {
      const { older, recent } = viewingRecords()

      await mockOlderViewing(page, older, recent)
      await openOlderViewing(page, context)

      const row = page.locator(olderRowSelector)

      const editor = row.getByRole('region', {
        name: 'Past viewing rating',
        exact: true
      })

      await editor.getByRole('button', { name: 'Rate, Past viewing rating' }).click()

      await editor.getByRole('button', {
        name: '9 out of 10',
        exact: true
      }).click()

      await expect(editor.getByRole('alert')).toContainText('Refresh')

      await editor.getByRole('button', {
        name: 'Refresh rating',
        exact: true
      }).click()

      await expect(row).toBeVisible()

      await expect(editor.getByRole('button', {
        name: '7 out of 10',
        exact: true
      })).toHaveAttribute('aria-pressed', 'true')

      await expect(editor.getByRole('button', {
        name: '7 out of 10',
        exact: true
      })).toBeInViewport()

      await editor.getByRole('button', {
        name: '9 out of 10',
        exact: true
      }).click()

      await expect(editor.getByRole('button', { name: 'Past viewing rating: 9 out of 10' })).toHaveText('9/10')
      await expect(page.getByRole('region', { name: 'Personal score' })).toHaveText(/^Your rating\s*—\s*$/u)
    })

  })
})
