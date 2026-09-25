import { describe, expect, it, vi } from 'vitest'
import { fetchSourceJson } from '../source-http.ts'

const now = () => new Date('2026-09-24T10:00:00Z')

const request = {
  provider: 'tmdb',
  url: 'https://api.themoviedb.org/3/movie/603',
  token: 'private-token',
  maxBytes: 1024
} as const

describe('import source HTTP boundary', () => {
  it.each([404, 401, 403])('checks HTTP %i before parsing the body and does not retry', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('not JSON', { status }))

    await expect(fetchSourceJson(request, { fetch: fetcher })).rejects.toMatchObject({
      temporary: false,
      cause: new Error(`tmdb returned HTTP ${status} for ${request.url}`)
    })

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects a redirect without following its location or parsing its body', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('not JSON', {
      status: 302,
      headers: { Location: 'https://untrusted.test/record' }
    }))

    await expect(fetchSourceJson(request, { fetch: fetcher })).rejects.toMatchObject({
      code: 'source_invalid',
      temporary: false,
      cause: new Error(`tmdb returned HTTP 302 for ${request.url}`)
    })

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe('manual')
  })

  it('honors Retry-After and stops after three attempts', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('slow down', {
      status: 429,
      headers: { 'Retry-After': '2' }
    }))

    const sleep = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue()

    await expect(fetchSourceJson(request, {
      fetch: fetcher,
      sleep
    })).rejects.toMatchObject({
      temporary: true,
      retryAfterSeconds: 2
    })

    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls).toStrictEqual([[2000], [2000]])
  })

  it('returns long HTTP-date Retry-After without retrying too soon', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', {
      status: 429,
      headers: { 'Retry-After': 'Thu, 24 Sep 2026 10:01:00 GMT' }
    }))

    const sleep = vi.fn<(milliseconds: number) => Promise<void>>()

    await expect(fetchSourceJson(request, {
      fetch: fetcher,
      sleep,
      now
    })).rejects.toMatchObject({ retryAfterSeconds: 60 })

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries 5xx and returns the successful response', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ id: 603 }))

    const sleep = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue()

    await expect(fetchSourceJson(request, {
      fetch: fetcher,
      sleep
    })).resolves.toStrictEqual({ id: 603 })

    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('bounds timeouts and sends credentials only in headers', async () => {
    const error = new DOMException('source timed out', 'TimeoutError')
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(error)
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue()
    const timeout = vi.spyOn(AbortSignal, 'timeout')

    try {
      await expect(fetchSourceJson(request, {
        fetch: fetcher,
        sleep
      })).rejects.toMatchObject({
        temporary: true,
        cause: error
      })

      expect(fetcher).toHaveBeenCalledTimes(3)
      expect(timeout).toHaveBeenCalledTimes(3)
      expect(timeout).toHaveBeenCalledWith(10_000)
      expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
      expect(fetcher.mock.calls[0]?.[0]).not.toContain('private-token')

      const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers)

      expect(headers.get('Authorization')).toBe('Bearer private-token')
    } finally {
      timeout.mockRestore()
    }
  })

  it('blocks a malformed successful response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('not JSON'))

    await expect(fetchSourceJson(request, { fetch: fetcher })).rejects.toMatchObject({
      code: 'source_invalid',
      temporary: false
    })

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('blocks a valid JSON response that exceeds the byte limit', async () => {
    const body = JSON.stringify({ padding: 'x'.repeat(1025) })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body))

    await expect(fetchSourceJson(request, { fetch: fetcher })).rejects.toMatchObject({
      code: 'source_invalid',
      temporary: false
    })

    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
