import type { CatalogViewingHistoryItem, CatalogViewingHistoryResponse } from '@tv/shared/catalog'
import * as v from 'valibot'

// oxlint-disable-next-line import/no-relative-parent-imports -- Catalog cursors reuse the canonical Base64URL codec.
import { decodeBase64Url, encodeBase64Url } from '../auth/base64url.ts'
import { CatalogHttpError } from './errors.ts'
import { createCatalogWatchlistItems } from './watchlist.ts'
import type { CatalogWatchlistRow } from './types.ts'

interface CatalogViewingCursor {
  entryId: string;
  kind: 'movie' | 'episode';
  markedAt: string;
}

interface CatalogViewingHistoryRow extends CatalogWatchlistRow, CatalogViewingCursor {
  episodeNumber: number | null;
  seasonNumber: number | null;
  sourceTitle: string | null;
}

const VIEWING_HISTORY_PAGE_SIZE = 20
const VIEWING_HISTORY_QUERY_LIMIT = VIEWING_HISTORY_PAGE_SIZE + 1
const INVALID_CURSOR_MESSAGE = 'Use a valid viewing history cursor.'
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u

function isViewingTimestamp(value: string): boolean {
  if (!timestampPattern.test(value) || value.startsWith('0000')) {
    return false
  }

  const milliseconds = Date.parse(value)

  if (!Number.isFinite(milliseconds)) {
    return false
  }

  const normalized = new Date(milliseconds).toISOString()
  const expected = `${value.slice(0, 23)}Z`

  return normalized === expected
}

const cursorSchema = v.strictObject({
  entryId: v.pipe(v.string(), v.uuid()),
  kind: v.picklist(['movie', 'episode']),
  markedAt: v.pipe(v.string(), v.check(isViewingTimestamp)),
  version: v.literal(1)
})

function encodeViewingCursor(item: CatalogViewingCursor): string {
  const payload = JSON.stringify({
    entryId: item.entryId,
    kind: item.kind,
    markedAt: item.markedAt,
    version: 1
  })

  const bytes = new TextEncoder().encode(payload)

  return encodeBase64Url(bytes)
}

function decodeViewingCursor(value: string | null): CatalogViewingCursor | null {
  if (value === null) {
    return null
  }

  try {
    if (value.length > 1024) {
      throw new Error(INVALID_CURSOR_MESSAGE)
    }

    const bytes = decodeBase64Url(value)

    const payload = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: false
    }).decode(bytes)

    const json: unknown = JSON.parse(payload)
    const parsed = v.safeParse(cursorSchema, json)

    if (!parsed.success || encodeBase64Url(bytes) !== value) {
      throw new Error(INVALID_CURSOR_MESSAGE)
    }

    return {
      entryId: parsed.output.entryId,
      kind: parsed.output.kind,
      markedAt: parsed.output.markedAt
    }
  } catch (error) {
    throw new CatalogHttpError('INVALID_REQUEST', 400, {
      cause: error,
      fields: { cursor: INVALID_CURSOR_MESSAGE }
    })
  }
}

function createViewingHistoryResponse(
  rows: CatalogViewingHistoryRow[],
  requestedLocale: string
): CatalogViewingHistoryResponse {
  const titles = createCatalogWatchlistItems(rows, requestedLocale)
  const titleEntries = titles.map(item => [item.id, item] as const)
  const titlesById = new Map(titleEntries)
  const entries = new Map<string, CatalogViewingHistoryItem>()

  for (const row of rows) {
    const key = `${row.kind}:${row.entryId}`
    const title = titlesById.get(row.catalogItemId)

    if (!entries.has(key) && title !== undefined) {
      entries.set(key, {
        id: title.id,
        originalTitle: title.originalTitle,
        originalTitleLocale: title.originalTitleLocale,
        posterUrl: title.posterUrl,
        releaseYear: title.releaseYear,
        title: title.title,
        titleLocale: title.titleLocale,
        type: title.type,
        entryId: row.entryId,
        kind: row.kind,
        markedAt: row.markedAt,
        episodeNumber: row.episodeNumber,
        seasonNumber: row.seasonNumber,
        sourceTitle: row.sourceTitle
      })
    }
  }

  const items = [...entries.values()]
  const hasMore = items.length > VIEWING_HISTORY_PAGE_SIZE
  const page = items.slice(0, VIEWING_HISTORY_PAGE_SIZE)
  const last = page.at(-1)
  const nextCursor = hasMore && last !== undefined ? encodeViewingCursor(last) : null

  return {
    items: page,
    nextCursor
  }
}

export { createViewingHistoryResponse, decodeViewingCursor, encodeViewingCursor, VIEWING_HISTORY_QUERY_LIMIT }
export type { CatalogViewingCursor, CatalogViewingHistoryRow }
