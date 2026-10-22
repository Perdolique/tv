import type { CatalogViewingHistoryItem, CatalogViewingHistoryResponse, CatalogViewingStatus } from '@tv/shared/catalog'
import { catalogViewingStatusSchema, viewingDateSchema } from '@tv/shared/catalog-viewings'
import * as v from 'valibot'

// oxlint-disable-next-line import/no-relative-parent-imports -- Catalog cursors reuse the canonical Base64URL codec.
import { decodeBase64Url, encodeBase64Url } from '../auth/base64url.ts'
import { CatalogHttpError } from './errors.ts'
import { createCatalogWatchlistItems } from './watchlist.ts'
import type { CatalogWatchlistRow } from './types.ts'

interface CatalogViewingScope {
  userId: string;
  status: CatalogViewingStatus | null;
  titleLocale: string;
}

interface CatalogViewingCursor extends CatalogViewingScope {
  viewingId: string;
  calendarDate: string;
  historyVersion: string;
  version: 6;
}

interface CatalogViewingHistoryRow extends CatalogWatchlistRow {
  viewingId: string;
  status: CatalogViewingStatus;
  startedOn: string | null;
  completedOn: string | null;
  score: number | null;
}

const VIEWING_HISTORY_PAGE_SIZE = 20
const VIEWING_HISTORY_QUERY_LIMIT = VIEWING_HISTORY_PAGE_SIZE + 1
const INVALID_CURSOR_MESSAGE = 'Use a valid viewing history cursor.'

const cursorSchema = v.strictObject({
  userId: v.pipe(v.string(), v.uuid()),
  status: v.nullable(catalogViewingStatusSchema),
  titleLocale: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
  viewingId: v.pipe(v.string(), v.uuid()),
  calendarDate: viewingDateSchema,
  historyVersion: v.pipe(v.string(), v.regex(/^[0-9a-f]{32}$/u)),
  version: v.literal(6)
})

function parseViewingStatus(value: string | null): CatalogViewingStatus | null {
  if (value === null) { return null }

  const parsed = v.safeParse(catalogViewingStatusSchema, value)

  if (!parsed.success) {
    throw new CatalogHttpError('INVALID_REQUEST', 400, {
      fields: { status: 'Choose watching, paused, dropped or completed.' }
    })
  }

  return parsed.output
}

function encodeViewingCursor(cursor: CatalogViewingCursor): string {
  const payload = JSON.stringify(cursor)
  const encoder = new TextEncoder()
  const bytes = encoder.encode(payload)

  return encodeBase64Url(bytes)
}

function decodeViewingCursor(value: string | null, scope: CatalogViewingScope): CatalogViewingCursor | null {
  if (value === null) { return null }

  try {
    if (value.length > 2048) { throw new Error(INVALID_CURSOR_MESSAGE) }

    const bytes = decodeBase64Url(value)

    const decoder = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: false
    })

    const payload = decoder.decode(bytes)
    const json: unknown = JSON.parse(payload)
    const parsed = v.safeParse(cursorSchema, json)
    const canonicalValue = encodeBase64Url(bytes)

    if (!parsed.success || canonicalValue !== value) { throw new Error(INVALID_CURSOR_MESSAGE) }

    const cursor = parsed.output
    const matchesScope = cursor.userId === scope.userId && cursor.status === scope.status && cursor.titleLocale === scope.titleLocale

    if (!matchesScope) { throw new Error(INVALID_CURSOR_MESSAGE) }

    return cursor
  } catch (error) {
    throw new CatalogHttpError('INVALID_REQUEST', 400, {
      cause: error,
      fields: { cursor: INVALID_CURSOR_MESSAGE }
    })
  }
}

function createViewingHistoryResponse(
  rows: CatalogViewingHistoryRow[],
  scope: CatalogViewingScope,
  historyVersion: string
): CatalogViewingHistoryResponse {
  const titles = createCatalogWatchlistItems(rows, scope.titleLocale)
  const titleEntries = titles.map(item => [item.id, item] as const)
  const titlesById = new Map(titleEntries)
  const entries = new Map<string, CatalogViewingHistoryItem>()

  for (const row of rows) {
    const title = titlesById.get(row.catalogItemId)

    if (!entries.has(row.viewingId) && title !== undefined) {
      entries.set(row.viewingId, {
        id: title.id,
        originalTitle: title.originalTitle,
        originalTitleLocale: title.originalTitleLocale,
        posterUrl: title.posterUrl,
        releaseYear: title.releaseYear,
        title: title.title,
        titleLocale: title.titleLocale,
        type: title.type,
        viewingId: row.viewingId,
        status: row.status,
        startedOn: row.startedOn,
        completedOn: row.completedOn,
        score: row.score
      })
    }
  }

  const items = [...entries.values()]
  const page = items.slice(0, VIEWING_HISTORY_PAGE_SIZE)
  const last = page.at(-1)
  let nextCursor: string | null = null

  if (items.length > VIEWING_HISTORY_PAGE_SIZE && last !== undefined) {
    const calendarDate = last.completedOn ?? last.startedOn

    if (calendarDate === null) { throw new Error('Viewing calendar date is missing') }

    nextCursor = encodeViewingCursor({
      version: 6,
      userId: scope.userId,
      status: scope.status,
      titleLocale: scope.titleLocale,
      viewingId: last.viewingId,
      calendarDate,
      historyVersion
    })
  }

  return {
    items: page,
    nextCursor
  }
}

export { createViewingHistoryResponse, decodeViewingCursor, encodeViewingCursor, parseViewingStatus, VIEWING_HISTORY_QUERY_LIMIT }
export type { CatalogViewingCursor, CatalogViewingHistoryRow, CatalogViewingScope }
