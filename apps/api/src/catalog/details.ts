import type { CatalogDetailsItem, CatalogSourceLink } from '@tv/shared/catalog'
import * as v from 'valibot'
import { CatalogHttpError } from './errors.ts'
import { createCatalogSearchItems, getLocaleFallbacks } from './search.ts'
import type { CatalogDetailsRows } from './types.ts'

const catalogItemIdSchema = v.pipe(v.string(), v.uuid())

function validateCatalogItemId(value: string): string {
  if (!v.is(catalogItemIdSchema, value)) {
    throw new CatalogHttpError('INVALID_REQUEST', 400, {
      fields: { id: 'Use a valid catalog item UUID.' }
    })
  }

  return value
}

function createCatalogDetailsItem(
  rows: CatalogDetailsRows,
  requestedLocale: string
): CatalogDetailsItem | null {
  const [summary] = createCatalogSearchItems(rows.titles, requestedLocale)

  if (summary === undefined) {
    return null
  }

  const availableLocales = rows.descriptions.map(row => row.locale)
  const locales = getLocaleFallbacks(requestedLocale, availableLocales)
  const originalLanguageFallbacks = getLocaleFallbacks(summary.originalTitleLocale, availableLocales)

  for (const locale of originalLanguageFallbacks) {
    if (!locales.includes(locale)) {
      locales.push(locale)
    }
  }

  let description: string | null = null
  let descriptionLocale: string | null = null

  for (const locale of locales) {
    const row = rows.descriptions.find(candidate => candidate.locale === locale)
    const candidateDescription = row?.description.trim()

    if (candidateDescription !== undefined && candidateDescription !== '') {
      description = candidateDescription
      descriptionLocale = locale

      break
    }
  }

  const sources: CatalogSourceLink[] = []

  for (const link of rows.sourceLinks ?? []) {
    if (link.provider === 'tmdb' && (link.entityType === 'movie' || link.entityType === 'tv')) {
      sources.push({
        provider: 'tmdb',
        url: `https://www.themoviedb.org/${link.entityType}/${link.externalId}`
      })
    }

    if (link.provider === 'tvmaze' && link.entityType === 'show') {
      sources.push({
        provider: 'tvmaze',
        url: `https://www.tvmaze.com/shows/${link.externalId}`
      })
    }
  }

  return {
    id: summary.id,
    title: summary.title,
    titleLocale: summary.titleLocale,
    originalTitle: summary.originalTitle,
    originalTitleLocale: summary.originalTitleLocale,
    releaseYear: summary.releaseYear,
    type: summary.type,
    description,
    descriptionLocale,
    posterUrl: rows.titles[0]?.posterPath ?? null,
    ...(sources.length > 0 ? { sources } : {})
  }
}

export { createCatalogDetailsItem, validateCatalogItemId }
