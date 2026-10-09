/* oxlint-disable vitest/prefer-each -- Theme and action scenarios keep useful names in browser reports. */
import { strict as assert } from 'node:assert'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie, expectNoHorizontalOverflow } from '../helpers.ts'
import { chernobyl, manyEpisodeSeries } from './details.fixtures.ts'
import { episodeFixtures } from './episodes.fixtures.ts'
import { openEpisodes } from './helpers.ts'
import { firstEpisodeId, seriesResponse, viewingId, watchedPath } from './timeline.fixtures.ts'

test.use({ timezoneId: 'Europe/Tallinn' })

for (const colorScheme of ['dark', 'light'] as const) {
  test(`keeps the desktop timeline near ratings with a long episode list in ${colorScheme}`, async ({ context, page }) => {
    await addCookie(context, 'tv_session', 'e2e-session')

    await page.setViewportSize({
      width: 1440,
      height: 1024
    })

    await page.emulateMedia({ colorScheme })
    await page.goto(`/titles/${manyEpisodeSeries.id}`)
    await openEpisodes(page)

    const episodes = page.getByRole('region', {
      name: 'Episodes',
      exact: true
    })

    const timeline = page.getByRole('region', { name: 'Your timeline' })
    const ratings = page.getByRole('complementary', { name: 'Title ratings' })

    await expect(episodes.getByRole('listitem')).toHaveCount(20)
    await expect(timeline.getByText('Your activity for this title will appear here.')).toBeVisible()

    const [episodeBox, timelineBox, ratingsBox] = await Promise.all([
      episodes.boundingBox(), timeline.boundingBox(), ratings.boundingBox()
    ])

    assert.ok(episodeBox)
    assert.ok(timelineBox)
    assert.ok(ratingsBox)
    expect(episodeBox.height).toBeGreaterThan(1200)

    const distanceFromRatings = timelineBox.y - ratingsBox.y - ratingsBox.height

    expect(distanceFromRatings).toBeGreaterThanOrEqual(16)
    expect(distanceFromRatings).toBeLessThanOrEqual(96)
    expect(timelineBox.y).toBeLessThan(1024)
    await expectNoHorizontalOverflow(page)

    await page.screenshot({
      path: `/tmp/tv-seasons-${colorScheme}-desktop-long.png`,
      fullPage: true
    })
  })
}

const bulkActions = [{
  name: 'Mark season 1 watched',
  path: `/api/catalog/items/${chernobyl.id}/seasons/1/watched`,
  insideSeason: 1,
  label: 'Mark season watched'
}, {
  name: 'Mark all episodes watched',
  path: watchedPath,
  insideSeason: 1,
  label: 'Mark all watched'
}] as const

for (const action of bulkActions) {
  test(`keeps the season section fixed while saving ${action.name}`, async ({ context, page }) => {
    const pending = Promise.withResolvers<unknown>()
    const sourceEpisodes = episodeFixtures.get(chernobyl.id)

    assert.ok(sourceEpisodes)

    const ids = sourceEpisodes.map(episode => episode.id)
    let state = seriesResponse([firstEpisodeId], viewingId, 1)

    await addCookie(context, 'tv_session', 'e2e-session')

    await page.setViewportSize({
      width: 1440,
      height: 1024
    })

    await page.route(`**${watchedPath}`, async route => { await route.fulfill({ json: state }) })

    await page.route(`**${action.path}`, async route => {
      // oxlint-disable-next-line vitest/no-conditional-in-test -- The all-released action shares the watched-status GET path.
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: state })

        return
      }

      await pending.promise
      state = seriesResponse(ids, viewingId, 1)

      await route.fulfill({ json: state })
    })

    await page.goto(`/titles/${chernobyl.id}`)
    await openEpisodes(page)

    const episodes = page.getByRole('region', {
      name: 'Episodes',
      exact: true
    })

    const season = episodes.getByRole('button', {
      name: 'Season 1',
      exact: true
    })

    const list = episodes.getByRole('list')

    const mark = episodes.getByRole('button', {
      name: action.name,
      exact: true
    })

    await expect(episodes.getByText('1 watched episode', { exact: true })).toBeVisible()
    await expect(season).toHaveAccessibleDescription('5 episodes · 1 watched')

    const header = episodes.getByRole('heading', {
      name: 'Season 1',
      exact: true
    }).locator('..')

    const panel = episodes.getByRole('region', {
      name: 'Season 1',
      exact: true
    })

    await expect(header.getByRole('button')).toHaveCount(1)

    await expect(panel.getByRole('button', {
      name: action.name,
      exact: true
    })).toHaveCount(action.insideSeason)

    await expect(mark).toHaveText(action.label)
    await expect(mark.locator('svg')).toHaveCount(0)
    await expect(mark).not.toHaveAttribute('aria-pressed')

    const actions = panel.getByRole('group', { name: 'Watched actions for season 1' })

    const lastWatch = list.getByRole('button', {
      name: 'Watched',
      exact: true
    }).last()

    const allEpisodes = actions.getByRole('button', {
      name: 'Mark all episodes watched',
      exact: true
    })

    const [actionsBox, allBox, listBox, watchBox] = await Promise.all([
      actions.boundingBox(), allEpisodes.boundingBox(), list.boundingBox(), lastWatch.boundingBox()
    ])

    assert.ok(actionsBox)
    assert.ok(allBox)
    assert.ok(listBox)
    assert.ok(watchBox)
    await expect(actions.getByRole('button')).toHaveCount(2)
    expect(Math.abs(allBox.x + allBox.width - watchBox.x - watchBox.width)).toBeLessThanOrEqual(1)
    expect(actionsBox.y + actionsBox.height).toBeLessThanOrEqual(listBox.y)
    expect(listBox.y - actionsBox.y - actionsBox.height).toBeLessThanOrEqual(24)

    await expect(episodes.getByRole('region', {
      name: 'Viewer rating for season 1, episode 1',
      exact: true
    }).getByText('Not rated', { exact: true })).toBeVisible()

    await expect(episodes.getByText('Loading…', { exact: true })).toHaveCount(0)
    await page.evaluate(async () => globalThis.document.fonts.ready)
    await season.hover()

    const edges = await season.locator('..').locator('..').evaluate(element => {
      const style = globalThis.getComputedStyle(element)

      return [style.borderBottomLeftRadius, style.borderBottomRightRadius]
    })

    expect(edges).toStrictEqual(['0px', '0px'])

    const listBorder = await list.evaluate(element => globalThis.getComputedStyle(element).borderTopWidth)

    expect(listBorder).toBe('0px')
    await expect(episodes.getByText('Only episodes with a known air date up to today in your time zone are included.')).toHaveCount(0)

    const before = await episodes.boundingBox()
    const beforeHeader = await season.boundingBox()

    assert.ok(before)
    assert.ok(beforeHeader)
    await mark.click()
    await expect(mark).toHaveAttribute('aria-busy', 'true')
    await expect(mark).toBeDisabled()

    const during = await episodes.boundingBox()
    const duringHeader = await season.boundingBox()

    assert.ok(during)
    assert.ok(duringHeader)
    expect(during.height).toBe(before.height)
    expect(duringHeader.y).toBe(beforeHeader.y)
    pending.resolve(null)
    await expect(episodes.getByText('5 watched episodes', { exact: true })).toBeVisible()
    await expect(mark).toBeEnabled()
    await expect(season).toHaveAccessibleDescription('5 episodes · 5 watched')
    await expect(mark).toHaveText(action.label)

    const after = await episodes.boundingBox()

    assert.ok(after)
    expect(after.height).toBe(before.height)
    await expectNoHorizontalOverflow(page)
  })
}
