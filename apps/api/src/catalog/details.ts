import type { CatalogDetailsItem } from '@tv/shared/catalog'
import * as v from 'valibot'
import { CatalogHttpError } from './errors.ts'
import { createCatalogSearchItems, getLocaleFallbacks } from './search.ts'
import type { CatalogDetailsRow } from './types.ts'

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
  rows: CatalogDetailsRow[],
  requestedLocale: string
): CatalogDetailsItem | null {
  const [summary] = createCatalogSearchItems(rows, requestedLocale)

  if (summary === undefined) {
    return null
  }

  const locales = getLocaleFallbacks(requestedLocale)

  locales.push(summary.originalTitleLocale)

  let description: string | null = null
  let descriptionLocale: string | null = null

  for (const locale of locales) {
    const row = rows.find(candidate => candidate.locale === locale)
    const candidateDescription = row?.description?.trim()

    if (candidateDescription !== undefined && candidateDescription !== '') {
      description = candidateDescription
      descriptionLocale = locale

      break
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
    posterUrl: rows[0]?.posterPath ?? null
  }
}

export { createCatalogDetailsItem, validateCatalogItemId }
