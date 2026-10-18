import type { Page } from '@playwright/test'
import type { CatalogSeriesWatchesResponse } from '../../../packages/shared/src/catalog-series.ts'
import type { CatalogTimelineItem } from '../../../packages/shared/src/catalog-timeline.ts'
import { expect } from '../fixtures/global.fixtures.ts'
import { chernobyl } from './details.fixtures.ts'

const firstViewingId = '40000000-0000-7000-8000-000000000003'
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
  id: `episode_group:${viewingId}:2026-10-06`,
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
  }]
} as const satisfies CatalogTimelineItem

const history = [
  {
    id: '50000000-0000-7000-8000-000000000002',
    kind: 'series_completed',
    viewingId,
    completedOn: '2026-10-06',
    occurredAt: '2026-10-06T13:00:00.000000Z'
  },
  group,
  {
    id: '50000000-0000-7000-8000-000000000003',
    kind: 'rewatch_started',
    startedOn: '2026-10-05',
    score: 9,
    occurredAt: '2026-10-05T12:00:00.000000Z',
    viewingId
  },
  {
    id: '50000000-0000-7000-8000-000000000004',
    kind: 'available_completed',
    occurredAt: '2026-09-28T12:00:00.000000Z',
    viewingId: firstViewingId,
    seasonNumber: null,
    totalCount: 25
  },
  {
    id: '50000000-0000-7000-8000-000000000005',
    kind: 'season_completed',
    occurredAt: '2026-09-28T11:00:00.000000Z',
    viewingId: firstViewingId,
    seasonNumber: 2,
    totalCount: 10
  },
  {
    id: '50000000-0000-7000-8000-000000000006',
    kind: 'series_completed',
    viewingId: firstViewingId,
    completedOn: '2026-09-28',
    occurredAt: '2026-09-28T10:00:00.000000Z'
  },
  {
    id: '50000000-0000-7000-8000-000000000007',
    kind: 'series_started',
    startedOn: '2026-09-01',
    score: 8,
    occurredAt: '2026-09-01T10:00:00.000000Z',
    viewingId: firstViewingId
  }
] as const satisfies readonly CatalogTimelineItem[]

function seriesResponse(episodeIds: string[] = [], currentId: string | null = null, version = 0): CatalogSeriesWatchesResponse {
  const watches = episodeIds.map(id => {return {
    id,
    catalogEpisodeId: id,
    viewingId: currentId ?? viewingId,
    markedAt: '2026-10-08T12:00:00.000000Z'
  }})

  const viewing: CatalogSeriesWatchesResponse['viewing'] = currentId === null ? null : {
    id: currentId,
    catalogItemId: chernobyl.id,
    status: 'watching',
    isRewatch: currentId === nextViewingId,
    recordedAt: '2026-10-08T12:00:00.000000Z',
    revision: 1,
    startedOn: '2026-10-08',
    completedOn: null,
    score: null,
    canCancelRewatch: currentId === nextViewingId && episodeIds.length === 0
  }

  return {
    watches,
    viewing,

    summary: {
      currentViewingId: currentId,
      contextVersion: version,
      completedCount: 0,
      currentViewingScore: null,
      currentVoteScore: null
    }
  }
}

async function mockHistory(page: Page, currentStatus: 'watching' | 'completed' = 'completed'): Promise<void> {
  const historyRoute = `**${timelinePath}?*`
  const currentHistory = currentStatus === 'completed' ? history : history.filter(item => item.kind !== 'series_completed' || item.viewingId !== viewingId)

  await page.route(historyRoute, async (route) => {
    const request = route.request()
    const requestUrl = request.url()
    const url = new URL(requestUrl)

    expect(url.searchParams.get('timeZone')).toBe('Europe/Tallinn')

    const hasCursor = url.searchParams.has('cursor')
    const items = hasCursor ? [] : currentHistory
    const nextCursor = hasCursor ? null : 'next-history'

    await route.fulfill({ json: {
      items,
      nextCursor
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


export { firstEpisodeId, group, history, mockHistory, mockHistoryWithNextPageFailure, movieViewports, nextViewingId, seriesResponse, timelinePath, titlePath, viewingId, watchedPath }
