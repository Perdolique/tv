import type { Database } from '@tv/database'
import type { ImportCatalogMatch, ImportPreviewView } from '@tv/shared/catalog-import'
import { catalogExternalLinks, catalogItemTitles, catalogItems } from '@tv/database/schema'
import { and, eq, inArray, or } from 'drizzle-orm'

// oxlint-disable-next-line import/no-relative-parent-imports -- Review reuses catalog search projection.
import { createCatalogSearchItems } from '../search.ts'

// oxlint-disable-next-line import/no-relative-parent-imports -- Review reuses the catalog title lookup.
import { findTitleRowsForMatchingCatalogItems } from '../repository.ts'
import type { StoredPreview } from './repository.ts'

async function findImportCatalogMatches(database: Database, preview: StoredPreview): Promise<ImportCatalogMatch[]> {
  const identities = [{
    provider: 'tmdb',
    entityType: preview.selection.type === 'movie' ? 'movie' : 'tv',
    externalId: String(preview.selection.tmdbId)
  }]

  if (preview.selection.type === 'series' && preview.selection.tvmaze.status === 'selected') {
    identities.push({
      provider: 'tvmaze',
      entityType: 'show',
      externalId: String(preview.selection.tvmaze.id)
    })
  }

  const conditions = identities.map(identity => and(
    eq(catalogExternalLinks.provider, identity.provider),
    eq(catalogExternalLinks.entityType, identity.entityType),
    eq(catalogExternalLinks.externalId, identity.externalId)
  ))

  const linked = await database.select({ catalogItemId: catalogExternalLinks.catalogItemId })
    .from(catalogExternalLinks)
    .where(
      or(...conditions)
    )

  const linkedIds = linked.map(link => link.catalogItemId)
  const catalogItemIds = linkedIds.filter(id => id !== null)
  const exactIdSet = new Set(catalogItemIds)
  const exactIds = [...exactIdSet]

  const exactRows = exactIds.length === 0 ? [] : await database.select({
    catalogItemId: catalogItemTitles.catalogItemId,
    isOriginal: catalogItemTitles.isOriginal,
    locale: catalogItemTitles.locale,
    releaseYear: catalogItems.releaseYear,
    title: catalogItemTitles.title,
    type: catalogItems.type
  }).from(catalogItemTitles)
    .innerJoin(catalogItems, eq(catalogItems.id, catalogItemTitles.catalogItemId))
    .where(
      inArray(catalogItemTitles.catalogItemId, exactIds)
    )

  const exactItems = createCatalogSearchItems(exactRows, 'en')

  const exactMatches = exactItems.map(item => {
    return {
      id: item.id,
      title: item.title,
      year: item.releaseYear,
      type: item.type,
      kind: 'exact_source' as const
    }
  })

  const sourceTitle = preview.data.card?.originalTitle.value

  if (sourceTitle === undefined) {
    return exactMatches
  }

  const possibleRows = await findTitleRowsForMatchingCatalogItems(database, sourceTitle)
  const sourceName = sourceTitle.toLocaleLowerCase()
  const possibleIds = new Set<string>()

  for (const row of possibleRows) {
    const title = row.title.toLocaleLowerCase()
    const isExactMatch = exactIdSet.has(row.catalogItemId)

    if (title === sourceName && !isExactMatch) {
      possibleIds.add(row.catalogItemId)
    }
  }

  const possibleItems = createCatalogSearchItems(possibleRows, 'en')
  const matchingItems = possibleItems.filter(item => possibleIds.has(item.id))

  const possibleMatches = matchingItems.map(item => {
    return {
      id: item.id,
      title: item.title,
      year: item.releaseYear,
      type: item.type,
      kind: 'possible_title' as const
    }
  })

  return [...exactMatches, ...possibleMatches]
}

async function createImportPreviewView(database: Database, preview: StoredPreview): Promise<ImportPreviewView> {
  const matches = await findImportCatalogMatches(database, preview)

  const posterUrl = preview.data.poster === null
    ? null
    : `/api/catalog/imports/previews/${preview.id}/poster`

  return {
    id: preview.id,
    status: preview.status,
    selection: preview.selection,
    data: preview.data,
    createdAt: preview.createdAt.toISOString(),
    expiresAt: preview.expiresAt.toISOString(),
    posterUrl,
    matches
  }
}

export { createImportPreviewView }
