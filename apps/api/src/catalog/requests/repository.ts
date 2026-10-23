/* oxlint-disable eslint/max-params -- Repository lookups name database, owner, and source identity explicitly. */
import type { Database } from '@tv/database'
import { catalogTitleRequests, catalogTitleRequesters } from '@tv/database/schema'
import type { RequestCard, TitleRequest } from '@tv/shared/catalog-requests'
import { and, eq, sql } from 'drizzle-orm'

const sourceJoin = sql`l.provider = 'tmdb' AND l.entity_type = CASE WHEN r.type = 'movie' THEN 'movie' ELSE 'tv' END AND l.external_id = r.tmdb_id::text`

async function listTitleRequests(database: Database, userId: string | null, page: number, requestId?: string) {
  const owner = userId === null ? sql`true` : sql`m.user_id = ${userId}`
  const pending = userId === null ? sql`l.catalog_item_id IS NULL` : sql`true`
  const selected = requestId === undefined ? sql`true` : sql`r.id = ${requestId}::uuid`
  const order = userId === null ? sql`min(m.created_at) ASC, r.id ASC` : sql`min(m.created_at) DESC, r.id DESC`
  const offset = (page - 1) * 24

  const result = await database.execute<TitleRequest>(sql`
    SELECT r.id, r.card, to_char(min(m.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt", l.catalog_item_id AS "catalogItemId",
      CASE WHEN l.catalog_item_id IS NULL THEN 'pending' ELSE 'available' END AS status,
      count(*)::int AS "requesterCount"
    FROM catalog_title_requests r JOIN catalog_title_requesters m ON m.request_id = r.id
    LEFT JOIN catalog_external_links l ON ${sourceJoin}
    WHERE ${owner} AND ${pending} AND ${selected}
    GROUP BY r.id, l.catalog_item_id ORDER BY ${order}
    LIMIT 25 OFFSET ${offset}
  `)

  const items = result.rows.slice(0, 24)
  const nextPage = result.rows.length > 24 ? page + 1 : null

  return {
    items,
    nextPage
  }
}

async function findRequestedCatalogItem(database: Database, type: 'movie' | 'series', tmdbId: number): Promise<string | null> {
  const entity = type === 'movie' ? 'movie' : 'tv'
  const externalId = String(tmdbId)

  const result = await database.execute<{ id: string }>(sql`
    SELECT catalog_item_id AS id FROM catalog_external_links
    WHERE provider = 'tmdb' AND entity_type = ${entity} AND external_id = ${externalId}
  `)

  return result.rows[0]?.id ?? null
}

async function findOwnTitleRequest(database: Database, userId: string, type: 'movie' | 'series', tmdbId: number) {
  const result = await database.select({ id: catalogTitleRequests.id }).from(catalogTitleRequests)
    .innerJoin(catalogTitleRequesters, eq(catalogTitleRequesters.requestId, catalogTitleRequests.id))
    .where(
      and(
        eq(catalogTitleRequests.type, type),
        eq(catalogTitleRequests.tmdbId, tmdbId),
        eq(catalogTitleRequesters.userId, userId)
      )
    )

  const [found] = result

  if (found === undefined) { return null }

  const page = await listTitleRequests(database, userId, 1, found.id)

  return page.items[0] ?? null
}

async function saveTitleRequest(database: Database, userId: string, card: RequestCard) {
  await database.transaction(async transaction => {
    await transaction.insert(catalogTitleRequests).values({
      type: card.type,
      tmdbId: card.tmdbId,
      card
    }).onConflictDoNothing()

    const rows = await transaction.select({ id: catalogTitleRequests.id }).from(catalogTitleRequests)
      .where(
        and(
          eq(catalogTitleRequests.type, card.type),
          eq(catalogTitleRequests.tmdbId, card.tmdbId)
        )
      )

    const [row] = rows

    if (row === undefined) { throw new Error('Saved title request was not found') }

    await transaction.insert(catalogTitleRequesters).values({
      requestId: row.id,
      userId
    }).onConflictDoNothing()
  })

  const request = await findOwnTitleRequest(database, userId, card.type, card.tmdbId)

  if (request === null) { throw new Error('Saved title request membership was not found') }

  return request
}
export { listTitleRequests, findRequestedCatalogItem, findOwnTitleRequest, saveTitleRequest }
