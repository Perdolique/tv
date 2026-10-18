import { catalogTimeZoneSchema } from '@tv/shared/catalog-timeline'
import { viewingDateSchema } from '@tv/shared/catalog-viewings'
import * as v from 'valibot'

// oxlint-disable-next-line import/no-relative-parent-imports -- Catalog cursors reuse the canonical Base64URL codec.
import { decodeBase64Url, encodeBase64Url } from '../auth/base64url.ts'
import { CatalogHttpError } from './errors.ts'

interface TimelineScope {
  userId: string;
  catalogItemId: string;
  timeZone: string;
}

interface TimelineSourcePosition {
  occurredAt: string;
  id: string;
}

interface TimelinePosition extends TimelineSourcePosition {
  localDate: string;
}

interface TimelinePageCursor extends TimelineScope {
  kind: 'timeline';
  upper: TimelineSourcePosition;
  after: TimelinePosition;
  calendarVersion: string;
  version: 4;
}

function isExactTimestamp(value: string): boolean {
  const hasTimestampFormat = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(value)

  if (!hasTimestampFormat) {
    return false
  }

  const hasZeroYear = value.startsWith('0000')

  if (hasZeroYear) {
    return false
  }

  const milliseconds = Date.parse(value)

  if (!Number.isFinite(milliseconds)) {
    return false
  }

  const date = new Date(milliseconds)
  const normalized = date.toISOString()
  const millisecondTimestamp = value.slice(0, 23)
  const expected = `${millisecondTimestamp}Z`

  return normalized === expected
}

const idSchema = v.pipe(v.string(), v.uuid())
const timestampSchema = v.pipe(v.string(), v.check(isExactTimestamp))

const sourcePositionSchema = v.strictObject({
  occurredAt: timestampSchema,
  id: idSchema
})

const positionSchema = v.strictObject({
  occurredAt: timestampSchema,
  id: v.pipe(v.string(), v.regex(/^(?:[0-9a-f-]{36}|episode_group:[0-9a-f-]{36}:\d{4}-\d{2}-\d{2})$/u)),
  localDate: viewingDateSchema
})

const cursorSchema = v.strictObject({
  userId: idSchema,
  catalogItemId: idSchema,
  timeZone: catalogTimeZoneSchema,
  kind: v.literal('timeline'),
  upper: sourcePositionSchema,
  after: positionSchema,
  calendarVersion: v.pipe(v.string(), v.regex(/^[0-9a-f]{32}$/u)),
  version: v.literal(4)
})

function invalidCursor(): CatalogHttpError {
  return new CatalogHttpError('INVALID_REQUEST', 400, {
    fields: { cursor: 'Use a valid timeline cursor for this account, title and time zone.' }
  })
}

function encodeTimelineCursor(cursor: TimelinePageCursor): string {
  const payload = JSON.stringify(cursor)
  const encoder = new TextEncoder()
  const bytes = encoder.encode(payload)

  return encodeBase64Url(bytes)
}

function readTimelinePageCursor(value: string | null, scope: TimelineScope): TimelinePageCursor | null {
  if (value === null) {
    return null
  }

  try {
    if (value.length > 4096) {
      throw invalidCursor()
    }

    const bytes = decodeBase64Url(value)

    const decoder = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: false
    })

    const payload = decoder.decode(bytes)
    const json: unknown = JSON.parse(payload)
    const parsed = v.safeParse(cursorSchema, json)
    const canonicalValue = encodeBase64Url(bytes)

    if (!parsed.success || canonicalValue !== value) {
      throw invalidCursor()
    }

    const cursor = parsed.output
    const matchesScope = cursor.userId === scope.userId && cursor.catalogItemId === scope.catalogItemId && cursor.timeZone === scope.timeZone

    if (!matchesScope) {
      throw invalidCursor()
    }

    return cursor
  } catch {
    throw invalidCursor()
  }
}

export { encodeTimelineCursor, readTimelinePageCursor }
export type { TimelinePageCursor, TimelinePosition, TimelineScope, TimelineSourcePosition }
