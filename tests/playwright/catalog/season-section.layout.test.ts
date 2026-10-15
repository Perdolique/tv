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

test('keeps one season action stable for a single-season title', async ({ context, page }) => {
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

  await page.route(`**/api/catalog/items/${chernobyl.id}/seasons/1/watched`, async route => {
    expect(route.request().method()).toBe('POST')

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
    name: 'Mark season 1 watched',
    exact: true
  })

  const panel = episodes.getByRole('region', {
    name: 'Season 1',
    exact: true
  })

  const header = episodes.getByRole('heading', {
    name: 'Season 1',
    exact: true
  }).locator('..')

  await expect(episodes.getByText('1 watched episode', { exact: true })).toBeVisible()
  await expect(season).toHaveAccessibleDescription('5 episodes · 1 watched')
  await expect(header.getByRole('button')).toHaveCount(1)
  await expect(panel.getByRole('button', { name: /^Mark .* watched$/u })).toHaveCount(1)

  await expect(episodes.getByRole('button', {
    name: 'Mark all seasons watched',
    exact: true
  })).toHaveCount(0)

  await expect(mark).toHaveText('Mark season 1 watched')
  await expect(mark.locator('svg')).toHaveCount(0)
  await expect(mark).not.toHaveAttribute('aria-pressed')

  const lastWatch = list.getByRole('button', {
    name: 'Watched',
    exact: true
  }).last()

  const [markBox, listBox, watchBox] = await Promise.all([
    mark.boundingBox(), list.boundingBox(), lastWatch.boundingBox()
  ])

  assert.ok(markBox)
  assert.ok(listBox)
  assert.ok(watchBox)
  expect(Math.abs(markBox.x + markBox.width - watchBox.x - watchBox.width)).toBeLessThanOrEqual(1)
  expect(markBox.y + markBox.height).toBeLessThanOrEqual(listBox.y)
  expect(listBox.y - markBox.y - markBox.height).toBeLessThanOrEqual(24)

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
  await expect(mark).not.toHaveAttribute('aria-busy')
  await expect(mark).toBeDisabled()
  await expect(season).toHaveAccessibleDescription('5 episodes · 5 watched')
  await expect(mark).toHaveText('Mark season 1 watched')

  const after = await episodes.boundingBox()

  assert.ok(after)
  expect(after.height).toBe(before.height)
  await expectNoHorizontalOverflow(page)
})
