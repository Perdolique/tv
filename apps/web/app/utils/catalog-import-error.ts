import { isRecord } from '@tv/shared/type-guards'
import * as v from 'valibot'
import { importSourceFailureResponseSchema } from './catalog-import-response.ts'

function importRequestStatus(error: unknown): number | null {
  if (!isRecord(error)) {return null}

  const status = error.statusCode ?? error.status

  return typeof status === 'number' ? status : null
}

function importRequestMessage(error: unknown, fallback: string): string {
  if (!isRecord(error) || !isRecord(error.data)) {return fallback}

  const parsed = v.safeParse(importSourceFailureResponseSchema, error.data)

  if (!parsed.success) {return fallback}

  const retry = parsed.output.retryAfterSeconds

  return retry === null
    ? parsed.output.issue.message
    : `${parsed.output.issue.message} Try again in ${retry} seconds.`
}

export { importRequestMessage, importRequestStatus }
