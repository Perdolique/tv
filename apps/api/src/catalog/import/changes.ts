import type {
  FieldOrigin,
  ImportCard,
  ImportEpisode,
  ImportFieldName,
  PreviewChange,
  PreviewIssue
} from '@tv/database/import-preview'

import type { CatalogState } from './catalog-state.ts'

type FieldValue = string | number | null

interface FieldCandidate {
  target: PreviewChange['target'];
  field: ImportFieldName;
  locale: string | null;
  episodeExternalId: string | null;
  source: FieldOrigin;
  sourceValue: FieldValue;
  sourceHash: string | null;
  currentValue: FieldValue;
  currentExists: boolean;
  newTarget: boolean;
  catalogItemId: string | null;
  catalogEpisodeId: string | null;
}

interface ChangePlan {
  changes: PreviewChange[];
  errors: PreviewIssue[];
  warnings: PreviewIssue[];
}

interface LocalizedFieldInput {
  catalogItemId: string | null;
  locale: string;
  source: FieldOrigin;
  sourceValue: FieldValue;
}

interface ItemFieldInput {
  catalogItemId: string | null;
  field: 'releaseYear' | 'posterPath';
  source: FieldOrigin;
  sourceValue: FieldValue;
  sourceHash?: string | null;
}

interface ImportChangeInput {
  card: ImportCard | null;
  episodes: ImportEpisode[];
  catalogItemId: string | null;
  posterHash: string | null;
}

function findOwnership(state: CatalogState, candidate: FieldCandidate): CatalogState['fields'][number] | undefined {
  const locale = candidate.locale ?? ''

  return state.fields.find(field => field.catalogItemId === candidate.catalogItemId
    && field.catalogEpisodeId === candidate.catalogEpisodeId
    && field.fieldName === candidate.field
    && field.locale === locale)
}

function decideFieldAction(state: CatalogState, candidate: FieldCandidate): PreviewChange['action'] {
  const ownership = findOwnership(state, candidate)

  if (candidate.newTarget) {
    return 'add'
  }

  if (candidate.sourceValue === null) {
    return 'retain_missing'
  }

  if (ownership === undefined) {
    return candidate.currentExists ? 'preserve_manual' : 'add'
  }

  if (!candidate.currentExists || candidate.currentValue !== ownership.lastAppliedValue.value) {
    return 'preserve_manual'
  }

  const sourceMatchesLastCheck = candidate.sourceValue === ownership.lastSourceValue.value
    && candidate.sourceHash === (ownership.lastSourceValue.hash ?? null)

  const sourceMatchesLastApplication = candidate.field === 'posterPath'
    ? candidate.sourceHash === (ownership.lastAppliedValue.hash ?? null)
    : candidate.sourceValue === ownership.lastAppliedValue.value

  if (sourceMatchesLastCheck && sourceMatchesLastApplication) {
    return 'unchanged'
  }

  return 'update'
}

function planField(state: CatalogState, candidate: FieldCandidate): PreviewChange {
  const action = decideFieldAction(state, candidate)
  const { currentValue, sourceValue } = candidate
  const after = action === 'add' || action === 'update' ? sourceValue : currentValue

  return {
    target: candidate.target,
    field: candidate.field,
    locale: candidate.locale,
    episodeExternalId: candidate.episodeExternalId,
    action,
    before: currentValue,
    after,
    sourceValue,
    sourceHash: candidate.sourceHash,
    source: candidate.source
  }
}

function itemField(state: CatalogState, input: ItemFieldInput): PreviewChange {
  const { catalogItemId, field, source, sourceValue, sourceHash = null } = input
  const item = state.items.find(candidate => candidate.id === catalogItemId)
  const currentValue = field === 'releaseYear' ? item?.releaseYear ?? null : item?.posterPath ?? null

  return planField(state, {
    target: 'item',
    field,
    locale: null,
    episodeExternalId: null,
    source,
    sourceValue,
    sourceHash,
    currentValue,
    currentExists: item !== undefined,
    newTarget: item === undefined,
    catalogItemId,
    catalogEpisodeId: null
  })
}

function titleField(state: CatalogState, input: LocalizedFieldInput): PreviewChange {
  const { catalogItemId, locale, source, sourceValue } = input
  const row = state.titles.find(candidate => candidate.catalogItemId === catalogItemId && candidate.locale === locale)

  return planField(state, {
    target: 'title',
    field: 'title',
    locale,
    episodeExternalId: null,
    source,
    sourceValue,
    sourceHash: null,
    currentValue: row?.title ?? null,
    currentExists: row !== undefined,
    newTarget: catalogItemId === null,
    catalogItemId,
    catalogEpisodeId: null
  })
}

function descriptionField(state: CatalogState, input: LocalizedFieldInput): PreviewChange {
  const { catalogItemId, locale, source, sourceValue } = input
  const row = state.descriptions.find(candidate => candidate.catalogItemId === catalogItemId && candidate.locale === locale)

  return planField(state, {
    target: 'description',
    field: 'description',
    locale,
    episodeExternalId: null,
    source,
    sourceValue,
    sourceHash: null,
    currentValue: row?.description ?? null,
    currentExists: row !== undefined,
    newTarget: catalogItemId === null,
    catalogItemId,
    catalogEpisodeId: null
  })
}

function episodeField(
  state: CatalogState,
  episode: ImportEpisode,
  field: 'seasonNumber' | 'episodeNumber' | 'sourceTitle' | 'airDate'
): PreviewChange {
  const link = state.links.find(candidate => candidate.provider === 'tvmaze'
    && candidate.entityType === 'episode'
    && candidate.externalId === episode.identity.externalId)

  const stored = state.episodes.find(candidate => candidate.id === link?.catalogEpisodeId)
  const sourced = field === 'sourceTitle' ? episode.title : episode[field]

  return planField(state, {
    target: 'episode',
    field,
    locale: null,
    episodeExternalId: episode.identity.externalId,
    source: sourced.source,
    sourceValue: sourced.value,
    sourceHash: null,
    currentValue: stored?.[field] ?? null,
    currentExists: stored !== undefined,
    newTarget: stored === undefined,
    catalogItemId: null,
    catalogEpisodeId: stored?.id ?? null
  })
}

function planImportChanges(state: CatalogState, input: ImportChangeInput): ChangePlan {
  const { card, episodes, catalogItemId, posterHash } = input

  if (card === null) {
    return {
      changes: [],
      errors: [],
      warnings: []
    }
  }

  const changes: PreviewChange[] = []
  const errors: PreviewIssue[] = []
  const originalLocale = card.originalLanguage.value
  const existingOriginal = state.titles.find(row => row.catalogItemId === catalogItemId && row.isOriginal)

  if (existingOriginal !== undefined && existingOriginal.locale !== originalLocale) {
    errors.push({
      code: 'original_locale_conflict',
      message: 'The source original language differs from the reviewed catalog title.'
    })
  }

  changes.push(
    titleField(state, {
      catalogItemId,
      locale: originalLocale,
      source: card.originalTitle.source,
      sourceValue: card.originalTitle.value
    }),
    itemField(state, {
      catalogItemId,
      field: 'releaseYear',
      source: card.releaseYear.source,
      sourceValue: card.releaseYear.value
    }),
    itemField(state, {
      catalogItemId,
      field: 'posterPath',
      source: card.posterPath.source,
      sourceValue: card.posterPath.value,
      sourceHash: posterHash
    })
  )

  for (const translation of card.translations) {
    if (translation.title.value !== null) {
      changes.push(titleField(state, {
        catalogItemId,
        locale: translation.locale,
        source: translation.title.source,
        sourceValue: translation.title.value
      }))
    } else if (state.titles.some(row => row.catalogItemId === catalogItemId && row.locale === translation.locale)) {
      changes.push(titleField(state, {
        catalogItemId,
        locale: translation.locale,
        source: translation.title.source,
        sourceValue: null
      }))
    }

    if (translation.description.value !== null) {
      changes.push(descriptionField(state, {
        catalogItemId,
        locale: translation.locale,
        source: translation.description.source,
        sourceValue: translation.description.value
      }))
    } else if (state.descriptions.some(row => row.catalogItemId === catalogItemId && row.locale === translation.locale)) {
      changes.push(descriptionField(state, {
        catalogItemId,
        locale: translation.locale,
        source: translation.description.source,
        sourceValue: null
      }))
    }
  }

  const sourceLocales = new Set(card.translations.map(translation => translation.locale))

  for (const field of state.fields) {
    const missingLocale = field.catalogItemId === catalogItemId
      && (field.fieldName === 'title' || field.fieldName === 'description')
      && field.locale !== originalLocale
      && !sourceLocales.has(field.locale)

    if (missingLocale) {
      const localized = {
        catalogItemId,
        locale: field.locale,
        source: field.source,
        sourceValue: null
      }

      changes.push(field.fieldName === 'title'
        ? titleField(state, localized)
        : descriptionField(state, localized))
    }
  }

  for (const episode of episodes) {
    for (const field of ['seasonNumber', 'episodeNumber', 'sourceTitle', 'airDate'] as const) {
      changes.push(episodeField(state, episode, field))
    }
  }

  const warnings: PreviewIssue[] = []

  if (changes.some(change => change.action === 'preserve_manual' && change.before !== change.sourceValue)) {
    warnings.push({
      code: 'manual_values_preserved',
      message: 'Reviewed catalog values will be kept for fields changed outside import.'
    })
  }

  if (changes.some(change => change.action === 'retain_missing' && change.before !== null)) {
    warnings.push({
      code: 'source_values_missing',
      message: 'Some source fields are missing; saved catalog values will be kept.'
    })
  }

  return {
    changes,
    errors,
    warnings
  }
}

export { planImportChanges }
