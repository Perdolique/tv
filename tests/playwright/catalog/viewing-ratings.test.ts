/* oxlint-disable vitest/prefer-each -- Each target is a distinct visible rating entry point. */
import * as v from 'valibot'

import {
  catalogRatingMutationResponseSchema,
  catalogViewingsResponseSchema
} from '../../../packages/shared/src/catalog-viewings.ts'

import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { chernobyl, dune } from './details.fixtures.ts'
import { openEpisodes, waitForHydration } from './helpers.ts'

const episodeId = '30000000-0000-7000-8000-000000000001'
const seriesApi = `/api/catalog/items/${chernobyl.id}`
const movieApi = `/api/catalog/items/${dune.id}`

const targets = [{
  name: 'movie',
  item: dune,
  api: `${movieApi}/rating`,
  panel: 'Your rating',
  trigger: 'Rate',
  date: 'Watched on',
  episodes: false,
  watchCount: 0,

  viewing: {
    status: 'completed',
    completedOn: '2020-04-01'
  }
}, {
  name: 'series',
  item: chernobyl,
  api: `${seriesApi}/rating`,
  panel: 'Your rating',
  trigger: 'Rate',
  date: 'Started on',
  episodes: false,
  watchCount: 0,

  viewing: {
    status: 'watching',
    startedOn: '2020-04-01',
    completedOn: null
  }
}, {
  name: 'season',
  item: chernobyl,
  api: `${seriesApi}/seasons/1/rating`,
  panel: 'Season 1 ratings',
  trigger: 'Rate season 1',
  date: 'Started on',
  episodes: true,
  watchCount: 0,

  viewing: {
    status: 'watching',
    startedOn: '2020-04-01',
    completedOn: null
  }
}, {
  name: 'episode',
  item: chernobyl,
  api: `/api/catalog/episodes/${episodeId}/rating`,
  panel: 'Ratings for season 1, episode 1',
  trigger: 'Rate episode, Your rating for season 1, episode 1',
  date: 'Started on',
  episodes: true,
  watchCount: 1,

  viewing: {
    status: 'watching',
    startedOn: '2020-04-01',
    completedOn: null
  }
}] as const

test.beforeEach(async ({ context, page }) => {
  await addCookie(context, 'tv_session', 'e2e-session')

  const now = new Date('2026-10-17T12:00:00Z')

  await page.clock.setFixedTime(now)
})

for (const target of targets) {
  test(`first ${target.name} rating creates exactly one dated viewing and keeps parent scores independent`, async ({ context, page }) => {
    const writes: string[] = []
    const timelineReads: string[] = []

    page.on('request', request => {
      // oxlint-disable-next-line vitest/no-conditional-in-test -- Count catalog writes while ignoring the independent reads.
      if (request.method() !== 'GET' && request.url().includes('/api/catalog/')) { writes.push(request.url()) }

      const requestUrl = request.url()
      const timelinePath = `/api/catalog/items/${target.item.id}/timeline?`

      // oxlint-disable-next-line vitest/no-conditional-in-test -- Count timeline requests separately from private score and history reads.
      if (request.method() === 'GET' && requestUrl.includes(timelinePath)) { timelineReads.push(requestUrl) }
    })

    await page.goto(`/titles/${target.item.id}`)
    await waitForHydration(page)

    // oxlint-disable-next-line vitest/no-conditional-in-test -- Season and episode controls live on the Episodes tab.
    if (target.episodes) { await openEpisodes(page) }

    const panel = page.getByRole('region', {
      name: target.panel,
      exact: true
    })

    await panel.getByRole('button', {
      name: target.trigger,
      exact: true
    }).click()

    const date = panel.getByLabel(target.date, { exact: true })

    await expect(date).toHaveValue('2026-10-17')
    await expect(date).toHaveAttribute('required', '')
    await expect(panel.getByRole('checkbox')).toHaveCount(0)
    await date.fill('2020-04-01')

    const timeline = page.getByRole('region', {
      name: 'Your timeline',
      exact: true
    })

    await expect(timeline).toContainText('Your activity for this title will appear here.')

    const initialTimelineReads = timelineReads.length
    const saved = page.waitForResponse(response => response.url().endsWith(target.api))

    await panel.getByRole('button', {
      name: '8 out of 10',
      exact: true
    }).click()

    const response = await saved
    const request = response.request()
    const input: unknown = request.postDataJSON()
    const raw: unknown = await response.json()
    const result = v.parse(catalogRatingMutationResponseSchema, raw)

    expect(input).toMatchObject({
      score: 8,
      currentViewingId: null,
      contextVersion: 0,
      viewingDate: '2020-04-01'
    })

    expect(input).toHaveProperty('requestId')
    expect(result.score).toBe(8)
    expect(result.viewing).toMatchObject(target.viewing)

    const historyPath = `/api/catalog/items/${target.item.id}/viewings`
    const historyResponse = await context.request.get(historyPath)
    const historyRaw: unknown = await historyResponse.json()
    const history = v.parse(catalogViewingsResponseSchema, historyRaw)

    // oxlint-disable-next-line vitest/no-conditional-in-test -- The title type selects its own visible viewing-start label.
    const expectedTimelineLabel = target.item.type === 'movie' ? 'Watched movie' : 'Started watching'

    await expect(timeline.getByText(expectedTimelineLabel, { exact: true })).toBeVisible()
    expect(timelineReads).toHaveLength(initialTimelineReads + 1)
    expect(history.items).toHaveLength(1)
    expect(history.items[0]?.id).toBe(result.viewing?.id)
    expect(writes).toHaveLength(1)

    // oxlint-disable-next-line vitest/no-conditional-in-test -- The wire contract includes watches only for episode ratings with a viewing.
    const confirmedMarks = result.watches ?? []

    expect(confirmedMarks).toHaveLength(target.watchCount)

    await expect(page.getByRole('region', {
      name: 'Your viewings',
      exact: true
    }).getByRole('listitem')).toHaveCount(1)

    // oxlint-disable-next-line vitest/no-conditional-in-test -- The episode entry point must refresh its watched control atomically.
    if (target.name === 'episode') {
      await expect(page.getByRole('listitem').filter({ hasText: '1:23:45' }).getByRole('button', {
        name: 'Watched',
        exact: true
      })).toHaveAttribute('aria-pressed', 'true')
    }

    // oxlint-disable-next-line vitest/no-conditional-in-test -- Child scores never fill the whole-title score.
    if (target.name === 'season' || target.name === 'episode') {
      await expect(page.getByRole('region', {
        name: 'Personal score',
        exact: true
      })).not.toContainText('8 out of 10')
    }

    await expect(page.getByRole('region', {
      name: 'Your timeline',
      exact: true
    }).getByText(/^(?:Rated|Updated rating)$/u)).toHaveCount(0)
  })
}
