import * as v from 'valibot'

import {
  catalogSeriesBulkWatchSchema,
  catalogSeriesCancelRewatchSchema,
  catalogSeriesRewatchSchema,
  catalogSeriesWatchSchema
} from '../../../packages/shared/src/catalog-series.ts'

import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { chernobyl } from './details.fixtures.ts'
import { openEpisodes } from './helpers.ts'

import {
  firstEpisodeId,
  nextViewingId,
  rewatchHistory,
  seriesResponse,
  timelinePath,
  titlePath,
  viewingId,
  watchedPath
} from './timeline.fixtures.ts'

test.use({ timezoneId: 'Europe/Tallinn' })

test('starts one explicit rewatch, keeps earlier history, and cancels the empty new viewing', async ({ context, page }) => {
    let state = seriesResponse()
    let rewatched = false

    await addCookie(context, 'tv_session', 'e2e-session')

    const watchedRoute = `**${watchedPath}`

    await page.route(watchedRoute, async (route) => { await route.fulfill({ json: state }) })

    const episodeWatchedRoute = `**/api/catalog/episodes/${firstEpisodeId}/watched`

    await page.route(episodeWatchedRoute, async (route) => {
      const request = route.request()
      const raw: unknown = request.postDataJSON()
      const body = v.parse(catalogSeriesWatchSchema, raw)

      expect(body.currentViewingId).toBeNull()
      expect(body.timeZone).toBe('Europe/Tallinn')

      state = seriesResponse([firstEpisodeId], viewingId, 1)

      await route.fulfill({ json: state })
    })

    const bulkWatchedRoute = `**/api/catalog/items/${chernobyl.id}/episodes/watched`

    await page.route(bulkWatchedRoute, async (route) => {
      const request = route.request()
      const method = request.method()

      // oxlint-disable-next-line vitest/no-conditional-in-test -- The all-released POST shares the current-viewing GET path.
      if (method === 'GET') {
        await route.fallback()

        return
      }

      const raw: unknown = request.postDataJSON()
      const body = v.parse(catalogSeriesBulkWatchSchema, raw)

      expect(body.currentViewingId).toBe(viewingId)
      expect(body.contextVersion).toBe(1)

      const episodeIds = Array.from({ length: 5 }, (_value, index) => {
        const sequence = String(index + 1)
        const suffix = sequence.padStart(12, '0')
        const episodeId = `30000000-0000-7000-8000-${suffix}`

        return episodeId
      })

      state = seriesResponse(episodeIds, viewingId, 1)

      await route.fulfill({ json: state })
    })

    const rewatchRoute = `**/api/catalog/items/${chernobyl.id}/rewatch`

    await page.route(rewatchRoute, async (route) => {
      const request = route.request()

      // The same endpoint owns explicit start and empty-viewing cancellation.
      // oxlint-disable-next-line vitest/no-conditional-in-test -- One route serves explicit start and cancellation.
      if (request.method() === 'DELETE') {
        const raw: unknown = request.postDataJSON()
        const cancellation = v.parse(catalogSeriesCancelRewatchSchema, raw)

        expect(cancellation.currentViewingId).toBe(nextViewingId)

        state = seriesResponse([firstEpisodeId], viewingId, 3)
        rewatched = false

        await route.fulfill({ json: state })

        return
      }

      const raw: unknown = request.postDataJSON()
      const body = v.parse(catalogSeriesRewatchSchema, raw)

      expect(body).not.toHaveProperty('closeStatus')
      expect(body.currentViewingId).toBe(viewingId)

      state = seriesResponse([], nextViewingId, 2)
      rewatched = true

      await route.fulfill({ json: state })
    })

    const historyRoute = `**${timelinePath}?*`

    await page.route(historyRoute, async (route) => {
      const rows = rewatchHistory(rewatched, state.watchedEpisodeIds.length > 0)

      await route.fulfill({ json: {
        items: rows,
        nextCursor: null
      } })
    })

    await page.goto(titlePath)
    await openEpisodes(page)

    await expect(page.getByRole('button', {
      name: 'Start rewatch',
      exact: true
    })).toHaveCount(0)

    await page.getByRole('listitem').filter({ hasText: '1:23:45' }).getByRole('button', {
      name: 'Watched',
      exact: true
    }).click()

    await expect(page.getByText('1 watched episode', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Mark all episodes watched' }).click()
    await expect(page.getByText('5 watched episodes', { exact: true })).toBeVisible()

    const rewatch = page.getByRole('button', {
      name: 'Start rewatch',
      exact: true
    })

    await expect(rewatch).toBeEnabled()
    await rewatch.focus()
    await expect(rewatch).toBeFocused()
    await page.keyboard.press('Enter')

    const dialog = page.getByRole('dialog', { name: 'Start a rewatch' })

    await expect(dialog).toBeVisible()

    await expect(dialog.getByRole('button', {
      name: 'Cancel',
      exact: true
    })).toBeFocused()

    await expect(dialog.getByRole('button', { name: /(?:Pause|Complete) current viewing/u })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(rewatch).toBeFocused()
    await page.keyboard.press('Enter')

    await dialog.getByRole('button', {
      name: 'Start rewatch',
      exact: true
    }).click()

    await expect(dialog).not.toBeVisible()

    const undo = page.getByRole('button', {
      name: 'Cancel rewatch',
      exact: true
    })

    await expect(undo).toBeFocused()
    await expect(rewatch).toHaveCount(0)
    await expect(page.getByText('0 watched episodes', { exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Your timeline' }).getByText('Watched 25 episodes')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Your timeline' }).getByText('Started rewatch')).toBeVisible()
    await undo.click()
    await expect(rewatch).toBeFocused()
    await expect(page.getByText('1 watched episode', { exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Your timeline' }).getByText('Started rewatch')).toHaveCount(0)
})

test.describe('rewatch cancellation conflicts', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: `/api/catalog/items/${chernobyl.id}/rewatch`,
    status: 409
  }] } })

  test('keeps the cancellation error visible when another tab has marked an episode', async ({ context, page }) => {
    let state = seriesResponse([], nextViewingId, 2)

    await addCookie(context, 'tv_session', 'e2e-session')
    await page.route(`**${watchedPath}`, async route => { await route.fulfill({ json: state }) })

    await page.route(`**/api/catalog/items/${chernobyl.id}/rewatch`, async route => {
      expect(route.request().method()).toBe('DELETE')

      state = seriesResponse([firstEpisodeId], nextViewingId, 2)

      await route.fulfill({
        status: 409,
        json: { error: 'CONFLICT' }
      })
    })

    await page.goto(titlePath)
    await openEpisodes(page)

    await page.getByRole('button', {
      name: 'Cancel rewatch',
      exact: true
    }).click()

    await expect(page.getByText('1 watched episode', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel rewatch' })).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveText('Your current viewing changed. Check the updated episodes and try again.')

    await expect(page.getByRole('button', {
      name: 'Start rewatch',
      exact: true
    })).toBeFocused()
  })
})
