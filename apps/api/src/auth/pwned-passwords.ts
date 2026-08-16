import * as v from 'valibot'
import { hashSha1 } from './hashing.ts'

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/'
const HIBP_RESPONSE_SIZE_LIMIT = 64 * 1024
const HIBP_TIMEOUT_MILLISECONDS = 2e3
const HIBP_LINE_PATTERN = /^[0-9A-F]{35}:\d+$/u
const HIBP_EMPTY_RESPONSE_MESSAGE = 'HIBP returned an empty response'
const HIBP_MALFORMED_RESPONSE_MESSAGE = 'HIBP returned a malformed response'

const rangeEntrySchema = v.pipe(
  v.string(),
  v.regex(HIBP_LINE_PATTERN, HIBP_MALFORMED_RESPONSE_MESSAGE),
  v.transform((line) => {
    const separatorIndex = line.indexOf(':')

    return {
      count: Number(line.slice(separatorIndex + 1)),
      suffix: line.slice(0, separatorIndex)
    }
  })
)

const rangeResponseSchema = v.pipe(
  v.string(),
  v.transform((body) => body.split(/\r?\n/u).filter((line) => line.length > 0)),
  v.minLength(1, HIBP_EMPTY_RESPONSE_MESSAGE),
  v.array(rangeEntrySchema)
)

class PwnedPasswordsUnavailableError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options)
    this.name = 'PwnedPasswordsUnavailableError'
  }
}

interface StreamChunk {
  done: false;
  value: Uint8Array;
}

interface StreamEnd {
  done: true;
}

/**
 * Validates an untrusted result returned by a response body stream reader.
 *
 * A completed read only needs the `done` flag, while an active read must also
 * contain a byte chunk that can be counted and decoded safely.
 */
function isStreamReadResult(value: unknown): value is StreamChunk | StreamEnd {
  if (typeof value !== 'object' || value === null || !('done' in value)) {
    return false
  }

  if (value.done === true) {
    return true
  }

  return value.done === false
    && 'value' in value
    && value.value instanceof Uint8Array
}

/**
 * Validates a HIBP range response and checks whether it contains the requested
 * SHA-1 suffix with at least one known breach occurrence.
 *
 * @throws {PwnedPasswordsUnavailableError} When the response is empty or has a
 * malformed entry instead of the expected `<35 HEX>:<count>` format.
 */
function parseRangeResponse(body: string, suffix: string): boolean {
  const result = v.safeParse(rangeResponseSchema, body, { abortEarly: true })

  if (!result.success) {
    const [issue] = result.issues

    throw new PwnedPasswordsUnavailableError(issue.message)
  }

  return result.output.some((entry) => entry.suffix === suffix && entry.count > 0)
}

/**
 * Reads and decodes a response stream without buffering an unbounded payload.
 *
 * The reader is cancelled once the byte limit is exceeded and its lock is
 * always released, including when reading, validation, or decoding fails.
 *
 * @throws {PwnedPasswordsUnavailableError} When the stream result is invalid or
 * the response exceeds the configured size limit.
 */
async function readBoundedResponseBody(response: Response): Promise<string> {
  if (response.body === null) {
    return ''
  }

  const decoder = new TextDecoder()
  const reader = response.body.getReader()
  let body = ''
  let bodySize = 0

  try {
    /* oxlint-disable eslint/no-await-in-loop -- Stream chunks must be read and bounded sequentially. */
    for (;;) {
      const chunk: unknown = await reader.read()

      if (!isStreamReadResult(chunk)) {
        throw new PwnedPasswordsUnavailableError('HIBP returned an invalid response stream')
      }

      if (chunk.done) {
        body += decoder.decode()
        return body
      }

      bodySize += chunk.value.byteLength

      if (bodySize > HIBP_RESPONSE_SIZE_LIMIT) {
        await reader.cancel()
        throw new PwnedPasswordsUnavailableError('HIBP returned an oversized response')
      }

      body += decoder.decode(chunk.value, { stream: true })
    }
    /* oxlint-enable eslint/no-await-in-loop */
  } finally {
    reader.releaseLock()
  }
}

/**
 * Checks a password against the Have I Been Pwned range API using k-anonymity.
 *
 * The password is SHA-1 hashed locally. Only the first five hexadecimal hash
 * characters are sent to HIBP; the remaining suffix is matched locally against
 * the bounded and validated response. SHA-1 is required by the HIBP lookup
 * protocol and is not used here for password storage.
 *
 * The request uses response padding and a timeout. Any network, HTTP, stream,
 * or response-validation failure is reported as an unavailable HIBP check so
 * registration can fail closed instead of accepting an unchecked password.
 *
 * @param password The plaintext password to check without sending it to HIBP.
 * @param fetchImplementation Optional fetch implementation used by unit tests.
 * @returns Whether HIBP reports at least one occurrence of the password hash.
 * @throws {PwnedPasswordsUnavailableError} When HIBP cannot be checked safely.
 */
async function isPasswordCompromised(
  password: string,
  fetchImplementation?: typeof fetch
): Promise<boolean> {
  const passwordHash = await hashSha1(password)
  const prefix = passwordHash.slice(0, 5)
  const suffix = passwordHash.slice(5)
  const abortController = new AbortController()

  const timeout = setTimeout(() => {
    abortController.abort()
  }, HIBP_TIMEOUT_MILLISECONDS)

  try {
    const requestUrl = `${HIBP_RANGE_URL}${prefix}`

    const requestOptions: RequestInit = {
      headers: {
        'Add-Padding': 'true'
      },
      signal: abortController.signal
    }

    const response = fetchImplementation
      ? await fetchImplementation(requestUrl, requestOptions)
      : await globalThis.fetch(requestUrl, requestOptions)

    if (!response.ok) {
      await response.body?.cancel()
      throw new PwnedPasswordsUnavailableError(`HIBP returned HTTP ${response.status}`)
    }

    const body = await readBoundedResponseBody(response)

    return parseRangeResponse(body, suffix)
  } catch (error) {
    if (error instanceof PwnedPasswordsUnavailableError) {
      throw error
    }

    throw new PwnedPasswordsUnavailableError('HIBP request failed', {
      cause: error
    })
  } finally {
    clearTimeout(timeout)
  }
}

export {
  isPasswordCompromised,
  PwnedPasswordsUnavailableError
}
