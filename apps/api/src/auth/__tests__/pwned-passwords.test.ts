import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPasswordCompromised, PwnedPasswordsUnavailableError } from '../pwned-passwords.ts'

const PASSWORD_HASH_SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8'
const PADDED_HASH_SUFFIX = '00000000000000000000000000000000000'

describe(isPasswordCompromised, () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('uses only the SHA-1 prefix and asks HIBP for padding', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(`${PASSWORD_HASH_SUFFIX}:3303003\r\n${PADDED_HASH_SUFFIX}:0`)
    )

    const compromised = await isPasswordCompromised('password', fetchImplementation)
    const requestUrl = fetchImplementation.mock.calls[0]?.[0]
    const requestOptions = fetchImplementation.mock.calls[0]?.[1]

    expect(compromised).toBe(true)
    expect(requestUrl).toBe('https://api.pwnedpasswords.com/range/5BAA6')
    expect(requestOptions?.headers).toStrictEqual({
      'Add-Padding': 'true'
    })
  })

  it('returns false for a valid response without the suffix', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(`${PADDED_HASH_SUFFIX}:0`)
    )

    await expect(
      isPasswordCompromised('password', fetchImplementation)
    ).resolves.toBe(false)
  })

  it('accepts a valid range response larger than 64 KiB', async () => {
    const responseBody = Array.from(
      { length: 2048 },
      () => `${PADDED_HASH_SUFFIX}:0`
    ).join('\r\n')

    expect(responseBody.length).toBeGreaterThan(64 * 1024)

    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(responseBody)
    )

    await expect(
      isPasswordCompromised('password', fetchImplementation)
    ).resolves.toBe(false)
  })

  it('fails closed with the empty-response technical message', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('\r\n')
    )

    await expect(
      isPasswordCompromised('password', fetchImplementation)
    ).rejects.toMatchObject({
      message: 'HIBP returned an empty response',
      name: 'PwnedPasswordsUnavailableError'
    })
  })

  it('fails closed with the malformed-response technical message', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('not-a-hash:1')
    )

    await expect(
      isPasswordCompromised('password', fetchImplementation)
    ).rejects.toMatchObject({
      message: 'HIBP returned a malformed response',
      name: 'PwnedPasswordsUnavailableError'
    })
  })

  it('cancels and fails closed for an oversized chunked response', async () => {
    const cancel = vi.fn()

    const responseBody = new ReadableStream<Uint8Array>({
      cancel,

      start(controller) {
        controller.enqueue(new Uint8Array(257 * 1024))
      }
    })

    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(responseBody)
    )

    await expect(
      isPasswordCompromised('password', fetchImplementation)
    ).rejects.toBeInstanceOf(PwnedPasswordsUnavailableError)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('aborts HIBP after two seconds and fails closed', async () => {
    vi.useFakeTimers()

    // oxlint-disable-next-line typescript/promise-function-async -- The mock exposes a pending promise controlled by AbortSignal.
    const fetchImplementation = vi.fn<typeof fetch>((_input, options) => (
      // oxlint-disable-next-line promise/avoid-new -- The test needs a request that only rejects when aborted.
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    ))

    const request = isPasswordCompromised('password', fetchImplementation)

    // oxlint-disable-next-line vitest/valid-expect -- The assertion is awaited after the timeout is advanced.
    const rejection = expect(request).rejects.toBeInstanceOf(
      PwnedPasswordsUnavailableError
    )

    await vi.waitFor(() => {
      expect(fetchImplementation).toHaveBeenCalledTimes(1)
    })
    await vi.advanceTimersByTimeAsync(2e3)
    await rejection
  })

  it('aborts a stalled HIBP response body after two seconds and fails closed', async () => {
    vi.useFakeTimers()

    // oxlint-disable-next-line typescript/promise-function-async -- The mock resolves headers immediately while leaving the response body pending.
    const fetchImplementation = vi.fn<typeof fetch>((_input, options) => {
      const responseBody = new ReadableStream<Uint8Array>({
        start(controller) {
          options?.signal?.addEventListener('abort', () => {
            controller.error(new DOMException('aborted', 'AbortError'))
          })
        }
      })

      return Promise.resolve(new Response(responseBody))
    })

    const request = isPasswordCompromised('password', fetchImplementation)

    // oxlint-disable-next-line vitest/valid-expect -- The assertion is awaited after the timeout is advanced.
    const rejection = expect(request).rejects.toBeInstanceOf(
      PwnedPasswordsUnavailableError
    )

    await vi.waitFor(() => {
      expect(fetchImplementation).toHaveBeenCalledTimes(1)
    })
    await vi.advanceTimersByTimeAsync(2e3)
    await rejection
  })
})
