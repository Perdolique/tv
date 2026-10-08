import { catalogTimelineEpisodesQuerySchema, catalogTimeZoneSchema } from '@tv/shared/catalog-timeline'
import * as v from 'valibot'

// oxlint-disable-next-line import/no-relative-parent-imports -- Catalog cursors reuse the canonical Base64URL codec.
import { decodeBase64Url, encodeBase64Url } from '../auth/base64url.ts'
import { CatalogHttpError } from './errors.ts'

interface TimelineScope {
  userId: string;
  catalogItemId: string;
  timeZone: string;
}

interface TimelinePosition {
  occurredAt: string;
  id: string;
}

interface TimelineViewingPosition {
  recordedAt: string;
  id: string;
}

interface TimelineGroupScope extends TimelineScope {
  viewingId: string;
  localDate: string;
}

interface TimelinePageCursor extends TimelineScope {
  kind: 'timeline';
  upper: TimelinePosition;
  after: TimelinePosition;
  boundaryDate: string;
  oldestSeenViewing: TimelineViewingPosition | null;
  version: 1;
}

interface TimelineGroupCursor extends TimelineGroupScope {
  kind: 'group';
  upper: TimelinePosition;
  version: 1;
}

interface TimelineEpisodesCursor extends TimelineGroupScope {
  kind: 'episodes';
  upper: TimelinePosition;
  after: TimelinePosition;
  version: 1;
}

type TimelineCursor = TimelinePageCursor | TimelineGroupCursor | TimelineEpisodesCursor

function isExactTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(value) || value.startsWith('0000')) {
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

const positionSchema = v.strictObject({
  occurredAt: timestampSchema,
  id: idSchema
})

const viewingPositionSchema = v.strictObject({
  recordedAt: timestampSchema,
  id: idSchema
})

const scopeEntries = {
  userId: idSchema,
  catalogItemId: idSchema,
  timeZone: catalogTimeZoneSchema,
  upper: positionSchema,
  version: v.literal(1)
}

const groupEntries = {
  viewingId: catalogTimelineEpisodesQuerySchema.entries.viewingId,
  localDate: catalogTimelineEpisodesQuerySchema.entries.localDate
}

const cursorSchema = v.variant('kind', [
  v.strictObject({
    ...scopeEntries,
    kind: v.literal('timeline'),
    after: positionSchema,
    boundaryDate: catalogTimelineEpisodesQuerySchema.entries.localDate,
    oldestSeenViewing: v.nullable(viewingPositionSchema)
  }),
  v.strictObject({
    ...scopeEntries,
    ...groupEntries,
    kind: v.literal('group')
  }),
  v.strictObject({
    ...scopeEntries,
    ...groupEntries,
    kind: v.literal('episodes'),
    after: positionSchema
  })
])

function invalidCursor(): CatalogHttpError {
  return new CatalogHttpError('INVALID_REQUEST', 400, {
    fields: { cursor: 'Use a valid timeline cursor for this account, title and time zone.' }
  })
}

function encodeTimelineCursor(cursor: TimelineCursor): string {
  const payload = JSON.stringify(cursor)
  const encoder = new TextEncoder()
  const bytes = encoder.encode(payload)

  return encodeBase64Url(bytes)
}

function decodeTimelineCursor(value: string): TimelineCursor {
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

    if (!parsed.success || encodeBase64Url(bytes) !== value) {
      throw invalidCursor()
    }

    const cursor = parsed.output

    if ('after' in cursor) {
      const sameTime = cursor.after.occurredAt === cursor.upper.occurredAt
      const newer = cursor.after.occurredAt > cursor.upper.occurredAt || (sameTime && cursor.after.id > cursor.upper.id)

      if (newer) {
        throw invalidCursor()
      }
    }

    return cursor
  } catch {
    throw invalidCursor()
  }
}

function matchesScope(cursor: TimelineScope, scope: TimelineScope): boolean {
  return cursor.userId === scope.userId && cursor.catalogItemId === scope.catalogItemId && cursor.timeZone === scope.timeZone
}

function matchesGroup(cursor: TimelineGroupScope, scope: TimelineGroupScope): boolean {
  return matchesScope(cursor, scope) && cursor.viewingId === scope.viewingId && cursor.localDate === scope.localDate
}

function readTimelinePageCursor(value: string | null, scope: TimelineScope): TimelinePageCursor | null {
  if (value === null) {
    return null
  }

  const cursor = decodeTimelineCursor(value)

  if (cursor.kind !== 'timeline' || !matchesScope(cursor, scope)) {
    throw invalidCursor()
  }

  return cursor
}

function readTimelineGroupCursor(value: string, scope: TimelineGroupScope): TimelineGroupCursor {
  const cursor = decodeTimelineCursor(value)

  if (cursor.kind !== 'group' || !matchesGroup(cursor, scope)) {
    throw invalidCursor()
  }

  return cursor
}

function readTimelineEpisodesCursor(value: string | null, group: TimelineGroupCursor): TimelineEpisodesCursor | null {
  if (value === null) {
    return null
  }

  const cursor = decodeTimelineCursor(value)

  if (cursor.kind !== 'episodes' || !matchesGroup(cursor, group) || cursor.upper.id !== group.upper.id || cursor.upper.occurredAt !== group.upper.occurredAt) {
    throw invalidCursor()
  }

  return cursor
}

export {
  encodeTimelineCursor,
  readTimelineEpisodesCursor,
  readTimelineGroupCursor,
  readTimelinePageCursor
}

export type {
  TimelineGroupCursor,
  TimelinePageCursor,
  TimelinePosition,
  TimelineScope,
  TimelineViewingPosition
}
