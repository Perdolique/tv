import type { ImportEpisode, PreviewIssue, SourceIdentity } from '@tv/database/import-preview'
import type { CatalogState } from './catalog-state.ts'

interface EpisodeInspection {
  episodeExternalIds: string[];
  sourceLinks: SourceIdentity[];
  errors: PreviewIssue[];
}

function inspectEpisodeChanges(state: CatalogState, catalogItemId: string | null, episodes: ImportEpisode[]): EpisodeInspection {
  const episodeExternalIds: string[] = []
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

    if (linkedEpisode !== undefined && (
      linkedEpisode.seasonNumber !== episode.seasonNumber.value
      || linkedEpisode.episodeNumber !== episode.episodeNumber.value
    )) {
      errors.push({
        code: 'episode_coordinates_changed',
        message: 'An existing episode has different source coordinates and needs review.'
      })
    }

    if (coordinateEpisode !== undefined && coordinateEpisode.id !== linkedEpisode?.id) {
      errors.push({
        code: 'episode_coordinates_conflict',
        message: 'Episode coordinates belong to a different local episode.'
      })
    }

    if (link === undefined && coordinateEpisode === undefined) {
      episodeExternalIds.push(episode.identity.externalId)
      sourceLinks.push(episode.identity)
    }
  }

  return {
    episodeExternalIds,
    sourceLinks,
    errors
  }
}

export { inspectEpisodeChanges }
