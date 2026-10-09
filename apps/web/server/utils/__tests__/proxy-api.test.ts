import { createApiTargetUrl, proxyApiRequest } from '../proxy-api.ts'

import type {
  getRequestURL as h3GetRequestURL,
  getProxyRequestHeaders as h3GetProxyRequestHeaders,
  sendProxy as h3SendProxy,
  H3Event,
  proxyRequest as h3ProxyRequest,
  setResponseHeader as h3SetResponseHeader,
  setResponseStatus as h3SetResponseStatus
} from 'h3'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requestId = '01991a00-0000-7000-8000-000000000001'

const {
  getRequestURL,
  getProxyRequestHeaders,
  sendProxy,
  proxyRequest,
  setResponseHeader,
  setResponseStatus
} = vi.hoisted(() => {
  return {
    getRequestURL: vi.fn<typeof h3GetRequestURL>(),
    getProxyRequestHeaders: vi.fn<typeof h3GetProxyRequestHeaders>(),
    sendProxy: vi.fn<typeof h3SendProxy>(),
    proxyRequest: vi.fn<typeof h3ProxyRequest>(),
    setResponseHeader: vi.fn<typeof h3SetResponseHeader>(),
    setResponseStatus: vi.fn<typeof h3SetResponseStatus>()
  }
})

vi.mock(import('h3'), () => {
  return {
    getRequestURL,
    getProxyRequestHeaders,
    sendProxy,
    proxyRequest,
    setResponseHeader,
    setResponseStatus
  }
})

const {
  proxyAuthRequest
} = await import('../proxy-auth.ts')

describe('api proxy authentication', () => {
  beforeEach(() => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(requestId)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetAllMocks()
  })

  describe(createApiTargetUrl, () => {
    it('preserves the canonical path and query on the local API origin', () => {
      const targetUrl = createApiTargetUrl(
        new URL('http://127.0.0.1:3001/api/auth/session?fresh=true'),
        true
      )

      expect(targetUrl.href).toBe('http://127.0.0.1:8788/api/auth/session?fresh=true')
    })

    it('preserves the canonical URL outside Nuxt development', () => {
      const targetUrl = createApiTargetUrl(
        new URL('https://tv.example.com/api/auth/session?fresh=true'),
        false
      )

      expect(targetUrl.href).toBe('https://tv.example.com/api/auth/session?fresh=true')
    })
  })

  describe(proxyAuthRequest, () => {
    it('uses the service binding without rewriting the path or query', async () => {
      const fetch = vi.fn()

      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Mocked h3 helpers only use this event identity and context.
      const event = { context: {} } as H3Event
      const serviceResponse = { user: null }

      event.context.cloudflare = {
        env: {
          API: { fetch }
        }
      }

      getRequestURL.mockReturnValue(
        new URL('https://tv.example.com/api/auth/session?fresh=true')
      )

      proxyRequest.mockResolvedValue(serviceResponse)

      const result = await proxyAuthRequest(event, false)
      const [proxyCall] = proxyRequest.mock.calls

      expect(result).toBe(serviceResponse)
      expect(proxyCall?.[0]).toBe(event)
      expect(proxyCall?.[1]).toBe('https://tv.example.com/api/auth/session?fresh=true')
      expect(proxyCall?.[2]?.streamRequest).toBe(true)
      expect(typeof proxyCall?.[2]?.fetch).toBe('function')
    })

    it('uses the local API origin in development without a service binding', async () => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Mocked h3 helpers only use this event identity and context.
      const event = { context: {} } as H3Event
      const localResponse = { user: null }

      getRequestURL.mockReturnValue(
        new URL('http://127.0.0.1:3001/api/auth/session?fresh=true')
      )

      proxyRequest.mockResolvedValue(localResponse)

      const result = await proxyAuthRequest(event, true)

      expect(result).toBe(localResponse)

      expect(proxyRequest).toHaveBeenCalledWith(
        event,
        'http://127.0.0.1:8788/api/auth/session?fresh=true',
        {
          headers: { 'X-Request-ID': requestId },
          streamRequest: true
        }
      )
    })

    it('returns a safe response when the production service binding is missing', async () => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Mocked h3 helpers only use this event identity and context.
      const event = { context: {} } as H3Event

      getRequestURL.mockReturnValue(new URL('https://tv.example.com/api/auth/session'))

      const consoleError = vi.spyOn(console, 'error').mockReturnValue()
      const result = await proxyAuthRequest(event, false)

      expect(result).toStrictEqual({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Authentication is temporarily unavailable.'
        }
      })

      expect(proxyRequest).not.toHaveBeenCalled()
      expect(setResponseStatus).toHaveBeenCalledWith(event, 503)
      expect(setResponseHeader).toHaveBeenCalledWith(event, 'Cache-Control', 'no-store')

      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('API service binding is unavailable')
      )
    })

    it('returns a safe response and logs the raw service binding failure', async () => {
      const rootError = new Error('connection refused')
      const bindingError = new Error('Network connection lost', { cause: rootError })
      const fetch = vi.fn()

      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Mocked h3 helpers only use this event identity and context.
      const event = { context: {} } as H3Event

      event.context.cloudflare = {
        env: {
          API: { fetch }
        }
      }

      getRequestURL.mockReturnValue(new URL('https://tv.example.com/api/auth/session'))
      proxyRequest.mockRejectedValue(bindingError)

      const consoleError = vi.spyOn(console, 'error').mockReturnValue()
      const result = await proxyAuthRequest(event, false)

      expect(result).toStrictEqual({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Authentication is temporarily unavailable.'
        }
      })

      expect(setResponseStatus).toHaveBeenCalledWith(event, 503)
      expect(setResponseHeader).toHaveBeenCalledWith(event, 'Cache-Control', 'no-store')
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('connection refused'))
      expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('Network connection lost'))
    })
  })
})

describe('catalog proxy', () => {
  beforeEach(() => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(requestId)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetAllMocks()
  })

  it('preserves the ordinary DELETE transport for Nitro development context', async () => {
    const url = new URL('http://localhost:3000/api/catalog/items/movie/viewings/viewing')
    const original = new Request(url)

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- h3 transport is mocked; the fixture represents Nitro's development context.
    const event = { context: {} } as H3Event

    event.context.cloudflare = { request: original }

    Object.defineProperty(event, 'method', { value: 'DELETE' })

    const upstream = { summary: { completedCount: 0 } }

    getRequestURL.mockReturnValue(url)
    proxyRequest.mockResolvedValue(upstream)

    const result = await proxyApiRequest(event, {
      message: 'Unavailable.',
      logContext: 'test proxy'
    }, true)

    expect(result).toBe(upstream)

    expect(proxyRequest).toHaveBeenCalledWith(event, 'http://127.0.0.1:8788/api/catalog/items/movie/viewings/viewing', {
      headers: { 'X-Request-ID': requestId },
      streamRequest: true
    })

    expect(sendProxy).not.toHaveBeenCalled()
  })

  it('forwards the real Cloudflare DELETE body and request headers', async () => {
    const url = new URL('https://tv.example.com/api/catalog/items/movie/viewings/viewing')
    const body = JSON.stringify({ revision: 2 })

    const original = new Request(url, {
      method: 'DELETE',
      body
    })

    const fetch = vi.fn()

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Mocked h3 consumes only the method and Cloudflare platform context.
    const event = { context: {} } as H3Event

    event.context.cloudflare = {
      request: original,
      env: { API: { fetch } }
    }

    Object.defineProperty(event, 'method', { value: 'DELETE' })

    const upstream = { summary: { completedCount: 0 } }

    getRequestURL.mockReturnValue(url)

    getProxyRequestHeaders.mockReturnValue({
      cookie: 'session=private',
      'content-type': 'application/json'
    })

    sendProxy.mockResolvedValue(upstream)

    const result = await proxyApiRequest(event, {
      message: 'Unavailable.',
      logContext: 'test proxy'
    }, false)

    const options = sendProxy.mock.calls[0]?.[2]?.fetchOptions

    expect(result).toBe(upstream)
    expect(proxyRequest).not.toHaveBeenCalled()
    expect(options?.method).toBe('DELETE')
    expect(options?.body).toBe(original.body)
    expect(options?.headers).toBeInstanceOf(Headers)

    const headers = new Headers(options?.headers)

    expect(headers.get('cookie')).toBe('session=private')
    expect(headers.get('X-Request-ID')).toBe(requestId)
  })

  it.each([[true, 'http://127.0.0.1:8788'], [false, 'https://tv.example.com']] as const)('preserves the event, query and upstream response in development=%s', async (development, origin) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- h3 transport is mocked; only event identity and the binding context are used.
    const event = { context: {} } as H3Event

    event.context.cloudflare = { env: { API: { fetch: vi.fn() } } }

    const response = { items: [] }

    getRequestURL.mockReturnValue(new URL('https://tv.example.com/api/catalog/releases?from=2026-10-01&to=2026-10-31&titleLocale=en'))
    proxyRequest.mockResolvedValue(response)

    const result = await proxyApiRequest(event, {
      message: 'Catalog search is temporarily unavailable.',
      logContext: 'catalog service binding request failed'
    }, development)

    expect(result).toBe(response)
    expect(proxyRequest.mock.calls[0]?.[0]).toBe(event)
    expect(proxyRequest.mock.calls[0]?.[1]).toBe(`${origin}/api/catalog/releases?from=2026-10-01&to=2026-10-31&titleLocale=en`)
  })

  it.each([true, false])('returns a safe catalog message and logs the raw cause in development=%s', async (development) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- h3 transport is mocked; only event identity and the binding context are used.
    const event = { context: {} } as H3Event

    event.context.cloudflare = { env: { API: { fetch: vi.fn() } } }

    getRequestURL.mockReturnValue(new URL('https://tv.example.com/api/catalog/search?query=Dark'))
    proxyRequest.mockRejectedValue(new Error('wrapper', { cause: new Error('raw connection failure') }))

    const log = vi.spyOn(console, 'error').mockReturnValue()

    const result = await proxyApiRequest(event, {
      message: 'Catalog search is temporarily unavailable.',
      logContext: 'catalog service binding request failed'
    }, development)

    expect(result).toStrictEqual({ error: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Catalog search is temporarily unavailable.'
    } })

    expect(setResponseStatus).toHaveBeenCalledWith(event, 503)
    expect(setResponseHeader).toHaveBeenCalledWith(event, 'Cache-Control', 'no-store')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('raw connection failure'))
    expect(log).toHaveBeenCalledWith(expect.stringContaining('catalog service binding request failed'))
    expect(log).toHaveBeenCalledWith(expect.stringContaining(requestId))
    expect(setResponseHeader).toHaveBeenCalledWith(event, 'X-Request-ID', requestId)
  })
})
