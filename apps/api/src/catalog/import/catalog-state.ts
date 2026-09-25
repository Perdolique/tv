import type { Database } from '@tv/database'

import type {
  ImportEpisode,
  ImportSelection,
  PreviewAdditions,
  PreviewIssue,
  SourceIdentity
} from '@tv/database/import-preview'

import { catalogEpisodes, catalogExternalLinks, catalogItems, catalogItemTitles } from '@tv/database/schema'
import { and, eq, inArray, or } from 'drizzle-orm'
import { sha256 } from './poster.ts'

type CatalogReader = Pick<Database, 'select'>

interface CatalogState {
  items: (typeof catalogItems.$inferSelect)[];
  titles: (typeof catalogItemTitles.$inferSelect)[];
  episodes: (typeof catalogEpisodes.$inferSelect)[];
  links: (typeof catalogExternalLinks.$inferSelect)[];
}

interface CatalogInspection {
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
async function readCatalogState(database: CatalogReader, selection: ImportSelection, episodes: ImportEpisode[]): Promise<CatalogState> {
  const identities = selectedTitleIdentities(selection)

  const conditions = identities.map(identity => and(
    eq(catalogExternalLinks.provider, identity.provider),
    eq(catalogExternalLinks.entityType, identity.entityType),
    eq(catalogExternalLinks.externalId, identity.externalId)
  ))

  if (episodes.length > 0) {
    const episodeIds = episodes.map(episode => episode.identity.externalId)

    conditions.push(and(
      eq(catalogExternalLinks.provider, 'tvmaze'),
      eq(catalogExternalLinks.entityType, 'episode'),
      inArray(catalogExternalLinks.externalId, episodeIds)
    ))
  }

  const selectedLinks = await database
    .select()
    .from(catalogExternalLinks)
    .where(
      or(...conditions)
    )

  const itemIds = new Set<string>()
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
      items: [],
      titles: [],
      episodes: [],
      links: []
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

  return {
    items,
    titles,
    episodes: storedEpisodes,
    links
  }
}

function fingerprintCatalogState(state: CatalogState, selection: ImportSelection, episodes: ImportEpisode[]): string {
  const sourceEpisodeIds = episodes.map(episode => episode.identity.externalId)
  const incomingEpisodeIds = sourceEpisodeIds.toSorted()
  const titleIdentities = selectedTitleIdentities(selection)
  const absenceReason = selection.type === 'series' && selection.tvmaze.status === 'verified_absent' ? selection.tvmaze.reason : null

  const serialized = JSON.stringify({
    titleIdentities,
    absenceReason,
    incomingEpisodeIds,
    state
  })

  return sha256(serialized)
}

interface EpisodeInspection {
  episodeIds: string[];
  sourceLinks: SourceIdentity[];
  errors: PreviewIssue[];
}

function inspectEpisodeChanges(state: CatalogState, catalogItemId: string | null, episodes: ImportEpisode[]): EpisodeInspection {
  const episodeIds: string[] = []
  const sourceLinks: SourceIdentity[] = []
  const errors: PreviewIssue[] = []
  const episodeLinks = state.links.filter(link => link.provider === 'tvmaze' && link.entityType === 'episode')
  const sourceEntries = episodeLinks.map(link => [link.externalId, link] as const)
  const linksByExternalId = new Map(sourceEntries)
  const episodeEntries = state.episodes.map(episode => [episode.id, episode] as const)
  const episodesById = new Map(episodeEntries)
  const episodesByCoordinates = new Map<string, CatalogState['episodes'][number]>()

  for (const localEpisode of state.episodes) {
    if (localEpisode.catalogItemId === catalogItemId) {
      const coordinates = `${localEpisode.seasonNumber}:${localEpisode.episodeNumber}`

      episodesByCoordinates.set(coordinates, localEpisode)
    }
  }

  for (const episode of episodes) {
    const link = linksByExternalId.get(episode.identity.externalId)
    const linkedEpisode = link?.catalogEpisodeId === null || link === undefined ? undefined : episodesById.get(link.catalogEpisodeId)
    const coordinates = `${episode.seasonNumber.value}:${episode.episodeNumber.value}`
    const coordinateEpisode = episodesByCoordinates.get(coordinates)

    if (linkedEpisode !== undefined && linkedEpisode.catalogItemId !== catalogItemId) {
      errors.push({
        code: 'episode_title_conflict',
        message: 'An episode ID already belongs to another catalog title.'
      })
    }

    if (coordinateEpisode !== undefined && coordinateEpisode.id !== linkedEpisode?.id) {
      errors.push({
        code: 'episode_coordinates_conflict',
        message: 'Episode coordinates belong to a different local episode.'
      })
    }

    if (link === undefined && coordinateEpisode === undefined) {
      episodeIds.push(episode.identity.externalId)
      sourceLinks.push(episode.identity)
    }
  }

  return {
    episodeIds,
    sourceLinks,
    errors
  }
}

function inspectCatalogState(state: CatalogState, selection: ImportSelection, episodes: ImportEpisode[]): CatalogInspection {
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

  const catalogItemId = selectedLinks[0]?.catalogItemId ?? null
  const item = state.items.find(candidate => candidate.id === catalogItemId)

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

  const fingerprint = fingerprintCatalogState(state, selection, episodes)

  return {
    fingerprint,

    additions: {
      catalogItemId,
      createItem: catalogItemId === null,
      episodeIds: episodeChanges.episodeIds,
      sourceLinks
    },

    errors
  }
}

export { inspectCatalogState, readCatalogState }
export type { CatalogState }
