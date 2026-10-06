import type { Page, BrowserContext, Response } from '@playwright/test'
import * as v from 'valibot'
import { catalogViewingUpdateSchema, type CatalogViewing } from '../../../packages/shared/src/catalog-viewings.ts'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { dune } from './details.fixtures.ts'

const path = `/titles/${dune.id}`
const api = `/api/catalog/items/${dune.id}/viewings`
const olderId = '01991a00-0000-7000-8000-000000000099'
const olderApi = `${api}/${olderId}`

function isOlderViewingRead(response: Response): boolean {
  const url = new URL(response.url())

  return url.pathname === olderApi && response.request().method() === 'GET'
}

async function mockOlderViewing(page: Page, older: CatalogViewing, recent: CatalogViewing[]): Promise<void> {
  const summary = {
    completedCount: 21,
    currentViewingId: null,
    contextVersion: 0
  }

  let revision = 1

  await page.route(`**${api}**`, async route => {
    const request = route.request()
    const url = new URL(request.url())
    const target = url.pathname === olderApi

    if (target && request.method() === 'PATCH') {
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
        revision
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

async function openOlderViewing(page: Page, context: BrowserContext, linked: boolean): Promise<void> {
  await addCookie(context, 'tv_session', 'e2e-session')

  const location = linked ? `${path}?viewingId=${olderId}#viewing-${olderId}` : path

  await page.goto(location)

  if (!linked) {
    await page.getByRole('button', {
      name: 'Load more viewings',
      exact: true
    }).click()
  }
}

test.describe('older viewing conflicts', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: olderApi,
    status: 409
  }] } })

  for (const linked of [false, true]) {
    const kind = linked ? 'linked' : 'paged'
    const name = `refreshes an older ${kind} viewing without losing its draft`

    test(name, async ({ page, context }) => {
      const older: CatalogViewing = {
        id: olderId,
        catalogItemId: dune.id,
        status: 'completed',
        startedOn: null,
        completedOn: null,
        recordedAt: '2019-01-01T12:00:00.123456Z',
        revision: 1
      }

      const recent: CatalogViewing[] = Array.from({ length: 20 }, (_value, index) => {
        const ordinal = String(20 - index)
        const suffix = ordinal.padStart(12, '0')

        return {
          id: `01991a00-0000-7000-8000-${suffix}`,
          catalogItemId: dune.id,
          status: 'completed',
          startedOn: null,
          completedOn: null,
          recordedAt: '2020-01-01T12:00:00.123456Z',
          revision: 1
        }
      })

      await mockOlderViewing(page, older, recent)
      await openOlderViewing(page, context, linked)

      const row = page.locator(`#viewing-${olderId}`)

      await row.getByRole('button', {
        name: 'Edit dates',
        exact: true
      }).click()

      await page.getByLabel('Started on', { exact: true }).fill('2018-01-01')

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

      await expect(page.getByLabel('Started on', { exact: true })).toHaveValue('2018-01-01')

      await page.getByRole('button', {
        name: 'Save viewing',
        exact: true
      }).click()

      await expect(page.getByLabel('Started on', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('status').filter({ hasText: 'Viewing dates saved.' })).toBeVisible()
    })
  }
})
