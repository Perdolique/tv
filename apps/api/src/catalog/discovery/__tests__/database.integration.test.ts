import { randomUUID } from 'node:crypto'
import { afterAll, assert, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  collectionPageSchema,
  discoveryPageSchema,
  discoveryResponseSchema,
  collectionPreviewsSchema
} from '@tv/shared/catalog-discovery'

import { discoveryFixture } from '../fixture.ts'

const fixture = discoveryFixture()
const { client, userId, secondUserId, ids, defaultItemIds, request, read, createCollection } = fixture

interface FixtureViewing {
  id: string;
  catalog_item_id: string;
  user_id: string;
}

function findViewing(rows: FixtureViewing[], id: string | undefined, owner: string): FixtureViewing {
  const row = rows.find(viewing => viewing.catalog_item_id === id && viewing.user_id === owner)

  assert(row !== undefined)

  return row
}

describe('public discovery and managed collections', () => {
  beforeAll(fixture.setup)
  beforeEach(fixture.reset)

  // The suite owns this database client and closes it after the last case.
  afterAll(fixture.cleanup)

  it('reads recent titles publicly, paginates 24 at a time, and keeps updates out of newest-first ordering', async () => {
    const firstResponse = await request('discovery/recent')
    const cacheControl = firstResponse.headers.get('cache-control')

    expect(firstResponse.status).toBe(200)
    expect(cacheControl).toBe('no-store')

    const first = await read(firstResponse, discoveryPageSchema)
    const newestFirst = ids.toReversed()
    const firstIds = first.items.map(item => item.id)
    const expectedFirst = newestFirst.slice(0, 24)

    expect(firstIds).toStrictEqual(expectedFirst)
    expect(first.nextPage).toBe(2)
    await client.query('UPDATE catalog_items SET release_year = 2026 WHERE id = $1', [ids[0]])

    const secondResponse = await request('discovery/recent?page=2')
    const second = await read(secondResponse, discoveryPageSchema)
    const fixtureItems = second.items.slice(0, 6)
    const secondIds = fixtureItems.map(item => item.id)
    const expectedSecond = newestFirst.slice(24)

    expect(secondIds).toStrictEqual(expectedSecond)

    const homeResponse = await request('discovery')
    const home = await read(homeResponse, discoveryResponseSchema)
    const recentIds = home.recent.map(item => item.id)
    const expectedRecent = newestFirst.slice(0, 12)
    const serializedHome = JSON.stringify(home)

    expect(recentIds).toStrictEqual(expectedRecent)
    expect(home.topRated).toStrictEqual([])
    expect(home.collections).toStrictEqual([])
    expect(serializedHome).not.toContain(userId)
    expect(serializedHome).not.toContain('discovery-test@example.com')
  })

  it('ranks whole-title public votes, uses vote count for ties, and ignores season and historical personal scores', async () => {
    const rankedIds = ids.slice(0, 4)

    const views = await client.query<FixtureViewing>(`INSERT INTO catalog_viewings(user_id, catalog_item_id, status, started_on, completed_on)
      SELECT u.id, i.id, 'completed', CASE WHEN i.type = 'series' THEN '2020-01-01'::date ELSE NULL END, '2020-01-02'::date
      FROM users u CROSS JOIN catalog_items i WHERE u.id = ANY($1::uuid[]) AND i.id = ANY($2::uuid[])
      RETURNING id, catalog_item_id, user_id`, [[userId, secondUserId], rankedIds])

    const titleScores = [9, 9, 10]
    const scoredTitles = titleScores.entries()

    for (const [index, score] of scoredTitles) {
      const viewing = findViewing(views.rows, ids[index], userId)

      // oxlint-disable-next-line eslint/no-await-in-loop -- One pg client must complete each write before the next.
      await client.query('INSERT INTO catalog_rating_votes(user_id, catalog_item_id, source_viewing_id, score) VALUES ($1, $2, $3, $4)', [userId, ids[index], viewing.id, score])
    }

    const secondVote = findViewing(views.rows, ids[1], secondUserId)

    await client.query('INSERT INTO catalog_rating_votes(user_id, catalog_item_id, source_viewing_id, score) VALUES ($1, $2, $3, 9)', [secondUserId, ids[1], secondVote.id])

    const historical = findViewing(views.rows, ids[3], userId)

    await client.query('INSERT INTO catalog_item_ratings(user_id, catalog_item_id, viewing_id, score) VALUES ($1, $2, $3, 10)', [userId, ids[3], historical.id])
    await client.query('INSERT INTO catalog_rating_votes(user_id, catalog_item_id, source_viewing_id, season_number, score) VALUES ($1, $2, $3, 1, 10)', [userId, ids[3], historical.id])

    const pageResponse = await request('discovery/top-rated')
    const page = await read(pageResponse, discoveryPageSchema)
    const rankedItemIds = page.items.map(item => item.id)
    const scores = page.items.map(item => [item.averageScore, item.ratingCount])

    expect(rankedItemIds).toStrictEqual([ids[2], ids[1], ids[0]])
    expect(scores).toStrictEqual([[10, 1], [9, 2], [9, 1]])
    await client.query('DELETE FROM catalog_viewings WHERE id = $1', [secondVote.id])

    const tiedResponse = await request('discovery/top-rated')
    const tied = await read(tiedResponse, discoveryPageSchema)
    const equalScoreItems = tied.items.slice(1)
    const tiedIds = equalScoreItems.map(item => item.id)
    const expectedTies = defaultItemIds.toSorted()

    expect(tiedIds).toStrictEqual(expectedTies)
  })

  it('publishes a mixed collection, keeps manual order and includes a later current title in its preview', async () => {
    const collection = await createCollection(ids)
    const collectionPath = `collections/${collection.id}`
    const firstResponse = await request(collectionPath)
    const first = await read(firstResponse, collectionPageSchema)
    const firstIds = first.items.map(item => item.id)
    const expectedFirst = ids.slice(0, 24)

    expect(firstIds).toStrictEqual(expectedFirst)
    expect(first.nextPage).toBe(2)

    const lastPath = `${collectionPath}?page=2`
    const lastResponse = await request(lastPath)
    const last = await read(lastResponse, collectionPageSchema)
    const lastIds = last.items.map(item => item.id)
    const expectedLast = ids.slice(24)

    expect(lastIds).toStrictEqual(expectedLast)
    expect(last.nextPage).toBeNull()

    const relatedPath = `items/${ids[25]}/collections`
    const previewsResponse = await request(relatedPath)
    const previews = await read(previewsResponse, collectionPreviewsSchema)
    const previewIds = previews.collections[0]?.items.map(item => item.id)
    const leadingIds = ids.slice(0, 11)
    const expectedPreview = [...leadingIds, ids[25]]

    expect(previewIds).toStrictEqual(expectedPreview)

    const homeResponse = await request('discovery')
    const home = await read(homeResponse, discoveryResponseSchema)
    const homePreviewIds = home.collections[0]?.items.map(item => item.id)
    const expectedHome = ids.slice(0, 12)

    expect(homePreviewIds).toStrictEqual(expectedHome)

    const managePath = `manage/${collectionPath}`
    const reorderedIds = defaultItemIds.toReversed()

    const body = {
      title: collection.title,
      description: null,
      isFeatured: false,
      revision: 1,
      itemIds: reorderedIds
    }

    const updated = await request(managePath, {
      method: 'PUT',
      body,
      authenticated: true
    })

    expect(updated.status).toBe(200)

    const reorderedResponse = await request(collectionPath)
    const reordered = await read(reorderedResponse, collectionPageSchema)
    const actualOrder = reordered.items.map(item => item.id)

    expect(actualOrder).toStrictEqual(reorderedIds)

    const hiddenResponse = await request('discovery')
    const hidden = await read(hiddenResponse, discoveryResponseSchema)

    expect(hidden.collections).toStrictEqual([])
  })

  it('rejects duplicates, missing members and stale saves, and cascades only memberships on deletion', async () => {
    const collection = await createCollection()
    const managePath = `manage/collections/${collection.id}`
    const collectionPath = `collections/${collection.id}`

    const body = {
      title: collection.title,
      description: 'Changed',
      isFeatured: false,
      revision: collection.revision,
      itemIds: defaultItemIds
    }

    const duplicateInput = {
      ...body,
      itemIds: [ids[0], ids[0]]
    }

    const duplicates = await request(managePath, {
      method: 'PUT',
      body: duplicateInput,
      authenticated: true
    })

    expect(duplicates.status).toBe(400)

    const missingId = randomUUID()

    const missingInput = {
      ...body,
      itemIds: [missingId]
    }

    const missing = await request(managePath, {
      method: 'PUT',
      body: missingInput,
      authenticated: true
    })

    expect(missing.status).toBe(400)

    const reversedIds = defaultItemIds.toReversed()

    const reversedInput = {
      ...body,
      itemIds: reversedIds
    }

    const firstSave = request(managePath, {
      method: 'PUT',
      body,
      authenticated: true
    })

    const secondSave = request(managePath, {
      method: 'PUT',
      body: reversedInput,
      authenticated: true
    })

    const races = await Promise.all([firstSave, secondSave])
    const raceStatuses = races.map(response => response.status)
    const orderedStatuses = raceStatuses.toSorted((left, right) => left - right)

    expect(orderedStatuses).toStrictEqual([200, 409])

    const staleDelete = await request(managePath, {
      method: 'DELETE',
      body: { revision: 1 },
      authenticated: true
    })

    expect(staleDelete.status).toBe(409)

    const deleted = await request(managePath, {
      method: 'DELETE',
      body: { revision: 2 },
      authenticated: true
    })

    expect(deleted.status).toBe(204)

    const absent = await request(collectionPath)

    expect(absent.status).toBe(404)

    const items = await client.query('SELECT id FROM catalog_items WHERE id = ANY($1::uuid[])', [ids])
    const members = await client.query('SELECT * FROM catalog_collection_items WHERE collection_id = $1', [collection.id])

    expect(items.rowCount).toBe(30)
    expect(members.rows).toStrictEqual([])
  })

  it('checks the current permission on every management route and keeps all public reads available', async () => {
    const collection = await createCollection()
    const managePath = `manage/collections/${collection.id}`
    const collectionPath = `collections/${collection.id}`
    const relatedPath = `items/${ids[0]}/collections`

    const payload = {
      title: collection.title,
      description: null,
      isFeatured: false,
      itemIds: [],
      revision: 1
    }

    const routes = [['manage/collections', 'GET'], ['manage/collections', 'POST'], [managePath, 'GET'], [managePath, 'PUT'], [managePath, 'DELETE']] as const

    await client.query('DELETE FROM user_permissions WHERE user_id = $1', [userId])

    const checks = routes.map(async ([path, method]) => {
      const unauthenticated = await request(path, {
        method,
        body: payload
      })

      const denied = await request(path, {
        method,
        body: payload,
        authenticated: true
      })

      expect(unauthenticated.status).toBe(401)
      expect(denied.status).toBe(403)
    })

    await Promise.all(checks)

    const missingId = randomUUID()
    const missingPath = `items/${missingId}/collections`
    const publicReads = [[collectionPath, 200], [relatedPath, 200], ['discovery', 200], ['discovery/no-such-list', 400], ['discovery/recent?page=0', 400], [missingPath, 404]] as const

    const publicChecks = publicReads.map(async ([path, status]) => {
      const response = await request(path)

      expect(response.status).toBe(status)
    })

    await Promise.all(publicChecks)
  })
})
