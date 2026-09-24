import type { Buffer } from 'node:buffer'
import { setTimeout } from 'node:timers/promises'
import { readLimitedBody, SourceBodyError } from './source-body.ts'

type SourceProvider = 'tmdb' | 'tvmaze' | 'poster' | 'images'
type SourceFailureCode = 'source_unavailable' | 'source_not_found' | 'source_unauthorized' | 'source_invalid' | 'poster_failed'

interface SourceErrorDetails {
  cause: unknown;
  temporary?: boolean;
  retryAfterSeconds?: number | null;
}

class ImportSourceError extends Error {
  readonly provider: SourceProvider
  readonly code: SourceFailureCode
  readonly temporary: boolean
  readonly retryAfterSeconds: number | null

  constructor(provider: SourceProvider, code: SourceFailureCode, details: SourceErrorDetails) {
    super('The selected source could not be prepared.', { cause: details.cause })

    this.name = 'ImportSourceError'
    this.provider = provider
    this.code = code
    this.temporary = details.temporary ?? false
    this.retryAfterSeconds = details.retryAfterSeconds ?? null
  }
}

interface SourceHttpOptions {
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
}

interface SourceRequest {
  provider: SourceProvider;
  url: string;
  token?: string;
  maxBytes: number;
}

function retryAfterMilliseconds(value: string | null, now: Date): number | null {
  if (value === null) {
    return null
  }

  const seconds = Number(value)

  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000
  }

  const date = Date.parse(value)

  return Number.isFinite(date) ? Math.max(0, date - now.getTime()) : null
}

function httpFailureCode(status: number): SourceFailureCode {
  if (status === 404) {
    return 'source_not_found'
  }

  if (status === 401 || status === 403) {
    return 'source_unauthorized'
  }

  return status === 429 || status >= 500 ? 'source_unavailable' : 'source_invalid'
}

async function requestSourceBytes(request: SourceRequest, options: SourceHttpOptions): Promise<Buffer> {
  const fetcher = options.fetch ?? fetch
  const headers = new Headers()

  if (request.token !== undefined) {
    headers.set('Authorization', `Bearer ${request.token}`)
  }

  const signal = AbortSignal.timeout(10_000)

  const response = await fetcher(request.url, {
    headers,

    // Workers does not support "error"; the status check below rejects redirects.
    redirect: 'manual',
    signal
  })

  if (!response.ok) {
    const now = options.now?.() ?? new Date()
    const retryAfter = response.headers.get('retry-after')
    const retryDelay = retryAfterMilliseconds(retryAfter, now)
    const code = httpFailureCode(response.status)
    const message = `${request.provider} returned HTTP ${response.status} for ${request.url}`
    const cause = new Error(message)
    const retryAfterSeconds = retryDelay === null ? null : Math.ceil(retryDelay / 1000)

    await response.body?.cancel()

    throw new ImportSourceError(request.provider, code, {
      cause,
      temporary: code === 'source_unavailable',
      retryAfterSeconds
    })
  }

  try {
    return await readLimitedBody(response, request.maxBytes)
  } catch (error) {
    if (error instanceof SourceBodyError) {
      throw new ImportSourceError(request.provider, 'source_invalid', { cause: error })
    }

    throw error
  }
}

// Bounds attempts, body size and the complete HTTP exchange, including body reads.
async function fetchSourceBytes(request: SourceRequest, options: SourceHttpOptions = {}): Promise<Buffer> {
  const sleep = options.sleep ?? setTimeout

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- A retry must wait for the previous attempt.
      return await requestSourceBytes(request, options)
    } catch (error) {
      const failure = error instanceof ImportSourceError ? error : new ImportSourceError(request.provider, 'source_unavailable', {
        cause: error,
        temporary: true
      })

      const delay = failure.retryAfterSeconds === null ? 250 * (attempt + 1) : failure.retryAfterSeconds * 1000

      if (!failure.temporary || attempt === 2 || delay > 5000) {
        throw failure
      }

      // oxlint-disable-next-line eslint/no-await-in-loop -- Honor source backoff before the next attempt.
      await sleep(delay)
    }
  }

  throw new Error('Source retry limit reached')
}

async function fetchSourceJson(request: SourceRequest, options: SourceHttpOptions = {}): Promise<unknown> {
  const bytes = await fetchSourceBytes(request, options)

  try {
    const text = bytes.toString('utf8')

    return JSON.parse(text)
  } catch (error) {
    throw new ImportSourceError(request.provider, 'source_invalid', { cause: error })
  }
}

export { fetchSourceBytes, fetchSourceJson, ImportSourceError }
export type { SourceHttpOptions, SourceProvider }
