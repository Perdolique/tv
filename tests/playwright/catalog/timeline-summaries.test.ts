import { expect, test } from '../fixtures/global.fixtures.ts'
import { addCookie } from '../helpers.ts'
import { waitForHydration } from './helpers.ts'
import { group, nextViewingId, timelinePath, titlePath } from './timeline.fixtures.ts'

test.use({ timezoneId: 'Europe/Tallinn' })

test('shows count-only history for one and multiple episodes without detail requests', async ({ context, page }) => {
  let episodeRequests = 0
  const detailPath = `${timelinePath}/episodes`

  page.on('request', request => {
    const url = request.url()
    const isDetailRequest = url.includes(detailPath)

    episodeRequests += Number(isDetailRequest)
  })

  await addCookie(context, 'tv_session', 'e2e-session')

  const historyRoute = `**${timelinePath}?*`

  await page.route(historyRoute, async route => {
    await route.fulfill({ json: {
      items: [group, {
        ...group,
        id: '50000000-0000-7000-8000-000000000099',
        viewingId: nextViewingId,
        totalCount: 1,

        seasons: [{
          seasonNumber: 1,

          ranges: [{
            firstEpisodeNumber: 1,
            lastEpisodeNumber: 1
          }]
        }]
      }],

      nextCursor: null
    } })
  })

  await page.goto(titlePath)
  await waitForHydration(page)

  const timeline = page.getByRole('region', { name: 'Your timeline' })

  await expect(timeline.getByText('Watched 1 episode', { exact: true })).toBeVisible()
  await expect(timeline.getByText('Watched 25 episodes', { exact: true })).toBeVisible()
  await expect(timeline.getByRole('button', { name: /(?:View|Hide|Load more) episodes/u })).toHaveCount(0)
  await expect(timeline.getByText(/^S1 E/u)).toHaveCount(0)
  await expect(timeline.getByRole('list')).toHaveCount(1)
  expect(episodeRequests).toBe(0)
})
