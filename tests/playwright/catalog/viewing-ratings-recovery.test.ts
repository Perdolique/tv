import * as v from 'valibot'
import { catalogViewingsResponseSchema } from '../../../packages/shared/src/catalog-viewings.ts'
import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { chernobyl, dune } from './details.fixtures.ts'
import { openEpisodes, waitForHydration } from './helpers.ts'

test.use({ timezoneId: 'Europe/Tallinn' })

const targets = [{
  name: 'movie',
  item: dune,
  api: `/api/catalog/items/${dune.id}/rating`,
  panel: 'Your rating',
  trigger: 'Rate',
  date: 'Watched on',
  episodes: false,
  dateField: 'completedOn'
}, {
  name: 'series',
  item: chernobyl,
  api: `/api/catalog/items/${chernobyl.id}/rating`,
  panel: 'Your rating',
  trigger: 'Rate',
  date: 'Started on',
  episodes: false,
  dateField: 'startedOn'
}, {
  name: 'season',
  item: chernobyl,
  api: `/api/catalog/items/${chernobyl.id}/seasons/1/rating`,
  panel: 'Season 1 ratings',
  trigger: 'Rate season 1',
  date: 'Started on',
  episodes: true,
  dateField: 'startedOn'
}, {
  name: 'episode',
  item: chernobyl,
  api: '/api/catalog/episodes/30000000-0000-7000-8000-000000000001/rating',
  panel: 'Ratings for season 1, episode 1',
  trigger: 'Rate episode, Your rating for season 1, episode 1',
  date: 'Started on',
  episodes: true,
  dateField: 'startedOn'
}] as const

for (const target of targets) {
  test.describe(`${target.name} first-rating recovery`, () => {
    test.use({ expectedHttpErrors: { values: [{
      pathname: target.api,
      status: 503
    }] } })

    test('retries the same committed rating after midnight without another viewing or a changed date', async ({ context, page }) => {
      await addCookie(context, 'tv_session', 'e2e-session')

      const beforeMidnight = new Date('2026-10-17T20:59:00Z')

      await page.clock.setFixedTime(beforeMidnight)

      const inputs: unknown[] = []

      await page.route(`**${target.api}`, async route => {
        // oxlint-disable-next-line vitest/no-conditional-in-test -- Only rating writes lose a committed response; initial private reads stay live.
        if (route.request().method() !== 'PUT') {
          await route.continue()

          return
        }

        const request = route.request()
        const input: unknown = request.postDataJSON()

        inputs.push(input)

        const committed = await route.fetch()

        expect(committed.status()).toBe(200)

        // oxlint-disable-next-line vitest/no-conditional-in-test -- Lose the first response after the service has committed it.
        if (inputs.length === 1) {
          await route.fulfill({
            status: 503,

            json: { error: {
              code: 'SERVICE_UNAVAILABLE',
              message: 'private transport details'
            } }
          })

          return
        }

        await route.fulfill({ response: committed })
      })

      await page.goto(`/titles/${target.item.id}`)
      await waitForHydration(page)

      // oxlint-disable-next-line vitest/no-conditional-in-test -- Child rating editors live inside the Episodes tab.
      if (target.episodes) { await openEpisodes(page) }

      const panel = page.getByRole('region', {
        name: target.panel,
        exact: true
      })

      await panel.getByRole('button', {
        name: target.trigger,
        exact: true
      }).click()

      await expect(panel.getByLabel(target.date, { exact: true })).toHaveValue('2026-10-17')

      await panel.getByRole('button', {
        name: '8 out of 10',
        exact: true
      }).click()

      await expect(panel.getByRole('alert')).toContainText('Retry to check the same change.')
      await expect(panel).not.toContainText('private transport details')

      await expect(panel.getByRole('button', {
        name: '7 out of 10',
        exact: true
      })).toBeDisabled()

      await expect(panel.getByLabel(target.date, { exact: true })).toHaveValue('2026-10-17')

      const afterMidnight = new Date('2026-10-17T21:01:00Z')

      await page.clock.setFixedTime(afterMidnight)

      const retry = panel.getByRole('button', {
        name: 'Retry rating',
        exact: true
      })

      await retry.focus()
      await page.keyboard.press('Enter')
      await expect(panel.getByRole('dialog')).toHaveCount(0)
      expect(inputs).toHaveLength(2)
      expect(inputs[1]).toStrictEqual(inputs[0])

      const historyPath = `/api/catalog/items/${target.item.id}/viewings`
      const result = await context.request.get(historyPath)
      const raw: unknown = await result.json()
      const history = v.parse(catalogViewingsResponseSchema, raw)

      expect(history.items).toHaveLength(1)
      expect(history.items[0]?.[target.dateField]).toBe('2026-10-17')

      await expect(page.getByRole('region', {
        name: 'Your timeline',
        exact: true
      }).getByText(/^(?:Rated|Updated rating)$/u)).toHaveCount(0)
    })
  })
}
