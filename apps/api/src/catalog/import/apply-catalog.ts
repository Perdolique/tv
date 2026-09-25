/* oxlint-disable eslint/max-lines -- Atomic catalog writes share one transaction and explicit field ownership logic. */
import type { Database } from '@tv/database'
import type { ImportApplySummary } from '@tv/database/catalog-import-operations'
import type { PreviewChange } from '@tv/database/import-preview'

import {
  catalogEpisodes,
  catalogExternalLinks,
  catalogImportFields,
  catalogItemDescriptions,
  catalogItems,
  catalogItemTitles
} from '@tv/database/schema'

import { and, eq, isNotNull, sql } from 'drizzle-orm'
import type { CatalogState } from './catalog-state.ts'
import type { StoredPreview } from './repository.ts'

type CatalogWriter = Pick<Database, 'insert' | 'update'>
type ImportFieldInsert = typeof catalogImportFields.$inferInsert

interface CatalogWriteInput {
  database: CatalogWriter;
  preview: StoredPreview;
  state: CatalogState;
  uploadedPosterPath: string | null;
  now: Date;
}

interface FieldWriteInput {
  database: CatalogWriter;
  state: CatalogState;
  changes: PreviewChange[];
  catalogItemId: string;
  catalogEpisodeIdsByExternalId: Map<string, string>;
  posterPath: string | null;
  now: Date;
}

function sourceValue<Value extends string | number | null>(value: Value): { value: Value } {
  return { value }
}

function checkedSourceValue(change: PreviewChange): { value: string | number | null; hash?: string | null } {
  return change.field === 'posterPath'
    ? {
      value: change.sourceValue,
      hash: change.sourceHash
    }
    : sourceValue(change.sourceValue)
}

function changeFor(changes: PreviewChange[], field: PreviewChange['field'], target: PreviewChange['target']): PreviewChange {
  const change = changes.find(candidate => candidate.field === field && candidate.target === target)

  if (change === undefined) {
    throw new Error(`Saved preview has no ${field} change`)
  }

  return change
}

function applied(change: PreviewChange): boolean {
  return change.action === 'add' || change.action === 'update'
}

function appliedValue(change: PreviewChange, posterPath: string | null): string | number | null {
  if (change.field === 'posterPath' && applied(change)) {
    return posterPath
  }

  return change.after
}

function lastAppliedValue(change: PreviewChange, posterPath: string | null): ImportFieldInsert['lastAppliedValue'] {
  const value = appliedValue(change, posterPath)

  return change.field === 'posterPath'
    ? {
      value,
      hash: change.sourceHash
    }
    : sourceValue(value)
}

function numberOrNull(value: PreviewChange['after']): number | null {
  if (typeof value === 'number' || value === null) {
    return value
  }

  throw new TypeError('Saved numeric field has invalid data')
}

function textOrNull(value: PreviewChange['after']): string | null {
  if (typeof value === 'string' || value === null) {
    return value
  }

  throw new TypeError('Saved text field has invalid data')
}

async function saveImportFields({ database, state, changes, catalogItemId, catalogEpisodeIdsByExternalId, posterPath, now }: FieldWriteInput): Promise<void> {
  const itemFields: ImportFieldInsert[] = []
  const episodeFields: ImportFieldInsert[] = []

  for (const change of changes) {
    const episodeId = change.target === 'episode' ? catalogEpisodeIdsByExternalId.get(change.episodeExternalId ?? '') : null

    const previous = state.fields.find(field => field.catalogItemId === (change.target === 'episode' ? null : catalogItemId)
      && field.catalogEpisodeId === episodeId
      && field.fieldName === change.field
      && field.locale === (change.locale ?? ''))

    if (!applied(change) && change.action !== 'unchanged') {
      if (previous !== undefined) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Updates share one transaction and must complete before its result.
        await database.update(catalogImportFields)
          .set({
            source: change.source,
            lastSourceValue: checkedSourceValue(change),
            reviewedAt: now
          })
          .where(
            eq(catalogImportFields.id, previous.id)
          )
      }

    } else {
      const field: ImportFieldInsert = {
        fieldName: change.field,
        locale: change.locale ?? '',
        source: change.source,
        lastSourceValue: checkedSourceValue(change),
        lastAppliedValue: lastAppliedValue(change, posterPath),
        reviewedAt: now
      }

      if (change.target === 'episode') {
        if (episodeId === undefined || episodeId === null) {
          throw new Error('Saved preview episode has no catalog ID')
        }

        field.catalogEpisodeId = episodeId

        episodeFields.push(field)
      } else {
        field.catalogItemId = catalogItemId

        itemFields.push(field)
      }
    }
  }

  const updates = {
    source: sql`excluded.source`,
    lastSourceValue: sql`excluded.last_source_value`,
    lastAppliedValue: sql`excluded.last_applied_value`,
    reviewedAt: sql`excluded.reviewed_at`
  }

  if (itemFields.length > 0) {
    await database.insert(catalogImportFields).values(itemFields).onConflictDoUpdate({
      target: [catalogImportFields.catalogItemId, catalogImportFields.fieldName, catalogImportFields.locale],
      targetWhere: isNotNull(catalogImportFields.catalogItemId),
      set: updates
    })
  }

  if (episodeFields.length > 0) {
    await database.insert(catalogImportFields).values(episodeFields).onConflictDoUpdate({
      target: [catalogImportFields.catalogEpisodeId, catalogImportFields.fieldName],
      targetWhere: isNotNull(catalogImportFields.catalogEpisodeId),
      set: updates
    })
  }
}

async function writeCatalogItem(input: CatalogWriteInput): Promise<{ catalogItemId: string; posterPath: string | null }> {
  const { database, preview, state, uploadedPosterPath } = input
  const { card, changes, additions } = preview.data

  if (card === null) {
    throw new Error('Ready preview has no card')
  }

  const yearChange = changeFor(changes, 'releaseYear', 'item')
  const posterChange = changeFor(changes, 'posterPath', 'item')
  const existingItem = state.items.find(item => item.id === additions.catalogItemId)
  let { catalogItemId } = additions

  if (additions.createItem) {
    const rows = await database.insert(catalogItems).values({
      type: card.type,
      releaseYear: numberOrNull(yearChange.after),
      posterPath: uploadedPosterPath
    }).returning({ id: catalogItems.id })

    catalogItemId = rows[0]?.id ?? null
  } else if (catalogItemId !== null) {
    if (yearChange.action === 'update') {
      await database.update(catalogItems)
        .set({ releaseYear: numberOrNull(yearChange.after) })
        .where(
          eq(catalogItems.id, catalogItemId)
        )
    }

    if (posterChange.action === 'update') {
      await database.update(catalogItems)
        .set({ posterPath: uploadedPosterPath })
        .where(
          eq(catalogItems.id, catalogItemId)
        )
    }
  }

  if (catalogItemId === null) {
    throw new Error('Import did not resolve a catalog item ID')
  }

  return {
    catalogItemId,
    posterPath: applied(posterChange) ? uploadedPosterPath : existingItem?.posterPath ?? null
  }
}

async function writeLocalizedFields(database: CatalogWriter, preview: StoredPreview, catalogItemId: string): Promise<void> {
  const { changes, card } = preview.data

  if (card === null) {
    throw new Error('Ready preview has no card')
  }

  const localizedChanges = changes.filter(change => applied(change) && (change.target === 'title' || change.target === 'description'))

  for (const change of localizedChanges) {
    const { locale } = change

    if (locale === null || typeof change.after !== 'string') {
      throw new TypeError('Saved localized field has invalid data')
    }

    if (change.target === 'title') {
      if (change.action === 'add') {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Localized rows share one transaction and must finish before the operation succeeds.
        await database.insert(catalogItemTitles).values({
          catalogItemId,
          locale,
          title: change.after,
          isOriginal: locale === card.originalLanguage.value
        })
      } else {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Localized rows share one transaction and must finish before the operation succeeds.
        await database.update(catalogItemTitles)
          .set({ title: change.after })
          .where(
            and(
              eq(catalogItemTitles.catalogItemId, catalogItemId),
              eq(catalogItemTitles.locale, locale)
            )
          )
      }
    } else if (change.action === 'add') {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Localized rows share one transaction and must finish before the operation succeeds.
      await database.insert(catalogItemDescriptions).values({
        catalogItemId,
        locale,
        description: change.after
      })
    } else {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Localized rows share one transaction and must finish before the operation succeeds.
      await database.update(catalogItemDescriptions)
        .set({ description: change.after })
        .where(
          and(
            eq(catalogItemDescriptions.catalogItemId, catalogItemId),
            eq(catalogItemDescriptions.locale, locale)
          )
        )
    }
  }
}

async function writeEpisodes(input: CatalogWriteInput, catalogItemId: string): Promise<{ catalogEpisodeIdsByExternalId: Map<string, string>; createdEpisodes: number }> {
  const { database, preview, state } = input
  const { additions, episodes, changes } = preview.data
  const newEpisodeExternalIds = new Set(additions.episodeExternalIds)
  const newEpisodes = episodes.filter(episode => newEpisodeExternalIds.has(episode.identity.externalId))
  const catalogEpisodeIdsByExternalId = new Map<string, string>()

  for (const link of state.links) {
    if (link.provider === 'tvmaze' && link.entityType === 'episode' && link.catalogEpisodeId !== null) {
      catalogEpisodeIdsByExternalId.set(link.externalId, link.catalogEpisodeId)
    }
  }

  if (newEpisodes.length > 0) {
    const values = newEpisodes.map(episode => {
      return {
        catalogItemId,
        seasonNumber: episode.seasonNumber.value,
        episodeNumber: episode.episodeNumber.value,
        sourceTitle: episode.title.value,
        airDate: episode.airDate.value
      }
    })

    const rows = await database.insert(catalogEpisodes).values(values).returning({
      id: catalogEpisodes.id,
      seasonNumber: catalogEpisodes.seasonNumber,
      episodeNumber: catalogEpisodes.episodeNumber
    })

    const coordinateEntries = rows.map(row => [`${String(row.seasonNumber)}:${String(row.episodeNumber)}`, row.id] as const)
    const idsByCoordinates = new Map<string, string>(coordinateEntries)

    for (const episode of newEpisodes) {
      const coordinates = `${String(episode.seasonNumber.value)}:${String(episode.episodeNumber.value)}`
      const episodeId = idsByCoordinates.get(coordinates)

      if (episodeId === undefined) {
        throw new Error('Inserted episode has no catalog ID')
      }

      catalogEpisodeIdsByExternalId.set(episode.identity.externalId, episodeId)
    }
  }

  for (const episode of episodes) {
    const episodeId = catalogEpisodeIdsByExternalId.get(episode.identity.externalId)

    if (episodeId !== undefined && !newEpisodeExternalIds.has(episode.identity.externalId)) {
      const titleChange = changes.find(change => change.target === 'episode'
        && change.episodeExternalId === episode.identity.externalId
        && change.field === 'sourceTitle')

      const dateChange = changes.find(change => change.target === 'episode'
        && change.episodeExternalId === episode.identity.externalId
        && change.field === 'airDate')

      if (titleChange?.action === 'update') {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Episode updates share one transaction and must finish before the operation succeeds.
        await database.update(catalogEpisodes)
          .set({ sourceTitle: textOrNull(titleChange.after) })
          .where(
            eq(catalogEpisodes.id, episodeId)
          )
      }

      if (dateChange?.action === 'update') {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Episode updates share one transaction and must finish before the operation succeeds.
        await database.update(catalogEpisodes)
          .set({ airDate: textOrNull(dateChange.after) })
          .where(
            eq(catalogEpisodes.id, episodeId)
          )
      }
    }
  }

  return {
    catalogEpisodeIdsByExternalId,
    createdEpisodes: newEpisodes.length
  }
}

async function writeSourceLinks(input: CatalogWriteInput, catalogItemId: string, catalogEpisodeIdsByExternalId: Map<string, string>): Promise<number> {
  const links = input.preview.data.additions.sourceLinks.map(identity => {
    return {
      provider: identity.provider,
      entityType: identity.entityType,
      externalId: identity.externalId,
      catalogItemId: identity.entityType === 'episode' ? null : catalogItemId,
      catalogEpisodeId: identity.entityType === 'episode' ? catalogEpisodeIdsByExternalId.get(identity.externalId) ?? null : null
    }
  })

  if (links.some(link => link.entityType === 'episode' && link.catalogEpisodeId === null)) {
    throw new Error('Saved episode source link has no catalog ID')
  }

  if (links.length > 0) {
    await input.database.insert(catalogExternalLinks).values(links)
  }

  return links.length
}

async function writeCatalogImport(input: CatalogWriteInput): Promise<ImportApplySummary> {
  const { database, preview, state, now } = input
  const { changes, additions } = preview.data
  const { catalogItemId, posterPath } = await writeCatalogItem(input)

  await writeLocalizedFields(database, preview, catalogItemId)

  const { catalogEpisodeIdsByExternalId, createdEpisodes } = await writeEpisodes(input, catalogItemId)
  const linkedSources = await writeSourceLinks(input, catalogItemId, catalogEpisodeIdsByExternalId)

  await saveImportFields({
    database,
    state,
    changes,
    catalogItemId,
    catalogEpisodeIdsByExternalId,
    posterPath,
    now
  })

  return {
    catalogItemId,
    createdItem: additions.createItem,
    createdEpisodes,
    linkedSources,
    changedFields: changes.filter(change => applied(change)).length,
    updatedFields: changes.filter(change => change.action === 'update').length,
    preservedFields: changes.filter(change => change.action === 'preserve_manual' || change.action === 'retain_missing').length,
    posterPath
  }
}

export { writeCatalogImport }
