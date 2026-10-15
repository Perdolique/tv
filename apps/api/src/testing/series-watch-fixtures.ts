import type { Client } from 'pg'

interface SeriesWatchFixture {
  episodeIds: string[];
  markedAt?: string;
  status?: 'watching' | 'paused' | 'completed';
}

interface SeriesWatchFixtureRow {
  id: string;
  catalog_episode_id: string;
  viewing_id: string;
}

// Build storage fixtures independently of the mutation code whose persistence tests use them.
async function insertSeriesEpisodeWatches(
  client: Client,
  userId: string,
  fixture: SeriesWatchFixture
): Promise<SeriesWatchFixtureRow[]> {
  const episodes = await client.query<{ id: string; catalog_item_id: string }>(`
    SELECT id, catalog_item_id FROM catalog_episodes WHERE id = ANY($1::uuid[])
    ORDER BY catalog_item_id, id
  `, [fixture.episodeIds])

  const episodeItemIds = episodes.rows.map(episode => episode.catalog_item_id)
  const uniqueItemIds = new Set(episodeItemIds)
  const itemIds = [...uniqueItemIds]
  const watches: SeriesWatchFixtureRow[] = []
  const status = fixture.status ?? 'watching'

  /* oxlint-disable eslint/no-await-in-loop -- Create a viewing and its dependent rows for each independent series fixture. */
  for (const catalogItemId of itemIds) {
    const current = status === 'watching'
      ? await client.query<{ current_viewing_id: string }>(`
          SELECT current_viewing_id FROM catalog_viewing_contexts
          WHERE user_id = $1 AND catalog_item_id = $2
        `, [userId, catalogItemId])
      : null

    let viewingId = current?.rows[0]?.current_viewing_id

    if (viewingId === undefined) {
      const created = await client.query<{ id: string }>(`
        INSERT INTO catalog_viewings (user_id, catalog_item_id, status, recorded_at)
        VALUES ($1, $2, $3, coalesce($4::timestamptz, now())) RETURNING id
      `, [userId, catalogItemId, status, fixture.markedAt ?? null])

      viewingId = created.rows[0]?.id

      if (viewingId === undefined) {
        throw new Error('The series viewing fixture was not created')
      }

      if (status === 'watching') {
        await client.query(`
          INSERT INTO catalog_viewing_contexts (user_id, catalog_item_id, current_viewing_id, context_version)
          VALUES ($1, $2, $3, 1)
        `, [userId, catalogItemId, viewingId])
      }
    }

    const selectedEpisodes = episodes.rows.filter(episode => episode.catalog_item_id === catalogItemId)
    const selectedEpisodeIds = selectedEpisodes.map(episode => episode.id)

    const createdWatches = await client.query<SeriesWatchFixtureRow>(`
      INSERT INTO catalog_viewing_episode_watches (user_id, catalog_item_id, viewing_id, catalog_episode_id, marked_at)
      SELECT $1, $2, $3, unnest($4::uuid[]), coalesce($5::timestamptz, now())
      RETURNING id, catalog_episode_id, viewing_id
    `, [userId, catalogItemId, viewingId, selectedEpisodeIds, fixture.markedAt ?? null])

    const watchIds = createdWatches.rows.map(watch => watch.id)

    await client.query(`
      INSERT INTO catalog_timeline_events (user_id, catalog_item_id, kind, occurred_at, viewing_id, watch_id, catalog_episode_id)
      SELECT user_id, catalog_item_id, 'episode_watched', marked_at, viewing_id, id, catalog_episode_id
      FROM catalog_viewing_episode_watches WHERE id = ANY($1::uuid[])
    `, [watchIds])

    watches.push(...createdWatches.rows)
  }
  /* oxlint-enable eslint/no-await-in-loop */

  return watches
}

export { insertSeriesEpisodeWatches }
