import type { CatalogReleaseItem } from '@tv/shared/catalog'
import * as v from 'valibot'
import { CatalogHttpError } from './errors.ts'
import { getLocaleFallbacks } from './search.ts'
import type { CatalogReleaseRange, CatalogReleaseRow } from './types.ts'

const DATE_PATTERN = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u
const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000
const MAX_RELEASE_RANGE_DAYS = 366
const INVALID_DATE_MESSAGE = 'Use a valid calendar date in YYYY-MM-DD format.'
const REVERSED_RANGE_MESSAGE = 'Use a date on or after from.'
const RANGE_TOO_LONG_MESSAGE = `Use a range of ${MAX_RELEASE_RANGE_DAYS} days or fewer.`

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function isCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value)

  if (match?.groups === undefined) {
    return false
  }

  const year = Number(match.groups.year)
  const month = Number(match.groups.month)
  const day = Number(match.groups.day)

  if (year === 0 || month < 1 || month > 12) {
    return false
  }

  const standardMaximum = DAYS_PER_MONTH[month - 1]

  const maximum = month === 2 && isLeapYear(year)
    ? 29
    : standardMaximum

  return maximum !== undefined && day >= 1 && day <= maximum
}

function getReleaseRangeDayCount(range: CatalogReleaseRange): number {
  const fromTime = Date.parse(`${range.from}T00:00:00Z`)
  const toTime = Date.parse(`${range.to}T00:00:00Z`)

  return ((toTime - fromTime) / MILLISECONDS_PER_DAY) + 1
}

const calendarDateSchema = v.pipe(
  v.string(INVALID_DATE_MESSAGE),
  v.check(isCalendarDate, INVALID_DATE_MESSAGE)
)

const catalogReleaseRangeSchema = v.pipe(
  v.object({
    from: calendarDateSchema,
    to: calendarDateSchema
  }),
  v.forward(
    v.partialCheck(
      [['from'], ['to']],
      range => !isCalendarDate(range.from)
        || !isCalendarDate(range.to)
        || range.from <= range.to,
      REVERSED_RANGE_MESSAGE
    ),
    ['to']
  ),
  v.forward(
    v.partialCheck(
      [['from'], ['to']],
      range => !isCalendarDate(range.from)
        || !isCalendarDate(range.to)
        || getReleaseRangeDayCount(range) <= MAX_RELEASE_RANGE_DAYS,
      RANGE_TOO_LONG_MESSAGE
    ),
    ['to']
  )
)

function validateCatalogReleaseRange(
  fromValue: string | null,
  toValue: string | null
): CatalogReleaseRange {
  const result = v.safeParse(catalogReleaseRangeSchema, {
    from: fromValue,
    to: toValue
  })

  if (result.success) {
    return result.output
  }

  const fields: Record<string, string> = {}

  for (const issue of result.issues) {
    const field = v.getDotPath(issue)

    if (field === 'from' || field === 'to') {
      fields[field] = issue.message
    }
  }

  throw new CatalogHttpError('INVALID_REQUEST', 400, { fields })
}

function createCatalogReleaseItems(
  rows: CatalogReleaseRow[],
  requestedLocale: string
): CatalogReleaseItem[] {
  const rowsByRelease = new Map<string, CatalogReleaseRow[]>()

  for (const row of rows) {
    const releaseRows = rowsByRelease.get(row.releaseId)

    if (releaseRows === undefined) {
      rowsByRelease.set(row.releaseId, [row])
    } else {
      releaseRows.push(row)
    }
  }

  const localeFallbacks = getLocaleFallbacks(requestedLocale)
  const items: CatalogReleaseItem[] = []

  for (const [releaseId, releaseRows] of rowsByRelease) {
    const originalTitle = releaseRows.find(row => row.isOriginal)

    if (originalTitle === undefined) {
      throw new Error(`Catalog release ${releaseId} has no original title`)
    }

    let displayTitle = originalTitle

    for (const locale of localeFallbacks) {
      const localizedTitle = releaseRows.find(row => row.locale === locale)

      if (localizedTitle !== undefined) {
        displayTitle = localizedTitle

        break
      }
    }

    items.push({
      episodeNumber: originalTitle.episodeNumber,
      id: originalTitle.catalogItemId,
      originalTitle: originalTitle.title,
      originalTitleLocale: originalTitle.locale,
      posterUrl: originalTitle.posterPath,
      releaseDate: originalTitle.releaseDate,
      releaseId,
      releaseYear: originalTitle.releaseYear,
      seasonNumber: originalTitle.seasonNumber,
      title: displayTitle.title,
      titleLocale: displayTitle.locale,
      type: originalTitle.type
    })
  }

  return items
}

export {
  createCatalogReleaseItems,
  validateCatalogReleaseRange
}
