/* oxlint-disable vitest/prefer-each -- Named viewport and theme cases cover separate layout states. */
import { strict as assert } from 'node:assert'
import type { Locator } from '@playwright/test'
import * as v from 'valibot'
import { catalogSeriesBulkWatchSchema } from '../../../packages/shared/src/catalog-series.ts'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie, expectNoHorizontalOverflow } from '../helpers.ts'
import { episodeEdgeSeries } from './details.fixtures.ts'
import { openEpisodes } from './helpers.ts'
import { seriesResponse, viewingId } from './timeline.fixtures.ts'

const titlePath = `/titles/${episodeEdgeSeries.id}`
const watchedPath = `/api/catalog/items/${episodeEdgeSeries.id}/episodes/watched`
const seasonPath = `/api/catalog/items/${episodeEdgeSeries.id}/seasons/2/watched`
const firstSeasonEpisodeId = '30000000-0000-7000-8000-000000000012'
const secondSeasonEpisodeId = '30000000-0000-7000-8000-000000000013'

function edgeSeriesState(ids: string[]) {
  const state = seriesResponse(ids, viewingId, 1)

  assert.ok(state.currentViewing)

  state.currentViewing.catalogItemId = episodeEdgeSeries.id

  return state
}

test.use({ timezoneId: 'Europe/Tallinn' })

test.beforeEach(async ({ context, page }) => {
  // One dated episode in each season is available; the other two are future or undated.
  await page.clock.setFixedTime(new Date('2099-02-05T12:00:00Z'))
  await addCookie(context, 'tv_session', 'e2e-session')
})

async function expectSeparateScopes(episodes: Locator): Promise<void> {
  const all = episodes.getByRole('button', {
    name: 'Mark all seasons watched',
    exact: true
  })

  const season = episodes.getByRole('region', {
    name: 'Season 2',
    exact: true
  })

  const local = season.getByRole('button', {
    name: 'Mark season 2 watched',
    exact: true
  })

  const header = episodes.getByRole('button', {
    name: 'Season 2',
    exact: true
  })

  const watch = season.getByRole('button', {
    name: 'Watched',
    exact: true
  })

  const rate = season.getByRole('button', {
    name: 'Rate season 2',
    exact: true
  })

  await expect(all).toHaveCount(1)
  await expect(all).toHaveText('Mark all seasons watched')
  await expect(season.getByRole('button', { name: /^Mark .* watched$/u })).toHaveCount(1)
  await expect(local).toHaveText('Mark season 2 watched')
  await expect(rate).toBeEnabled()

  const [allBox, headerBox, localBox, watchBox, rateBox] = await Promise.all([
    all.boundingBox(), header.boundingBox(), local.boundingBox(), watch.boundingBox(), rate.boundingBox()
  ])

  assert.ok(allBox)
  assert.ok(headerBox)
  assert.ok(localBox)
  assert.ok(watchBox)
  assert.ok(rateBox)
  expect(allBox.y + allBox.height).toBeLessThanOrEqual(headerBox.y)
  expect(localBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height)
  expect(localBox.y + localBox.height).toBeLessThanOrEqual(watchBox.y)
  expect(Math.abs(localBox.x + localBox.width - watchBox.x - watchBox.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(allBox.x + allBox.width - watchBox.x - watchBox.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(rateBox.x + rateBox.width - watchBox.x - watchBox.width)).toBeLessThanOrEqual(1)
}

test.describe('bulk scope and retry', () => {
  test.use({ expectedHttpErrors: { values: [{
    pathname: watchedPath,
    status: 503
  }] } })

  test('keeps season and series writes separate, available when collapsed, and retryable', async ({ page }) => {
    const pending = Promise.withResolvers<unknown>()
    const allPending = Promise.withResolvers<unknown>()
    const allKeys: string[] = []
    let state = edgeSeriesState([])

    await page.emulateMedia({ reducedMotion: 'reduce' })

    await page.route(`**${watchedPath}`, async route => {
      const request = route.request()
      const method = request.method()

      // oxlint-disable-next-line vitest/no-conditional-in-test -- One endpoint serves status and the series command.
      if (method === 'GET') {
        await route.fulfill({ json: state })

        return
      }

      expect(route.request().method()).toBe('POST')

      const raw: unknown = route.request().postDataJSON()
      const body = v.parse(catalogSeriesBulkWatchSchema, raw)

      expect(body.currentViewingId).toBe(viewingId)
      allKeys.push(body.requestId)

      // oxlint-disable-next-line vitest/no-conditional-in-test -- The first write fails so the same visible command can retry.
      if (allKeys.length === 1) {
        await allPending.promise

        await route.fulfill({
          status: 503,
          json: { error: { message: 'Controlled write failure.' } }
        })

        return
      }

      state = edgeSeriesState([firstSeasonEpisodeId, secondSeasonEpisodeId])

      await route.fulfill({ json: state })
    })

    await page.route(`**${seasonPath}`, async route => {
      expect(route.request().method()).toBe('POST')

      const raw: unknown = route.request().postDataJSON()
      const body = v.parse(catalogSeriesBulkWatchSchema, raw)

      expect(body.contextVersion).toBe(1)
      expect(body.timeZone).toBe('Europe/Tallinn')

      await pending.promise
      state = edgeSeriesState([secondSeasonEpisodeId])

      await route.fulfill({ json: state })
    })

    await page.route(`**/api/catalog/episodes/${firstSeasonEpisodeId}/watched`, async route => {
      expect(route.request().method()).toBe('DELETE')

      state = edgeSeriesState([secondSeasonEpisodeId])

      await route.fulfill({ json: state })
    })

    await page.goto(titlePath)
    await openEpisodes(page)

    const episodes = page.getByRole('region', {
      name: 'Episodes',
      exact: true
    })

    const first = episodes.getByRole('button', {
      name: 'Season 1',
      exact: true
    })

    const second = episodes.getByRole('button', {
      name: 'Season 2',
      exact: true
    })

    const local = episodes.getByRole('button', {
      name: 'Mark season 2 watched',
      exact: true
    })

    const all = episodes.getByRole('button', {
      name: 'Mark all seasons watched',
      exact: true
    })

    await expectSeparateScopes(episodes)
    await expect(local).toBeEnabled()
    await local.focus()
    await page.keyboard.press('Enter')
    await expect(local).toHaveAttribute('aria-busy', 'true')
    await expect(local).toBeDisabled()
    await expect(all).toBeDisabled()
    await expect(episodes.getByText('0 watched episodes', { exact: true })).toBeVisible()
    pending.resolve(null)
    await expect(episodes.getByText('1 watched episode', { exact: true })).toBeVisible()
    await expect(local).not.toHaveAttribute('aria-busy')
    await expect(local).toBeDisabled()
    await expect(all).toBeEnabled()
    await expect(first).toHaveAccessibleDescription('2 episodes · 0 watched')
    await expect(second).toHaveAccessibleDescription('2 episodes · 1 watched')
    await second.click()
    await expect(episodes.getByRole('listitem')).toHaveCount(0)
    await expect(all).toBeVisible()

    const before = await episodes.boundingBox()

    assert.ok(before)
    await all.focus()
    await page.keyboard.press('Enter')
    await expect(all).toHaveAttribute('aria-busy', 'true')
    await expect(all).toBeDisabled()

    const during = await episodes.boundingBox()

    assert.ok(during)
    expect(during.height).toBe(before.height)
    allPending.resolve(null)
    await expect(episodes.getByRole('alert')).toHaveText('We couldn’t save this change. Try again.')
    await expect(all).toBeEnabled()
    await expect(episodes.getByText('1 watched episode', { exact: true })).toBeVisible()
    await all.click()
    await expect(episodes.getByText('2 watched episodes', { exact: true })).toBeVisible()
    await expect(episodes.getByRole('alert')).toHaveCount(0)
    await expect(all).not.toHaveAttribute('aria-busy')
    await expect(all).toBeDisabled()
    expect(allKeys).toHaveLength(2)
    expect(allKeys[1]).toBe(allKeys[0])
    await first.click()

    const firstPanel = episodes.getByRole('region', {
      name: 'Season 1',
      exact: true
    })

    const firstAction = firstPanel.getByRole('button', {
      name: 'Mark season 1 watched',
      exact: true
    })

    const watched = firstPanel.getByRole('button', {
      name: 'Watched',
      exact: true
    })

    await expect(firstAction).toBeDisabled()
    await expect(watched).toHaveAttribute('aria-pressed', 'true')
    await watched.click()
    await expect(firstAction).toBeEnabled()
    await expect(all).toBeEnabled()
    await expect(episodes.getByText('1 watched episode', { exact: true })).toBeVisible()
  })
})

test('keeps series and season commands visible but disabled when no episode is eligible', async ({ page }) => {
  const beforeEveryRelease = new Date('2098-12-31T12:00:00Z')

  await page.clock.setFixedTime(beforeEveryRelease)
  await page.goto(titlePath)
  await openEpisodes(page)

  const episodes = page.getByRole('region', {
    name: 'Episodes',
    exact: true
  })

  const series = episodes.getByRole('button', {
    name: 'Mark all seasons watched',
    exact: true
  })

  const season = episodes.getByRole('button', {
    name: 'Mark season 2 watched',
    exact: true
  })

  await expect(series).toBeVisible()
  await expect(series).toBeDisabled()
  await expect(season).toBeVisible()
  await expect(season).toBeDisabled()

  await expect(episodes.getByRole('button', {
    name: 'Watched',
    exact: true
  })).toHaveCount(0)

  await episodes.getByRole('button', {
    name: 'Season 1',
    exact: true
  }).click()

  const firstSeason = episodes.getByRole('button', {
    name: 'Mark season 1 watched',
    exact: true
  })

  await expect(firstSeason).toBeVisible()
  await expect(firstSeason).toBeDisabled()
})

test('keeps watched scope labels inside a narrow page with double-sized text', async ({ page }) => {
  await page.setViewportSize({
    width: 320,
    height: 844
  })

  await page.goto(titlePath)
  await openEpisodes(page)
  await page.evaluate(() => { globalThis.document.documentElement.style.fontSize = '200%' })

  const episodes = page.getByRole('region', {
    name: 'Episodes',
    exact: true
  })

  await expectSeparateScopes(episodes)
  await expectNoHorizontalOverflow(page)
})

for (const colorScheme of ['light', 'dark'] as const) {
  for (const width of [320, 390, 768, 1440]) {
    test(`shows clear watched scopes in ${colorScheme} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({
        width,
        height: 1024
      })

      await page.emulateMedia({ colorScheme })
      await page.goto(titlePath)
      await openEpisodes(page)
      await page.evaluate(async () => globalThis.document.fonts.ready)

      const episodes = page.getByRole('region', {
        name: 'Episodes',
        exact: true
      })

      await expectSeparateScopes(episodes)
      await expectNoHorizontalOverflow(page)

      await episodes.screenshot({
        path: `/tmp/tv-gh-89-scopes-${colorScheme}-${width}.png`,

        // Keep unrelated fixed navigation out of this isolated component capture.
        style: 'nav[aria-label="Main navigation"] { visibility: hidden; }'
      })
    })
  }
}
