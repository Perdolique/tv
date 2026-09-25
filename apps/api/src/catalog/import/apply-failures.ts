import type { PreviewIssue } from '@tv/database/import-preview'
import { findRootCause, serializeError } from '@tv/shared/errors'

const FAILURES = {
  preview_unavailable: 'This preview is unavailable or has expired. Review the import again.',
  preview_not_ready: 'This preview has issues and cannot be applied.',
  preview_version: 'This preview needs to be reviewed again.',
  preview_changed: 'This preview is no longer valid. Review the import again.',
  catalog_changed: 'The catalog changed after this preview. Review the import again.',
  access_revoked: 'You no longer have access to catalog imports.',
  conflict: 'The selected source or episode now belongs to another title. Review the import again.',
  interrupted: 'The previous attempt was interrupted. You can retry it explicitly.',
  poster_failed: 'The poster could not be saved. You can retry this preview.',
  apply_failed: 'The import could not be completed. You can retry this preview.'
} as const

type FailureCode = keyof typeof FAILURES

class ImportApplyFailureError extends Error {
  readonly code: FailureCode
  readonly retryable: boolean

  constructor(code: FailureCode, retryable = false) {
    super(FAILURES[code])

    this.name = 'ImportApplyFailureError'
    this.code = code
    this.retryable = retryable
  }
}

function issue(code: FailureCode): PreviewIssue {
  return {
    code,
    message: FAILURES[code]
  }
}

function isFailureCode(code: string): code is FailureCode {
  return Object.hasOwn(FAILURES, code)
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(entry => canonical(entry))
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
    const sortedEntries = entries.toSorted(([first], [second]) => first.localeCompare(second))
    const canonicalEntries = sortedEntries.map(([key, entry]) => [key, canonical(entry)])

    return Object.fromEntries(canonicalEntries)
  }

  return value
}

function sameData(first: unknown, second: unknown): boolean {
  const firstCanonical = canonical(first)
  const secondCanonical = canonical(second)
  const firstJson = JSON.stringify(firstCanonical)
  const secondJson = JSON.stringify(secondCanonical)

  return firstJson === secondJson
}

function postgresErrorCode(error: unknown): string | null {
  let current = error

  for (let depth = 0; depth < 5; depth += 1) {
    if (current === null || typeof current !== 'object') {
      return null
    }

    if ('code' in current && typeof current.code === 'string' && /^\d{5}$/u.test(current.code)) {
      return current.code
    }

    current = 'cause' in current ? current.cause : null
  }

  return null
}

function logApplyFailure(error: unknown, operationId: string): void {
  const rootCause = findRootCause(error)
  const technicalError = serializeError(rootCause)

  const entry = JSON.stringify({
    message: 'catalog import apply failed',
    operationId,
    error: technicalError
  })

  // oxlint-disable-next-line eslint/no-console -- Technical causes stay in private Worker diagnostics.
  console.error(entry)
}

function classifyFailure(error: unknown, phase: 'poster' | 'catalog'): ImportApplyFailureError {
  if (error instanceof ImportApplyFailureError) {
    return error
  }

  const code = postgresErrorCode(error)

  if (code === '23505' || code === '23P01' || code === '40001') {
    return new ImportApplyFailureError('conflict')
  }

  if (phase === 'poster') {
    return new ImportApplyFailureError('poster_failed', true)
  }

  return new ImportApplyFailureError('apply_failed', true)
}

export { FAILURES, ImportApplyFailureError, classifyFailure, isFailureCode, issue, logApplyFailure, sameData }
export type { FailureCode }
