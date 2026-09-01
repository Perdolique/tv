import { CatalogHttpError } from './errors.ts'
import type { CatalogSearchItem, CatalogTitleRow } from './types.ts'

const DEFAULT_TITLE_LOCALE = 'en'

function normalizeCatalogQuery(value: string | null): string {
  const query = (value ?? '').trim().normalize('NFC')

  if (query.length === 0) {
    throw new CatalogHttpError('INVALID_REQUEST', 400, {
      fields: {
        query: 'Enter a search query.'
      }
    })
  }

  return query
}

function canonicalizeTitleLocale(value: string | null): string {
  const locale = value ?? DEFAULT_TITLE_LOCALE

  try {
    const canonicalLocales = Intl.getCanonicalLocales(locale)
    const [canonicalLocale] = canonicalLocales

    if (canonicalLocale === undefined) {
      throw new RangeError('A title locale is required')
    }

    return canonicalLocale
  } catch (error) {
    throw new CatalogHttpError('INVALID_REQUEST', 400, {
      cause: error,

      fields: {
        titleLocale: 'Use a valid BCP 47 locale.'
      }
    })
  }
}

function escapeLikePattern(value: string): string {
  return value
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('%', String.raw`\%`)
    .replaceAll('_', String.raw`\_`)
}

function getLocaleFallbacks(locale: string): string[] {
  const subtags = locale.split('-')
  const fallbacks = new Set<string>()
  const { length: subtagCount } = subtags

  for (let length = subtagCount; length > 0; length -= 1) {
    const candidate = subtags.slice(0, length).join('-')

    try {
      const [canonicalCandidate] = Intl.getCanonicalLocales(candidate)

      if (canonicalCandidate !== undefined) {
        fallbacks.add(canonicalCandidate)
      }
    } catch {
      // Truncated extension prefixes are not valid locales and are skipped.
    }
  }

  fallbacks.add(DEFAULT_TITLE_LOCALE)

  return [...fallbacks]
}

function compareItemIds(left: CatalogSearchItem, right: CatalogSearchItem): number {
  if (left.id === right.id) {
    return 0
  }

  return left.id < right.id ? -1 : 1
}

function createCatalogSearchItems(
  rows: CatalogTitleRow[],
  requestedLocale: string
): CatalogSearchItem[] {
  const rowsByItem = new Map<string, CatalogTitleRow[]>()

  for (const row of rows) {
    const itemRows = rowsByItem.get(row.catalogItemId)

    if (itemRows === undefined) {
      rowsByItem.set(row.catalogItemId, [row])
    } else {
      itemRows.push(row)
    }
  }

  const localeFallbacks = getLocaleFallbacks(requestedLocale)
  const items: CatalogSearchItem[] = []

  for (const [catalogItemId, itemRows] of rowsByItem) {
    const originalTitle = itemRows.find(row => row.isOriginal)

    if (originalTitle === undefined) {
      throw new Error(`Catalog item ${catalogItemId} has no original title`)
    }

    let displayTitle = originalTitle

    for (const locale of localeFallbacks) {
      const localizedTitle = itemRows.find(row => row.locale === locale)

      if (localizedTitle !== undefined) {
        displayTitle = localizedTitle

        break
      }
    }

    items.push({
      id: catalogItemId,
      originalTitle: originalTitle.title,
      originalTitleLocale: originalTitle.locale,
      releaseYear: originalTitle.releaseYear,
      title: displayTitle.title,
      titleLocale: displayTitle.locale,
      type: originalTitle.type
    })
  }

  const collator = new Intl.Collator(requestedLocale)

  items.sort((left, right) => {
    const titleComparison = collator.compare(left.title, right.title)

    return titleComparison === 0
      ? compareItemIds(left, right)
      : titleComparison
  })

  return items
}

export {
  canonicalizeTitleLocale,
  createCatalogSearchItems,
  escapeLikePattern,
  getLocaleFallbacks,
  normalizeCatalogQuery
}
