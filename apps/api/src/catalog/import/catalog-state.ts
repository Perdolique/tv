import type { Database } from '@tv/database'
import type { ImportPreviewData } from '@tv/shared/catalog-import'
import type { ImportSelection, PreviewAdditions, PreviewIssue, SourceIdentity } from '@tv/database/import-preview'

import {
  catalogEpisodes,
  catalogExternalLinks,
  catalogImportFields,
  catalogItemDescriptions,
  catalogItems,
  catalogItemTitles
} from '@tv/database/schema'

import { and, eq, inArray, or } from 'drizzle-orm'
import { inspectEpisodeChanges } from './episode-inspection.ts'
import { findImportCatalogMatches } from './matches.ts'
import { sha256 } from './poster.ts'

type CatalogReader = Pick<Database, 'select' | 'selectDistinct'>
type CatalogReview = Pick<ImportPreviewData, 'card' | 'target' | 'candidates' | 'episodes'>

interface CatalogState {
  candidateKeys: string[];
  items: (typeof catalogItems.$inferSelect)[];
  titles: (typeof catalogItemTitles.$inferSelect)[];
  descriptions: (typeof catalogItemDescriptions.$inferSelect)[];
  episodes: (typeof catalogEpisodes.$inferSelect)[];
  links: (typeof catalogExternalLinks.$inferSelect)[];
  fields: (typeof catalogImportFields.$inferSelect)[];
}

interface CatalogInspection {
  candidatesChanged: boolean;
  fingerprint: string;
  additions: PreviewAdditions;
  errors: PreviewIssue[];
}

function selectedTitleIdentities(selection: ImportSelection): SourceIdentity[] {
  const entityType = selection.type === 'movie' ? 'movie' : 'tv'
  const externalId = String(selection.tmdbId)

  const identities: SourceIdentity[] = [{
    provider: 'tmdb',
    entityType,
    externalId
  }]

  if (selection.type === 'series' && selection.tvmaze.status === 'selected') {
    const externalShowId = String(selection.tvmaze.id)

    identities.push({
      provider: 'tvmaze',
      entityType: 'show',
      externalId: externalShowId
    })
  }

  return identities
}

function sameIdentity(first: SourceIdentity, second: Pick<typeof catalogExternalLinks.$inferSelect, 'provider' | 'entityType' | 'externalId'>): boolean {
  return first.provider === second.provider && first.entityType === second.entityType && first.externalId === second.externalId
}

// Read this inside a repeatable-read transaction. User activity is deliberately excluded.
async function readCatalogState(database: CatalogReader, selection: ImportSelection, review: CatalogReview): Promise<CatalogState> {
  const { episodes } = review
  const currentCandidates = await findImportCatalogMatches(database, selection, review.card)
  const candidateKeys = currentCandidates.map(candidate => `${candidate.kind}:${candidate.id}`)
  const identities = selectedTitleIdentities(selection)

  const conditions = identities.map(identity => and(
    eq(catalogExternalLinks.provider, identity.provider),
    eq(catalogExternalLinks.entityType, identity.entityType),
    eq(catalogExternalLinks.externalId, identity.externalId)
  ))

  if (episodes.length > 0) {
    const episodeExternalIds = episodes.map(episode => episode.identity.externalId)

    conditions.push(and(
      eq(catalogExternalLinks.provider, 'tvmaze'),
      eq(catalogExternalLinks.entityType, 'episode'),
      inArray(catalogExternalLinks.externalId, episodeExternalIds)
    ))
  }

  const selectedLinks = await database
    .select()
    .from(catalogExternalLinks)
    .where(
      or(...conditions)
    )

  const candidateIds = review.candidates.map(candidate => candidate.id)
  const itemIds = new Set(candidateIds)

  if (review.target.kind === 'existing') {
    itemIds.add(review.target.catalogItemId)
  }

  const linkedEpisodeIds: string[] = []

  for (const link of selectedLinks) {
    if (link.catalogItemId !== null) {
      itemIds.add(link.catalogItemId)
    }

    if (link.catalogEpisodeId !== null) {
      linkedEpisodeIds.push(link.catalogEpisodeId)
    }
  }

  if (linkedEpisodeIds.length > 0) {
    const linkedEpisodes = await database
      .select()
      .from(catalogEpisodes)
      .where(
        inArray(catalogEpisodes.id, linkedEpisodeIds)
      )

    for (const episode of linkedEpisodes) {
      itemIds.add(episode.catalogItemId)
    }
  }

  if (itemIds.size === 0) {
    return {
      candidateKeys,
      items: [],
      titles: [],
      descriptions: [],
      episodes: [],
      links: [],
      fields: []
    }
  }

  const ids = [...itemIds]

  const items = await database
    .select()
    .from(catalogItems)
    .where(
      inArray(catalogItems.id, ids)
    )
    .orderBy(catalogItems.id)

  const titles = await database
    .select()
    .from(catalogItemTitles)
    .where(
      inArray(catalogItemTitles.catalogItemId, ids)
    )
    .orderBy(catalogItemTitles.catalogItemId, catalogItemTitles.locale)

  const descriptions = await database
    .select()
    .from(catalogItemDescriptions)
    .where(
      inArray(catalogItemDescriptions.catalogItemId, ids)
    )
    .orderBy(catalogItemDescriptions.catalogItemId, catalogItemDescriptions.locale)

  const storedEpisodes = await database
    .select()
    .from(catalogEpisodes)
    .where(
      inArray(catalogEpisodes.catalogItemId, ids)
    )
    .orderBy(catalogEpisodes.id)

  const allEpisodeIds = storedEpisodes.map(episode => episode.id)
  const linkConditions = [inArray(catalogExternalLinks.catalogItemId, ids)]

  if (allEpisodeIds.length > 0) {
    linkConditions.push(inArray(catalogExternalLinks.catalogEpisodeId, allEpisodeIds))
  }

  const links = await database
    .select()
    .from(catalogExternalLinks)
    .where(
      or(...linkConditions)
    )
    .orderBy(catalogExternalLinks.provider, catalogExternalLinks.entityType, catalogExternalLinks.externalId)

  const fieldConditions = [inArray(catalogImportFields.catalogItemId, ids)]

  if (allEpisodeIds.length > 0) {
    fieldConditions.push(inArray(catalogImportFields.catalogEpisodeId, allEpisodeIds))
  }

  const fields = await database
    .select()
    .from(catalogImportFields)
    .where(
      or(...fieldConditions)
    )
    .orderBy(catalogImportFields.id)

  return {
    candidateKeys,
    items,
    titles,
    descriptions,
    episodes: storedEpisodes,
    links,
    fields
  }
}

function fingerprintCatalogState(state: CatalogState, selection: ImportSelection, review: CatalogReview): string {
  const { episodes } = review
  const sourceEpisodeIds = episodes.map(episode => episode.identity.externalId)
  const incomingEpisodeIds = sourceEpisodeIds.toSorted()
  const titleIdentities = selectedTitleIdentities(selection)
  const absenceReason = selection.type === 'series' && selection.tvmaze.status === 'verified_absent' ? selection.tvmaze.reason : null
  const targetItemId = review.target.kind === 'existing' ? review.target.catalogItemId : null
  const candidateIds = review.candidates.map(candidate => candidate.id)
  const sortedCandidateIds = candidateIds.toSorted()

  const serialized = JSON.stringify({
    titleIdentities,
    absenceReason,
    incomingEpisodeIds,
    targetKind: review.target.kind,
    targetItemId,
    candidateIds: sortedCandidateIds,
    state
  })

  return sha256(serialized)
}

function inspectCatalogState(state: CatalogState, selection: ImportSelection, review: CatalogReview): CatalogInspection {
  const { episodes } = review
  const savedCandidateKeys = review.candidates.map(candidate => `${candidate.kind}:${candidate.id}`)
  const candidatesChanged = JSON.stringify(state.candidateKeys) !== JSON.stringify(savedCandidateKeys)
  const titleIdentities = selectedTitleIdentities(selection)
  const selectedLinks = state.links.filter(link => titleIdentities.some(identity => sameIdentity(identity, link)))
  const linkedItemIds = selectedLinks.map(link => link.catalogItemId)
  const selectedItemIds = new Set(linkedItemIds)
  const errors: PreviewIssue[] = []

  if (selectedItemIds.size > 1) {
    errors.push({
      code: 'title_identity_conflict',
      message: 'The selected sources belong to different catalog titles.'
    })
  }

  const catalogItemId = review.target.kind === 'existing' ? review.target.catalogItemId : null

  if (review.target.kind === 'unresolved') {
    errors.push({
      code: 'target_required',
      message: 'Choose an existing catalog card or confirm a separate card.'
    })
  }

  if (selectedLinks.some(link => link.catalogItemId !== catalogItemId)) {
    errors.push({
      code: 'target_source_conflict',
      message: 'The selected sources belong to another catalog card. Create a new preview.'
    })
  }

  if (review.target.kind === 'existing' && !review.candidates.some(candidate => candidate.id === catalogItemId)) {
    errors.push({
      code: 'target_not_candidate',
      message: 'The target is not a saved catalog match.'
    })
  }

  const exactCandidates = review.candidates.filter(candidate => candidate.kind === 'exact_source')

  if (exactCandidates.some(candidate => candidate.id !== catalogItemId)) {
    errors.push({
      code: 'target_locked',
      message: 'A source-linked import cannot be redirected to another card.'
    })
  }

  const item = state.items.find(candidate => candidate.id === catalogItemId)

  if (review.target.kind === 'existing' && item === undefined) {
    errors.push({
      code: 'target_missing',
      message: 'The selected catalog card no longer exists. Create a new preview.'
    })
  }

  if (item !== undefined && item.type !== selection.type) {
    errors.push({
      code: 'title_type_conflict',
      message: 'The selected source has a different catalog type.'
    })
  }

  const existingTitleLinks = state.links.filter(link => link.catalogItemId === catalogItemId && catalogItemId !== null)

  for (const link of existingTitleLinks) {
    const chosen = titleIdentities.find(identity => identity.provider === link.provider && identity.entityType === link.entityType)
    const absentShow = selection.type === 'series' && selection.tvmaze.status === 'verified_absent' && link.provider === 'tvmaze'

    if (absentShow || (chosen !== undefined && chosen.externalId !== link.externalId)) {
      errors.push({
        code: 'reviewed_mapping_conflict',
        message: 'The selection would replace an existing source mapping.'
      })
    }
  }

  const episodeChanges = inspectEpisodeChanges(state, catalogItemId, episodes)
  const newTitleLinks = titleIdentities.filter(identity => !selectedLinks.some(link => sameIdentity(identity, link)))
  const sourceLinks = [...newTitleLinks, ...episodeChanges.sourceLinks]

  errors.push(...episodeChanges.errors)

  const fingerprint = fingerprintCatalogState(state, selection, review)

  return {
    candidatesChanged,
    fingerprint,

    additions: {
      catalogItemId,
      createItem: review.target.kind === 'new',
      episodeExternalIds: episodeChanges.episodeExternalIds,
      sourceLinks
    },

    errors
  }
}

export { inspectCatalogState, readCatalogState }
export type { CatalogState }
