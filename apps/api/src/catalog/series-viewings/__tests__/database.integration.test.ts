/* oxlint-disable eslint/max-lines -- One disposable series fixture verifies the related lifecycle, mark and retry contracts. */
import { randomUUID } from 'node:crypto'
import { env } from 'node:process'
import { createDatabase } from '@tv/database'
import type { CatalogSeriesWatchInput, CatalogSeriesWatchesResponse } from '@tv/shared/catalog-series'
import { Client } from 'pg'
import { afterAll, afterEach, assert, beforeEach, describe, expect, it } from 'vitest'
import { assertDisposableTestDatabase } from '../../../testing/test-database.ts'
import { setCurrentCatalogRating } from '../../rating-mutations.ts'

import {
  cancelSeriesRewatch,
  findSeriesWatches,
  markSeriesEpisodeWatched,
  markSeriesEpisodesWatched,
  unmarkSeriesEpisodeWatched
} from '../../series-viewings-repository.ts'

import { createViewing, deleteViewing, findViewing, findViewings, updateViewing } from '../../viewings-repository.ts'

const databaseUrl = env.TEST_DATABASE_URL
const client = new Client({ connectionString: databaseUrl })

await client.connect()

const database = createDatabase(client)
const userId = randomUUID()
const catalogItemId = randomUUID()
const episodeIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()] as const

const owner = {
  userId,
  catalogItemId
}

const target = {
  seasonNumber: null,
  catalogEpisodeId: null
}

function initialInput(): CatalogSeriesWatchInput {
  const requestId = randomUUID()

  return {
    requestId,
    currentViewingId: null,
    contextVersion: 0,
    timeZone: 'Pacific/Kiritimati',
    viewingDate: '2000-01-01'
  }
}

function nextInput(response: CatalogSeriesWatchesResponse): CatalogSeriesWatchInput {
  const requestId = randomUUID()

  return {
    requestId,
    currentViewingId: response.viewing?.id ?? null,
    contextVersion: response.summary.contextVersion,
    timeZone: 'Pacific/Kiritimati'
  }
}

async function concurrent<Result>(run: (db: ReturnType<typeof createDatabase>) => Promise<Result>): Promise<Result> {
  const connection = new Client({ connectionString: databaseUrl })

  try {
    await connection.connect()

    const connectionDatabase = createDatabase(connection)

    return await run(connectionDatabase)
  } finally {
    await connection.end()
  }
}

async function events(): Promise<string[]> {
  const result = await client.query<{ kind: string }>('SELECT kind FROM catalog_timeline_events WHERE user_id = $1 ORDER BY occurred_at, id', [userId])

  return result.rows.map(row => row.kind)
}

async function rewatch(response: CatalogSeriesWatchesResponse) {
  const requestId = randomUUID()

  return createViewing(database, owner, {
    requestId,
    mode: 'current',
    currentViewingId: response.viewing?.id ?? null,
    contextVersion: response.summary.contextVersion,
    status: 'watching',
    startedOn: '2000-01-03',
    completedOn: null,
    completeCurrentOn: '2000-01-02'
  })
}

async function expectDatabaseConstraint(query: string, parameters: string[], expected: Record<string, string>): Promise<void> {
  await client.query('SAVEPOINT negative_constraint')

  try {
    await expect(client.query(query, parameters)).rejects.toMatchObject(expected)
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT negative_constraint')
    await client.query('RELEASE SAVEPOINT negative_constraint')
  }
}

describe('series viewing persistence', () => {
  beforeEach(async () => {
    await assertDisposableTestDatabase(client)
    await client.query('INSERT INTO users (id,email) VALUES ($1,$2)', [userId, `${userId}@example.com`])
    await client.query('INSERT INTO catalog_items (id,type) VALUES ($1,\'series\')', [catalogItemId])
    await client.query('INSERT INTO catalog_item_titles (catalog_item_id,locale,title,is_original) VALUES ($1,\'en\',\'Series persistence fixture\',true)', [catalogItemId])

    await client.query(`INSERT INTO catalog_episodes (id,catalog_item_id,season_number,episode_number,air_date) VALUES
      ($2,$1,1,1,'2000-01-01'),($3,$1,1,2,(CURRENT_TIMESTAMP AT TIME ZONE 'Pacific/Kiritimati')::date),
      ($4,$1,1,3,'9999-01-01'),($5,$1,1,4,NULL)`, [catalogItemId, ...episodeIds])
  })

  afterEach(async () => {
    await client.query('DROP TRIGGER IF EXISTS fail_series_request ON catalog_viewing_requests')
    await client.query('DROP FUNCTION IF EXISTS fail_series_request()')
    await client.query('DELETE FROM users WHERE id=$1', [userId])
    await client.query('DELETE FROM catalog_items WHERE id=$1', [catalogItemId])
  })

  afterAll(async () => { await client.end() })

  it('serializes competing first marks, preserves the chosen start date and replays only the same operation', async () => {
    const requests = [initialInput(), initialInput()]

    const pending = requests.map(async input => {
      const operation = concurrent(async db => markSeriesEpisodeWatched(db, userId, episodeIds[0], input))

      return operation
    })

    const results = await Promise.allSettled(pending)
    const winnerIndex = results.findIndex(result => result.status === 'fulfilled')
    const winner = results[winnerIndex]
    const input = requests[winnerIndex]

    assert(winner !== undefined)
    assert(winner.status === 'fulfilled')
    assert(input !== undefined)
    expect(results.filter(result => result.status === 'rejected')).toMatchObject([{ reason: { status: 409 } }])

    expect(winner.value.viewing).toMatchObject({
      startedOn: '2000-01-01',
      status: 'watching',
      revision: 1
    })

    expect(winner.value.summary.contextVersion).toBe(1)
    expect(winner.value.watches).toHaveLength(1)
    await expect(markSeriesEpisodeWatched(database, userId, episodeIds[0], input)).resolves.toStrictEqual(winner.value)
    await expect(markSeriesEpisodeWatched(database, userId, episodeIds[1], input)).rejects.toMatchObject({ status: 409 })
    await expect(events()).resolves.toStrictEqual(['series_started', 'episode_watched'])
  })

  it('marks only released dated episodes and records fixed milestone dependencies removed by unwatch', async () => {
    const input = initialInput()
    let response = await markSeriesEpisodesWatched(database, owner, input, 1)
    const responseEpisodeIds = response.watches.map(watch => watch.catalogEpisodeId)

    expect(responseEpisodeIds).toStrictEqual(episodeIds.slice(0, 2))
    await expect(events()).resolves.toContain('available_completed')
    await expect(markSeriesEpisodeWatched(database, userId, episodeIds[2], nextInput(response))).rejects.toMatchObject({ status: 400 })
    await expect(markSeriesEpisodeWatched(database, userId, episodeIds[3], nextInput(response))).rejects.toMatchObject({ status: 400 })
    await client.query('UPDATE catalog_episodes SET air_date=\'2000-01-01\' WHERE id=ANY($1::uuid[])', [episodeIds.slice(2)])

    response = await markSeriesEpisodesWatched(database, owner, nextInput(response), 1)

    const milestone = await client.query<{ episode_ids: string[]; dependencies: number }>('SELECT episode_ids,(SELECT count(*)::integer FROM catalog_timeline_event_watches WHERE event_id=events.id) AS dependencies FROM catalog_timeline_events events WHERE user_id=$1 AND kind=\'season_completed\'', [userId])

    expect(milestone.rows[0]?.episode_ids).toHaveLength(4)
    expect(milestone.rows[0]?.dependencies).toBe(4)

    const before = await events()

    await client.query('INSERT INTO catalog_episodes (id,catalog_item_id,season_number,episode_number,air_date) VALUES ($1,$2,1,5,\'9999-01-01\')', [randomUUID(), catalogItemId])

    response = await markSeriesEpisodesWatched(database, owner, nextInput(response), 1)

    await expect(events()).resolves.toStrictEqual(before)

    const [watch] = response.watches

    assert(watch !== undefined)
    assert(response.viewing !== null)

    const unwatchRequestId = randomUUID()

    response = await unmarkSeriesEpisodeWatched(database, userId, watch.catalogEpisodeId, {
      requestId: unwatchRequestId,
      currentViewingId: response.viewing.id,
      contextVersion: response.summary.contextVersion,
      watchId: watch.id,
      confirmRatingRemoval: false
    })

    expect(response.watches).toHaveLength(3)
    await expect(events()).resolves.not.toContain('season_completed')
    await expect(events()).resolves.not.toContain('available_completed')
    await expect(markSeriesEpisodesWatched(database, owner, input, 1)).rejects.toMatchObject({ status: 409 })

    const remarked = await markSeriesEpisodeWatched(database, userId, watch.catalogEpisodeId, nextInput(response))
    const replacement = remarked.watches.find(value => value.catalogEpisodeId === watch.catalogEpisodeId)

    expect(replacement?.id).not.toBe(watch.id)
    assert(remarked.viewing !== null)

    const staleUnwatchRequestId = randomUUID()

    await expect(unmarkSeriesEpisodeWatched(database, userId, watch.catalogEpisodeId, {
      requestId: staleUnwatchRequestId,
      currentViewingId: remarked.viewing.id,
      contextVersion: remarked.summary.contextVersion,
      watchId: watch.id,
      confirmRatingRemoval: false
    })).resolves.toStrictEqual(remarked)
  })

  it('does not invent a milestone on a no-op after the catalog shrinks', async () => {
    const first = await markSeriesEpisodesWatched(database, owner, initialInput(), 1)

    await client.query('DELETE FROM catalog_episodes WHERE id=ANY($1::uuid[])', [episodeIds.slice(2)])

    const before = await events()
    const repeated = await markSeriesEpisodesWatched(database, owner, nextInput(first), 1)

    expect(repeated.watches).toStrictEqual(first.watches)
    await expect(events()).resolves.toStrictEqual(before)
  })

  it('records a milestone only when new marks belong to its fixed episode basis', async () => {
    const first = await markSeriesEpisodesWatched(database, owner, initialInput(), 1)

    await client.query('DELETE FROM catalog_episodes WHERE id=ANY($1::uuid[])', [episodeIds.slice(2)])

    const nextSeasonId = randomUUID()
    const nextFutureId = randomUUID()

    await client.query('INSERT INTO catalog_episodes (id,catalog_item_id,season_number,episode_number,air_date) VALUES ($1,$3,2,1,\'2000-01-01\'),($2,$3,3,1,\'9999-01-01\')', [nextSeasonId, nextFutureId, catalogItemId])
    await markSeriesEpisodeWatched(database, userId, nextSeasonId, nextInput(first))

    const seasons = await client.query<{ season_number: number }>('SELECT season_number FROM catalog_timeline_events WHERE user_id=$1 AND kind=\'season_completed\' ORDER BY season_number', [userId])
    const available = await client.query<{ episode_ids: string[] }>('SELECT episode_ids FROM catalog_timeline_events WHERE user_id=$1 AND kind=\'available_completed\' ORDER BY occurred_at,id', [userId])

    expect(seasons.rows).toStrictEqual([{ season_number: 2 }])
    expect(available.rows).toHaveLength(2)
    expect(available.rows[1]?.episode_ids).toHaveLength(3)
  })

  it('completes partial progress and reopens the same viewing with one live completion event', async () => {
    const first = await markSeriesEpisodeWatched(database, userId, episodeIds[0], initialInput())
    const { viewing } = first

    assert(viewing !== null)

    const completionRequestId = randomUUID()

    let updated = await updateViewing(database, {
      ...owner,
      viewingId: viewing.id
    }, {
      requestId: completionRequestId,
      revision: viewing.revision,
      status: 'completed',
      startedOn: viewing.startedOn,
      completedOn: '2000-01-02'
    })

    expect(updated.viewing.status).toBe('completed')

    const partial = await findSeriesWatches(database, owner)

    expect(partial.watches).toHaveLength(1)
    await expect(events()).resolves.toContain('series_completed')

    const reopeningRequestId = randomUUID()

    updated = await updateViewing(database, {
      ...owner,
      viewingId: viewing.id
    }, {
      requestId: reopeningRequestId,
      revision: updated.viewing.revision,
      status: 'watching',
      startedOn: viewing.startedOn,
      completedOn: null
    })

    await expect(events()).resolves.not.toContain('series_completed')

    const secondCompletionRequestId = randomUUID()

    updated = await updateViewing(database, {
      ...owner,
      viewingId: viewing.id
    }, {
      requestId: secondCompletionRequestId,
      revision: updated.viewing.revision,
      status: 'completed',
      startedOn: viewing.startedOn,
      completedOn: '2000-01-03'
    })

    const currentEvents = await events()
    const completions = currentEvents.filter(kind => kind === 'series_completed')

    expect(completions).toHaveLength(1)
    expect(updated.summary.currentViewingId).toBe(viewing.id)
  })

  it('starts and cancels a combined rewatch atomically, preserving marks and rejecting the deleted creation retry', async () => {
    const first = await markSeriesEpisodeWatched(database, userId, episodeIds[0], initialInput())
    const previous = first.viewing

    assert(previous !== null)

    const input = {
      requestId: randomUUID(),
      mode: 'current',
      currentViewingId: previous.id,
      contextVersion: first.summary.contextVersion,
      status: 'watching',
      startedOn: '2000-01-03',
      completedOn: null,
      completeCurrentOn: '2000-01-02'
    } as const

    const next = await createViewing(database, owner, input)

    expect(next.viewing).toMatchObject({
      score: null,
      isRewatch: true,
      canCancelRewatch: true
    })

    await expect(findViewing(database, owner, previous.id)).resolves.toMatchObject({
      status: 'completed',
      completedOn: '2000-01-02'
    })

    const repeatedRewatchRequestId = randomUUID()

    await expect(createViewing(database, owner, {
      ...input,
      requestId: repeatedRewatchRequestId,
      currentViewingId: next.viewing.id,
      contextVersion: next.summary.contextVersion,
      completeCurrentOn: '2000-01-04',
      startedOn: '2000-01-05'
    })).rejects.toMatchObject({ status: 409 })

    const cancellationRequestId = randomUUID()

    const cancelInput = {
      requestId: cancellationRequestId,
      currentViewingId: next.viewing.id,
      contextVersion: next.summary.contextVersion
    }

    const restored = await cancelSeriesRewatch(database, owner, cancelInput)

    expect(restored.currentViewingId).toBe(previous.id)

    await expect(findViewing(database, owner, previous.id)).resolves.toMatchObject({
      status: 'watching',
      completedOn: null
    })

    const restoredWatches = await findSeriesWatches(database, owner)

    expect(restoredWatches.watches).toStrictEqual(first.watches)
    await expect(events()).resolves.toStrictEqual(['series_started', 'episode_watched'])
    await expect(cancelSeriesRewatch(database, owner, cancelInput)).resolves.toStrictEqual(restored)
    await expect(createViewing(database, owner, input)).rejects.toMatchObject({ status: 409 })
  })

  it('does not offer cancellation after the predecessor is deleted and preserves the remaining viewing', async () => {
    const first = await markSeriesEpisodeWatched(database, userId, episodeIds[0], initialInput())
    const previous = first.viewing

    assert(previous !== null)

    const next = await rewatch(first)
    const predecessor = await findViewing(database, owner, previous.id)

    await deleteViewing(database, {
      ...owner,
      viewingId: predecessor.id
    }, {
      requestId: randomUUID(),
      revision: predecessor.revision
    })

    const current = await findViewing(database, owner, next.viewing.id)
    const page = await findViewings(database, owner, null)
    const watches = await findSeriesWatches(database, owner)

    expect(current).toMatchObject({
      id: next.viewing.id,
      status: 'watching',
      canCancelRewatch: false
    })

    expect(page.items).toStrictEqual([current])
    expect(page.summary.currentViewingId).toBe(current.id)
    expect(watches.viewing).toStrictEqual(current)
    expect(watches.watches).toStrictEqual([])
    await expect(findViewing(database, owner, predecessor.id)).rejects.toMatchObject({ status: 404 })
  })

  it('treats ratings as activity and forbids cancellation after a score or mark', async () => {
    const ratingRequestId = randomUUID()

    const rated = await setCurrentCatalogRating(database, owner, target, {
      requestId: ratingRequestId,
      currentViewingId: null,
      contextVersion: 0,
      timeZone: 'UTC',
      viewingDate: '2000-01-01',
      score: 8
    })

    assert(rated.viewing !== null)

    const rewatchRequestId = randomUUID()

    const next = await createViewing(database, owner, {
      requestId: rewatchRequestId,
      mode: 'current',
      currentViewingId: rated.viewing.id,
      contextVersion: rated.summary.contextVersion,
      status: 'watching',
      startedOn: '2000-01-03',
      completedOn: null,
      completeCurrentOn: '2000-01-02'
    })

    const currentRatingRequestId = randomUUID()

    const current = await setCurrentCatalogRating(database, owner, target, {
      requestId: currentRatingRequestId,
      currentViewingId: next.viewing.id,
      contextVersion: next.summary.contextVersion,
      timeZone: 'UTC',
      score: 9
    })

    expect(current.viewing?.canCancelRewatch).toBe(false)

    const cancellationRequestId = randomUUID()

    await expect(cancelSeriesRewatch(database, owner, {
      requestId: cancellationRequestId,
      currentViewingId: next.viewing.id,
      contextVersion: current.summary.contextVersion
    })).rejects.toMatchObject({ status: 409 })
  })

  it('starts a rewatch after completing an initial viewing whose only rating was removed', async () => {
    // Arrange
    const ratingRequestId = randomUUID()

    const rated = await setCurrentCatalogRating(database, owner, target, {
      requestId: ratingRequestId,
      currentViewingId: null,
      contextVersion: 0,
      timeZone: 'UTC',
      viewingDate: '2000-01-01',
      score: 8
    })

    assert(rated.viewing !== null)

    const removalRequestId = randomUUID()

    const cleared = await setCurrentCatalogRating(database, owner, target, {
      requestId: removalRequestId,
      currentViewingId: rated.viewing.id,
      contextVersion: rated.summary.contextVersion,
      timeZone: 'UTC',
      score: null
    })

    assert(cleared.viewing !== null)

    const completionRequestId = randomUUID()

    const completed = await updateViewing(database, {
      ...owner,
      viewingId: cleared.viewing.id
    }, {
      requestId: completionRequestId,
      revision: cleared.viewing.revision,
      status: 'completed',
      startedOn: cleared.viewing.startedOn,
      completedOn: '2000-01-02'
    })

    const rewatchRequestId = randomUUID()

    // Act
    const next = await createViewing(database, owner, {
      requestId: rewatchRequestId,
      mode: 'current',
      currentViewingId: completed.viewing.id,
      contextVersion: completed.summary.contextVersion,
      status: 'watching',
      startedOn: '2000-01-03',
      completedOn: null
    })

    // Assert
    expect(next.viewing).toMatchObject({
      status: 'watching',
      startedOn: '2000-01-03',
      score: null,
      isRewatch: true,
      canCancelRewatch: true
    })

    expect(next.viewing.id).not.toBe(completed.viewing.id)

    expect(next.summary).toMatchObject({
      currentViewingId: next.viewing.id,
      completedCount: 1,
      currentViewingScore: null,
      currentVoteScore: null
    })

    await expect(findViewing(database, owner, completed.viewing.id)).resolves.toStrictEqual(completed.viewing)

    const watches = await findSeriesWatches(database, owner)

    expect(watches.watches).toStrictEqual([])
    await expect(events()).resolves.toStrictEqual(['series_started', 'series_completed', 'rewatch_started'])
  })

  it('rejects obsolete rollback after a historical completion date correction', async () => {
    const first = await markSeriesEpisodeWatched(database, userId, episodeIds[0], initialInput())
    const previous = first.viewing

    assert(previous !== null)

    const next = await rewatch(first)
    const closed = await findViewing(database, owner, previous.id)
    const correctionRequestId = randomUUID()

    const corrected = await updateViewing(database, {
      ...owner,
      viewingId: previous.id
    }, {
      requestId: correctionRequestId,
      revision: closed.revision,
      status: 'completed',
      startedOn: closed.startedOn,
      completedOn: '2000-01-04'
    })

    const cancellationRequestId = randomUUID()

    await expect(cancelSeriesRewatch(database, owner, {
      requestId: cancellationRequestId,
      currentViewingId: next.viewing.id,
      contextVersion: corrected.summary.contextVersion
    })).rejects.toMatchObject({ status: 409 })

    await expect(findViewing(database, owner, previous.id)).resolves.toMatchObject({
      completedOn: '2000-01-04',
      status: 'completed'
    })

    const unchanged = await findSeriesWatches(database, owner)

    expect(unchanged.viewing?.id).toBe(next.viewing.id)
  })

  it('rejects a historical active viewing and reopening while another viewing is active', async () => {
    const activeHistoryRequestId = randomUUID()

    await expect(createViewing(database, owner, {
      requestId: activeHistoryRequestId,
      mode: 'history',
      currentViewingId: null,
      contextVersion: 0,
      status: 'watching',
      startedOn: '2000-01-01',
      completedOn: null
    })).rejects.toMatchObject({ status: 400 })

    const first = await markSeriesEpisodeWatched(database, userId, episodeIds[0], initialInput())
    const previous = first.viewing

    assert(previous !== null)

    const historicalRequestId = randomUUID()

    await expect(createViewing(database, owner, {
      requestId: historicalRequestId,
      mode: 'history',
      currentViewingId: previous.id,
      contextVersion: first.summary.contextVersion,
      status: 'watching',
      startedOn: '2000-01-01',
      completedOn: null
    })).rejects.toMatchObject({ status: 400 })

    await rewatch(first)

    const closed = await findViewing(database, owner, previous.id)
    const reopeningRequestId = randomUUID()

    await expect(updateViewing(database, {
      ...owner,
      viewingId: previous.id
    }, {
      requestId: reopeningRequestId,
      revision: closed.revision,
      status: 'watching',
      startedOn: closed.startedOn,
      completedOn: null
    })).rejects.toMatchObject({ status: 409 })
  })

  it('requires confirmation before rated unwatch and atomically removes its score and source vote', async () => {
    const episodeTarget = {
      seasonNumber: null,
      catalogEpisodeId: episodeIds[0]
    }

    const ratingRequestId = randomUUID()

    const rated = await setCurrentCatalogRating(database, owner, episodeTarget, {
      requestId: ratingRequestId,
      currentViewingId: null,
      contextVersion: 0,
      timeZone: 'UTC',
      viewingDate: '2000-01-01',
      score: 8
    })

    const watch = rated.watches?.[0]

    assert(rated.viewing !== null)
    assert(watch !== undefined)

    const unwatchRequestId = randomUUID()

    const input = {
      requestId: unwatchRequestId,
      currentViewingId: rated.viewing.id,
      contextVersion: rated.summary.contextVersion,
      watchId: watch.id,
      confirmRatingRemoval: false
    }

    await expect(unmarkSeriesEpisodeWatched(database, userId, episodeIds[0], input)).rejects.toMatchObject({ status: 409 })

    const unchanged = await findSeriesWatches(database, owner)

    expect(unchanged.watches).toHaveLength(1)

    const removed = await unmarkSeriesEpisodeWatched(database, userId, episodeIds[0], {
      ...input,
      confirmRatingRemoval: true
    })

    const rows = await client.query<{ ratings: number; votes: number }>('SELECT (SELECT count(*)::integer FROM catalog_item_ratings WHERE user_id=$1) AS ratings,(SELECT count(*)::integer FROM catalog_rating_votes WHERE user_id=$1) AS votes', [userId])

    expect(removed.watches).toHaveLength(0)

    expect(rows.rows[0]).toStrictEqual({
      ratings: 0,
      votes: 0
    })
  })

  it('rolls back creation, marks and events if request persistence fails and avoids empty bulk creation', async () => {
    await expect(markSeriesEpisodesWatched(database, owner, initialInput(), 999)).rejects.toMatchObject({ status: 400 })
    await client.query('CREATE FUNCTION fail_series_request() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION \'forced request persistence error\'; END $$ LANGUAGE plpgsql')
    await client.query('CREATE TRIGGER fail_series_request BEFORE INSERT ON catalog_viewing_requests FOR EACH ROW EXECUTE FUNCTION fail_series_request()')
    await expect(markSeriesEpisodeWatched(database, userId, episodeIds[0], initialInput())).rejects.toMatchObject({ cause: { message: 'forced request persistence error' } })

    const rolledBack = await findSeriesWatches(database, owner)

    expect(rolledBack.viewing).toBeNull()
    await expect(events()).resolves.toStrictEqual([])

    const keys = await client.query('SELECT request_id FROM catalog_viewing_requests WHERE user_id=$1', [userId])

    expect(keys.rows).toHaveLength(0)
  })

  it('records action time after waiting for the shared title lock', async () => {
    const holder = new Client({ connectionString: databaseUrl })
    const applicationName = `series_lock_${randomUUID()}`

    const contender = new Client({
      connectionString: databaseUrl,
      application_name: applicationName
    })

    await holder.connect()
    await contender.connect()

    try {
      await holder.query('BEGIN')
      await holder.query('SELECT id FROM catalog_items WHERE id=$1 FOR NO KEY UPDATE', [catalogItemId])

      const pending = markSeriesEpisodeWatched(createDatabase(contender), userId, episodeIds[0], initialInput())

      await expect.poll(async () => {
        const activity = await client.query<{ waiting: boolean }>('SELECT wait_event_type=\'Lock\' AS waiting FROM pg_stat_activity WHERE application_name=$1', [applicationName])

        return activity.rows[0]?.waiting
      }).toBe(true)

      const released = await holder.query<{ released_at: Date }>('SELECT clock_timestamp() AS released_at')

      await holder.query('COMMIT')

      const response = await pending
      const markedAt = response.watches[0]?.markedAt

      assert(markedAt !== undefined)

      const [releasedAt] = released.rows

      assert(releasedAt !== undefined)

      const markedMilliseconds = new Date(markedAt).getTime()
      const releasedMilliseconds = releasedAt.released_at.getTime()

      expect(markedMilliseconds).toBeGreaterThanOrEqual(releasedMilliseconds)

      const times = await client.query<{ equal: boolean }>('SELECT occurred_at=marked_at AS equal FROM catalog_timeline_events events JOIN catalog_viewing_episode_watches watches ON watches.id=events.watch_id WHERE events.user_id=$1 AND kind=\'episode_watched\'', [userId])

      expect(times.rows[0]?.equal).toBe(true)
    } finally {
      await holder.query('ROLLBACK')
      await holder.end()
      await contender.end()
    }
  })

  it('enforces mark ownership, matching episode parents and one active viewing in PostgreSQL', async () => {
    const first = await markSeriesEpisodeWatched(database, userId, episodeIds[0], initialInput())
    const viewingId = first.viewing?.id

    assert(viewingId !== undefined)

    const otherUserId = randomUUID()
    const otherSeriesId = randomUUID()
    const otherEpisodeId = randomUUID()

    await client.query('BEGIN')

    try {
      await client.query('INSERT INTO users (id,email) VALUES ($1,$2)', [otherUserId, `${otherUserId}@example.com`])
      await client.query('INSERT INTO catalog_items (id,type) VALUES ($1,\'series\')', [otherSeriesId])
      await client.query('INSERT INTO catalog_episodes (id,catalog_item_id,season_number,episode_number) VALUES ($1,$2,1,1)', [otherEpisodeId, otherSeriesId])

      await expectDatabaseConstraint('INSERT INTO catalog_viewings (user_id,catalog_item_id,status,started_on) VALUES ($1,$2,\'watching\',\'2000-01-01\')', [userId, catalogItemId], {
        code: '23505',
        constraint: 'catalog_viewings_one_watching_unique'
      })

      await expectDatabaseConstraint('INSERT INTO catalog_viewing_episode_watches (user_id,catalog_item_id,viewing_id,catalog_episode_id) VALUES ($1,$2,$3,$4)', [otherUserId, catalogItemId, viewingId, episodeIds[1]], {
        code: '23503',
        constraint: 'catalog_viewing_episode_watches_viewing_fk'
      })

      await expectDatabaseConstraint('INSERT INTO catalog_viewing_episode_watches (user_id,catalog_item_id,viewing_id,catalog_episode_id) VALUES ($1,$2,$3,$4)', [userId, catalogItemId, viewingId, otherEpisodeId], {
        code: '23503',
        constraint: 'catalog_viewing_episode_watches_episode_fk'
      })

      await expectDatabaseConstraint('INSERT INTO catalog_viewings (user_id,catalog_item_id,status,started_on) VALUES ($1,$2,\'unknown\',\'2000-01-01\')', [userId, catalogItemId], {
        code: '23514',
        constraint: 'catalog_viewings_status'
      })
    } finally {
      await client.query('ROLLBACK')
    }
  })

})
