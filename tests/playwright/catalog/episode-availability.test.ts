import { strict as assert } from 'node:assert'
import type { BrowserContext, Page } from '@playwright/test'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { chernobyl } from './details.fixtures.ts'
import { episodeFixtures } from './episodes.fixtures.ts'
import { openEpisodes } from './helpers.ts'
import { seriesResponse, titlePath, viewingId, watchedPath } from './timeline.fixtures.ts'

const dates = ['2026-10-08', '2026-10-09', '2026-10-10', null, '2026-10-11'] as const
const sourceEpisodes = episodeFixtures.get(chernobyl.id) ?? []

const episodes = sourceEpisodes.map((episode, index) => {
  return {
    id: episode.id,
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    sourceTitle: episode.sourceTitle,
    airDate: dates[index] ?? null
  }
})

async function mockDates(page: Page): Promise<void> {
  await page.route(`**/api/catalog/items/${chernobyl.id}/episodes`, async route => {
    await route.fulfill({ json: { items: episodes } })
  })
}

async function openDatedEpisodes(page: Page, context: BrowserContext): Promise<void> {
  // Force a client read so the browser route can replace the normal SSR episode payload.
  await addCookie(context, 'fail_episodes', '1')
  await page.goto(titlePath)
  await openEpisodes(page)
  await context.clearCookies({ name: 'fail_episodes' })

  await page.getByRole('button', {
    name: 'Try again',
    exact: true
  }).click()

  await expect(page.getByRole('listitem')).toHaveCount(5)
}

async function removeOldMark(page: Page, title: string): Promise<void> {
  const row = page.getByRole('listitem').filter({ hasText: title })

  const mark = row.getByRole('button', {
    name: 'Watched',
    exact: true
  })

  await expect(mark).toHaveAttribute('aria-pressed', 'true')
  await mark.focus()
  await page.keyboard.press('Enter')
  await expect(mark).toHaveCount(0)
  await expect(row).toBeFocused()
}

const zones = [{
  name: 'Los Angeles before local release day',
  timezoneId: 'America/Los_Angeles',
  available: 1
}, {
  name: 'Tokyo on local release day',
  timezoneId: 'Asia/Tokyo',
  available: 2
}] as const

for (const zone of zones) {
  test.describe(zone.name, () => {
    test.use({ timezoneId: zone.timezoneId })

    test('offers new marks only for dated episodes available in the browser day', async ({ context, page }) => {
      await page.clock.setFixedTime(new Date('2026-10-09T00:30:00Z'))
      await mockDates(page)
      await openDatedEpisodes(page, context)

      await expect(page.getByRole('link', {
        name: 'Sign in to mark watched',
        exact: true
      })).toHaveCount(zone.available)

      await addCookie(context, 'tv_session', 'e2e-session')
      await openDatedEpisodes(page, context)

      await expect(page.getByRole('button', {
        name: 'Watched',
        exact: true
      })).toHaveCount(zone.available)

      await expect(page.getByRole('listitem')).toHaveCount(5)

      const future = page.getByRole('listitem').filter({ hasText: 'Open Wide, O Earth' })
      const undated = page.getByRole('listitem').filter({ hasText: 'The Happiness of All Mankind' })

      await expect(future.getByRole('button', {
        name: 'Watched',
        exact: true
      })).toHaveCount(0)

      await expect(undated.getByRole('button', {
        name: 'Watched',
        exact: true
      })).toHaveCount(0)

      await expect(future.getByRole('button', { name: /^Rate episode,/u })).toBeEnabled()
      await expect(undated.getByRole('button', { name: /^Rate episode,/u })).toBeEnabled()

      await expect(page.getByRole('button', {
        name: 'Mark season 1 watched',
        exact: true
      })).toBeEnabled()
    })
  })
}

test.describe('local midnight', () => {
  test.use({ timezoneId: 'America/Los_Angeles' })

  test('makes the next dated episode available at local midnight without a reload', async ({ context, page }) => {
    await page.clock.install({ time: new Date('2026-10-09T06:59:50Z') })
    await addCookie(context, 'tv_session', 'e2e-session')
    await mockDates(page)
    await openDatedEpisodes(page, context)

    const watched = page.getByRole('button', {
      name: 'Watched',
      exact: true
    })

    await expect(watched).toHaveCount(1)
    await page.clock.fastForward(15_000)
    await expect(watched).toHaveCount(2)
  })
})

test('removes old future and undated marks without leaving new controls or losing focus', async ({ context, page }) => {
  await page.clock.setFixedTime(new Date('2026-10-09T12:00:00Z'))
  await addCookie(context, 'tv_session', 'e2e-session')
  await mockDates(page)

  const futureId = episodes[2]?.id
  const undatedId = episodes[3]?.id

  assert.ok(futureId !== undefined)
  assert.ok(undatedId !== undefined)

  let state = seriesResponse([futureId, undatedId], viewingId, 1)

  await page.route(`**${watchedPath}`, async route => { await route.fulfill({ json: state }) })

  await page.route('**/api/catalog/episodes/*/watched', async route => {
      expect(route.request().method()).toBe('DELETE')

      const id = new URL(route.request().url()).pathname.split('/').at(-2)

      expect([futureId, undatedId]).toContain(id)

      const remaining = state.watchedEpisodeIds.filter(episodeId => episodeId !== id)

      state = seriesResponse(remaining, viewingId, 1)

      await route.fulfill({ json: state })
    })

  await openDatedEpisodes(page, context)
  await removeOldMark(page, 'Open Wide, O Earth')
  await removeOldMark(page, 'The Happiness of All Mankind')
  await expect(page.getByText('0 watched episodes', { exact: true })).toBeVisible()
})
