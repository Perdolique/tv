import type { Page } from '@playwright/test'
import type { CatalogSeriesWatchesResponse } from '../../../packages/shared/src/catalog-series.ts'
import type { CatalogTimelineItem, CatalogTimelineEpisode } from '../../../packages/shared/src/catalog-timeline.ts'
import { expect } from '../fixtures/global.fixtures.ts'
import { chernobyl } from './details.fixtures.ts'

const viewingId = '40000000-0000-7000-8000-000000000001'
const nextViewingId = '40000000-0000-7000-8000-000000000002'
const firstEpisodeId = '30000000-0000-7000-8000-000000000001'
const titlePath = `/titles/${chernobyl.id}`
const watchedPath = `/api/catalog/items/${chernobyl.id}/episodes/watched`
const timelinePath = `/api/catalog/items/${chernobyl.id}/timeline`

const movieViewports = [{
  name: 'mobile',
  width: 390,
  height: 844
}, {
  name: 'tablet',
  width: 768,
  height: 1024
}, {
  name: 'desktop',
  width: 1440,
  height: 1024
}] as const

const group = {
  id: '50000000-0000-7000-8000-000000000001',
  kind: 'episode_group',
  viewingId,
  occurredAt: '2026-10-06T12:00:00.000000Z',
  localDate: '2026-10-06',
  totalCount: 25,

  seasons: [{
    seasonNumber: 1,

    ranges: [{
      firstEpisodeNumber: 1,
      lastEpisodeNumber: 1
    }, {
      firstEpisodeNumber: 3,
      lastEpisodeNumber: 26
    }]
  }],

  episodesCursor: 'group-snapshot'
} as const satisfies CatalogTimelineItem

const history = [
  {
    id: '50000000-0000-7000-8000-000000000002',
    kind: 'rating_changed',
    occurredAt: '2026-10-06T13:00:00.000000Z',
    target: 'item',
    seasonNumber: null,
    catalogEpisodeId: null,
    episodeNumber: null,
    previousScore: 8,
    score: 9
  },
  group,
  {
    id: '50000000-0000-7000-8000-000000000003',
    kind: 'rewatch_started',
    occurredAt: '2026-10-05T12:00:00.000000Z',
    viewingId
  },
  {
    id: '50000000-0000-7000-8000-000000000004',
    kind: 'available_completed',
    occurredAt: '2026-09-28T12:00:00.000000Z',
    viewingId,
    seasonNumber: null,
    totalCount: 25
  },
  {
    id: '50000000-0000-7000-8000-000000000005',
    kind: 'season_completed',
    occurredAt: '2026-09-28T11:00:00.000000Z',
    viewingId,
    seasonNumber: 2,
    totalCount: 10
  },
  {
    id: '50000000-0000-7000-8000-000000000006',
    kind: 'rating_changed',
    occurredAt: '2026-09-28T10:00:00.000000Z',
    target: 'season',
    seasonNumber: 2,
    catalogEpisodeId: null,
    episodeNumber: null,
    previousScore: null,
    score: 8
  },
  {
    id: '50000000-0000-7000-8000-000000000007',
    kind: 'series_started',
    occurredAt: '2026-09-01T10:00:00.000000Z',
    viewingId
  }
] as const satisfies readonly CatalogTimelineItem[]

const groupEpisodes: CatalogTimelineEpisode[] = Array.from({ length: 25 }, (_value, index) => {
  const sequence = String(index + 100)
  const suffix = sequence.padStart(12, '0')
  const id = `50000000-0000-7000-8000-${suffix}`
  const watchId = `60000000-0000-7000-8000-${suffix}`
  const catalogEpisodeId = `30000000-0000-7000-8000-${suffix}`
  const episodeNumber = index === 0 ? 1 : index + 2
  const sourceTitle = `History episode ${index + 1}`

  return {
    id,
    watchId,
    catalogEpisodeId,
    seasonNumber: 1,
    episodeNumber,
    sourceTitle,
    markedAt: group.occurredAt
  }
})

function seriesResponse(episodeIds: string[] = [], currentId: string | null = null, version = 0): CatalogSeriesWatchesResponse {
  const watches = episodeIds.map(id => {return {
    id,
    catalogEpisodeId: id,
    viewingId: currentId ?? viewingId,
    markedAt: '2026-10-08T12:00:00.000000Z'
  }})

  const currentViewing: CatalogSeriesWatchesResponse['currentViewing'] = currentId === null ? null : {
    id: currentId,
    catalogItemId: chernobyl.id,
    status: 'watching',
    recordedAt: '2026-10-08T12:00:00.000000Z',
    revision: 1
  }

  return {
    watchedEpisodeIds: episodeIds,
    watches,
    currentViewing,
    contextVersion: version
  }
}

async function mockHistory(page: Page): Promise<void> {
  const historyRoute = `**${timelinePath}?*`
  const episodesRoute = `**${timelinePath}/episodes?*`

  await page.route(historyRoute, async (route) => {
    const request = route.request()
    const requestUrl = request.url()
    const url = new URL(requestUrl)

    expect(url.searchParams.get('timeZone')).toBe('Europe/Tallinn')

    const hasCursor = url.searchParams.has('cursor')
    const items = hasCursor ? [] : history
    const nextCursor = hasCursor ? null : 'next-history'

    await route.fulfill({ json: {
      items,
      nextCursor
    } })
  })

  await page.route(episodesRoute, async (route) => {
    const request = route.request()
    const requestUrl = request.url()
    const url = new URL(requestUrl)

    expect(url.searchParams.get('groupCursor')).toBe('group-snapshot')
    expect(url.searchParams.get('viewingId')).toBe(viewingId)

    const isMore = url.searchParams.has('cursor')
    const pageStart = isMore ? 20 : 0
    const pageEnd = isMore ? undefined : 20
    const items = groupEpisodes.slice(pageStart, pageEnd)
    const nextCursor = isMore ? null : 'group-next'

    await route.fulfill({ json: {
      items,
      nextCursor
    } })
  })
}

async function mockRatingTimeline(page: Page): Promise<void> {
  let rows: CatalogTimelineItem[] = []
  const itemRatingPath = `/api/catalog/items/${chernobyl.id}/rating`
  const seasonRatingPath = `/api/catalog/items/${chernobyl.id}/seasons/1/rating`
  const episodeRatingPath = `/api/catalog/episodes/${firstEpisodeId}/rating`

  const targets = new Map<string, 'item' | 'season' | 'episode'>([
    [itemRatingPath, 'item'],
    [seasonRatingPath, 'season'],
    [episodeRatingPath, 'episode']
  ])

  await page.route('**/api/catalog/**/rating', async (route) => {
    const request = route.request()
    const requestUrl = request.url()
    const url = new URL(requestUrl)
    const target = targets.get(url.pathname)
    const method = request.method()

    if (method === 'PUT' && target !== undefined) {
      const seasonNumber = target === 'item' ? null : 1
      const episodeNumber = target === 'episode' ? 1 : null
      const catalogEpisodeId = target === 'episode' ? firstEpisodeId : null

      rows = [{
        id: '50000000-0000-7000-8000-000000000011',
        kind: 'rating_changed',
        occurredAt: '2026-10-08T12:00:00.000000Z',
        target,
        seasonNumber,
        episodeNumber,
        catalogEpisodeId,
        previousScore: null,
        score: 8
      }]
    }

    await route.continue()
  })

  const historyRoute = `**${timelinePath}?*`

  await page.route(historyRoute, async (route) => {
    await route.fulfill({ json: {
    items: rows,
    nextCursor: null
  } })
  })
}

async function mockHistoryWithNextPageFailure(page: Page): Promise<void> {
  let failed = false

  await mockHistory(page)

  const historyRoute = `**${timelinePath}?*`

  await page.route(historyRoute, async (route) => {
    const request = route.request()
    const requestUrl = request.url()
    const url = new URL(requestUrl)
    const hasCursor = url.searchParams.has('cursor')

    if (!hasCursor) {
      await route.fallback()

      return
    }

    expect(url.searchParams.get('cursor')).toBe('next-history')

    if (failed) {
      await route.fulfill({ json: {
        items: [],
        nextCursor: null
      } })
    } else {
      failed = true

      await route.fulfill({
        status: 503,
        json: { error: { message: 'controlled next-page failure' } }
      })
    }
  })
}

function rewatchHistory(closeStatus: 'paused' | 'completed', rewatched: boolean, hasMarks: boolean): CatalogTimelineItem[] {
  if (!rewatched) { return hasMarks ? [group] : [] }

  const kind = closeStatus === 'paused' ? 'series_paused' : 'series_completed'

  return [
    {
      id: '50000000-0000-7000-8000-000000000008',
      kind: 'rewatch_started',
      occurredAt: '2026-10-08T13:00:00.000000Z',
      viewingId: nextViewingId
    },
    {
      id: '50000000-0000-7000-8000-000000000009',
      kind,
      occurredAt: '2026-10-08T13:00:00.000000Z',
      viewingId
    }, group
  ]
}

export { firstEpisodeId, group, history, mockHistory, mockHistoryWithNextPageFailure, mockRatingTimeline, movieViewports, nextViewingId, rewatchHistory, seriesResponse, timelinePath, titlePath, viewingId, watchedPath }
