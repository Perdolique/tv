import type { Database } from '@tv/database'
import type { ImportCard, ImportCatalogMatch, ImportSelection } from '@tv/shared/catalog-import'
import { catalogExternalLinks, catalogItemTitles, catalogItems } from '@tv/database/schema'
import { and, eq, inArray, or, sql } from 'drizzle-orm'

// oxlint-disable-next-line import/no-relative-parent-imports -- Candidate labels reuse catalog search projection.
import { createCatalogSearchItems } from '../search.ts'

// oxlint-disable-next-line import/no-relative-parent-imports -- Candidates reuse the catalog title lookup.
import { findTitleRowsForMatchingCatalogItems } from '../repository.ts'

async function addCandidateSources(database: Pick<Database, 'select'>, candidates: ImportCatalogMatch[]): Promise<ImportCatalogMatch[]> {
  if (candidates.length === 0) { return candidates }

  const ids = candidates.map(candidate => candidate.id)

  const links = await database.select().from(catalogExternalLinks)
    .where(
      inArray(catalogExternalLinks.catalogItemId, ids)
    )
    .orderBy(catalogExternalLinks.provider, catalogExternalLinks.entityType, catalogExternalLinks.externalId)

  for (const candidate of candidates) {
    candidate.sources = []

    const candidateLinks = links.filter(link => link.catalogItemId === candidate.id)

    for (const link of candidateLinks) {
      const { provider, entityType, externalId } = link

      if ((provider === 'tmdb' && (entityType === 'movie' || entityType === 'tv'))
        || (provider === 'tvmaze' && entityType === 'show')) {
        candidate.sources.push({
          provider,
          entityType,
          externalId
        })
      }
    }
  }

  return candidates.toSorted((first, second) => first.kind.localeCompare(second.kind) || first.id.localeCompare(second.id))
}

async function findImportCatalogMatches(database: Pick<Database, 'select' | 'selectDistinct'>, selection: ImportSelection, card: ImportCard | null): Promise<ImportCatalogMatch[]> {
  const identities = [{
    provider: 'tmdb',
    entityType: selection.type === 'movie' ? 'movie' : 'tv',
    externalId: String(selection.tmdbId)
  }]

  if (selection.type === 'series' && selection.tvmaze.status === 'selected') {
    identities.push({
      provider: 'tvmaze',
      entityType: 'show',
      externalId: String(selection.tvmaze.id)
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

  const exactRows = exactIds.length === 0
    ? []
    : await database
      .select({
        catalogItemId: catalogItems.id,
        isOriginal: sql<boolean>`coalesce(${catalogItemTitles.isOriginal}, true)`,
        locale: sql<string>`coalesce(${catalogItemTitles.locale}, 'en')`,
        releaseYear: catalogItems.releaseYear,
        title: sql<string>`coalesce(${catalogItemTitles.title}, ${catalogItems.id}::text)`,
        type: catalogItems.type
      })
      .from(catalogItems)
      .leftJoin(catalogItemTitles, eq(catalogItems.id, catalogItemTitles.catalogItemId))
      .where(
        inArray(catalogItems.id, exactIds)
      )

  const exactItems = createCatalogSearchItems(exactRows, 'en')

  const exactMatches = exactItems.map((item): ImportCatalogMatch => {
    return {
      id: item.id,
      title: item.title,
      year: item.releaseYear,
      type: item.type,
      kind: 'exact_source',
      sources: []
    }
  })

  const sourceTitle = card?.originalTitle.value

  if (sourceTitle === undefined) {
    return addCandidateSources(database, exactMatches)
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

  const possibleMatches = matchingItems.map((item): ImportCatalogMatch => {
    return {
      id: item.id,
      title: item.title,
      year: item.releaseYear,
      type: item.type,
      kind: 'possible_title',
      sources: []
    }
  })

  const candidates = [...exactMatches, ...possibleMatches]

  return addCandidateSources(database, candidates)
}

export { findImportCatalogMatches }
