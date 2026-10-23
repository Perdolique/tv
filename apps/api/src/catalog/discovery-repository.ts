import type { Database } from '@tv/database'

import {
  catalogCollections,
  catalogCollectionItems,
  catalogItems,
  catalogItemTitles,
  catalogRatingVotes
} from '@tv/database/schema'

import {
  DISCOVERY_PAGE_SIZE,
  DISCOVERY_PREVIEW_SIZE,
  type CatalogCollectionPreview,
  type CatalogDiscoveryItem,
  type CatalogDiscoveryKind,
  type CatalogDiscoveryPage
} from '@tv/shared/catalog-discovery'

import { and, avg, count, desc, eq, exists, inArray, isNull, sql } from 'drizzle-orm'
import { createLocalizedCatalogItems } from './search.ts'

type CatalogReader = Pick<Database, 'select'>

function titleVotes(database: CatalogReader) {
  return database.select({
    catalogItemId: catalogRatingVotes.catalogItemId,
    averageScore: avg(catalogRatingVotes.score).as('average_score'),
    ratingCount: count().as('rating_count')
  }).from(catalogRatingVotes)
    .where(
      and(isNull(catalogRatingVotes.seasonNumber), isNull(catalogRatingVotes.catalogEpisodeId))
    )
    .groupBy(catalogRatingVotes.catalogItemId)
    .as('title_votes')
}

async function findDiscoveryCards(database: CatalogReader, ids: string[], locale: string): Promise<CatalogDiscoveryItem[]> {
  if (ids.length === 0) { return [] }

  const votes = titleVotes(database)

  const rows = await database.select({
    catalogItemId: catalogItems.id,
    type: catalogItems.type,
    releaseYear: catalogItems.releaseYear,
    posterPath: catalogItems.posterPath,
    title: catalogItemTitles.title,
    locale: catalogItemTitles.locale,
    isOriginal: catalogItemTitles.isOriginal,
    averageScore: votes.averageScore,
    ratingCount: votes.ratingCount
  }).from(catalogItems)
    .innerJoin(catalogItemTitles, eq(catalogItemTitles.catalogItemId, catalogItems.id))
    .leftJoin(votes, eq(votes.catalogItemId, catalogItems.id))
    .where(
      inArray(catalogItems.id, ids)
    )

  const localized = createLocalizedCatalogItems(rows, locale)
  const metadataEntries = rows.map(row => [row.catalogItemId, row] as const)
  const metadata = new Map(metadataEntries)

  const cardEntries = localized.map((item): [string, CatalogDiscoveryItem] => {
    const row = metadata.get(item.id)
    const rawAverage = row?.averageScore ?? null
    let averageScore: number | null = null

    if (rawAverage !== null) {
      const numericAverage = Number(rawAverage)
      const roundedScore = Math.round(numericAverage * 10)

      averageScore = roundedScore / 10
    }

    const card: CatalogDiscoveryItem = {
      id: item.id,
      title: item.title,
      titleLocale: item.titleLocale,
      originalTitle: item.originalTitle,
      originalTitleLocale: item.originalTitleLocale,
      type: item.type,
      releaseYear: item.releaseYear,
      posterUrl: row?.posterPath ?? null,
      averageScore,
      ratingCount: row?.ratingCount ?? 0
    }

    return [item.id, card]
  })

  const cards = new Map(cardEntries)

  const orderedCards = ids.flatMap(id => {
    const card = cards.get(id)

    return card === undefined ? [] : [card]
  })

  return orderedCards
}

interface DiscoveryPageOptions {
  kind: CatalogDiscoveryKind;
  locale: string;
  page?: number;
  size?: number;
}

async function findDiscoveryPage(database: CatalogReader, { kind, locale, page = 1, size = DISCOVERY_PAGE_SIZE }: DiscoveryPageOptions): Promise<CatalogDiscoveryPage> {
  const votes = titleVotes(database)

  const original = database.select({ id: catalogItemTitles.catalogItemId }).from(catalogItemTitles)
    .where(
      and(eq(catalogItemTitles.catalogItemId, catalogItems.id), eq(catalogItemTitles.isOriginal, true))
    )

  const eligible = kind === 'top-rated'
    ? and(exists(original), sql`${votes.ratingCount} > 0`)
    : exists(original)

  // Rank by the database's exact numeric average, before rounding display scores.
  const order = kind === 'top-rated'
    ? [desc(votes.averageScore), desc(votes.ratingCount), catalogItems.id]
    : [sql`${catalogItems.addedAt} DESC NULLS LAST`, catalogItems.id]

  const offset = (page - 1) * size

  const rows = await database.select({ id: catalogItems.id }).from(catalogItems)
    .leftJoin(votes, eq(votes.catalogItemId, catalogItems.id))
    .where(eligible)
    .orderBy(...order)
    .offset(offset)
    .limit(size + 1)

  const visibleRows = rows.slice(0, size)
  const ids = visibleRows.map(row => row.id)
  const items = await findDiscoveryCards(database, ids, locale)
  const nextPage = rows.length > size ? page + 1 : null

  return {
    items,
    nextPage
  }
}

async function findCollectionPreviews(database: CatalogReader, locale: string, catalogItemId?: string): Promise<CatalogCollectionPreview[]> {
  let filter = eq(catalogCollections.isFeatured, true)

  if (catalogItemId !== undefined) {
    const membership = database.select({ id: catalogCollectionItems.collectionId }).from(catalogCollectionItems)
      .where(
        and(eq(catalogCollectionItems.collectionId, catalogCollections.id), eq(catalogCollectionItems.catalogItemId, catalogItemId))
      )

    filter = exists(membership)
  }

  const collections = await database.select().from(catalogCollections).where(filter).orderBy(catalogCollections.title, catalogCollections.id)

  if (collections.length === 0) { return [] }

  const ids = collections.map(collection => collection.id)

  // Include the current title even when it falls beyond the first preview page.
  const previewOrder = catalogItemId === undefined
    ? sql`${catalogCollectionItems.position}`
    : sql`(${catalogCollectionItems.catalogItemId} = ${catalogItemId}) DESC, ${catalogCollectionItems.position}`

  const ranked = database.select({
    collectionId: catalogCollectionItems.collectionId,
    catalogItemId: catalogCollectionItems.catalogItemId,
    position: catalogCollectionItems.position,
    rank: sql<number>`row_number() over (partition by ${catalogCollectionItems.collectionId} order by ${previewOrder})`.as('member_rank')
  }).from(catalogCollectionItems)
    .where(
      inArray(catalogCollectionItems.collectionId, ids)
    ).as('ranked_members')

  const members = await database.select().from(ranked)
    .where(
      sql`${ranked.rank} <= ${DISCOVERY_PREVIEW_SIZE}`
    ).orderBy(ranked.collectionId, ranked.position)

  const allMemberIds = members.map(member => member.catalogItemId)
  const uniqueMemberIds = new Set(allMemberIds)
  const memberIds = [...uniqueMemberIds]
  const cards = await findDiscoveryCards(database, memberIds, locale)
  const cardEntries = cards.map(card => [card.id, card] as const)
  const cardMap = new Map(cardEntries)
  const grouped = new Map<string, CatalogDiscoveryItem[]>()

  for (const member of members) {
    const card = cardMap.get(member.catalogItemId)

    if (card !== undefined) {
      const items = grouped.get(member.collectionId) ?? []

      items.push(card)
      grouped.set(member.collectionId, items)
    }
  }

  const previews = collections.map(collection => {
    const items = grouped.get(collection.id) ?? []

    return {
      collection,
      items
    }
  })

  return previews
}

export { findDiscoveryCards, findDiscoveryPage, findCollectionPreviews }
