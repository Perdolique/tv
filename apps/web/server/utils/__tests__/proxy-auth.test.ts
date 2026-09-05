import { createApiTargetUrl, proxyApiRequest } from '../proxy-api.ts'

import type {
  getRequestURL as h3GetRequestURL,
  H3Event,
  proxyRequest as h3ProxyRequest,
  setResponseHeader as h3SetResponseHeader,
  setResponseStatus as h3SetResponseStatus
} from 'h3'

import { afterEach, describe, expect, it, vi } from 'vitest'

const {
  getRequestURL,
  proxyRequest,
  setResponseHeader,
  setResponseStatus
} = vi.hoisted(() => {
  return {
    getRequestURL: vi.fn<typeof h3GetRequestURL>(),
    proxyRequest: vi.fn<typeof h3ProxyRequest>(),
    setResponseHeader: vi.fn<typeof h3SetResponseHeader>(),
    setResponseStatus: vi.fn<typeof h3SetResponseStatus>()
  }
})

vi.mock(import('h3'), () => {
  return {
    getRequestURL,
    proxyRequest,
    setResponseHeader,
    setResponseStatus
  }
})

const {
  proxyAuthRequest
} = await import('../proxy-auth.ts')

describe('auth proxy', () => {
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
        { streamRequest: true }
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
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetAllMocks()
  })

  it.each([[true, 'http://127.0.0.1:8788'], [false, 'https://tv.example.com']] as const)('preserves the event, query and upstream response in development=%s', async (development, origin) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- h3 transport is mocked; only event identity and the binding context are used.
    const event = { context: {} } as H3Event

    event.context.cloudflare = { env: { API: { fetch: vi.fn() } } }

    const response = { items: [] }

    getRequestURL.mockReturnValue(new URL('https://tv.example.com/api/catalog/search?query=Dark&titleLocale=en'))
    proxyRequest.mockResolvedValue(response)

    const result = await proxyApiRequest(event, {
      message: 'Catalog search is temporarily unavailable.',
      logContext: 'catalog service binding request failed'
    }, development)

    expect(result).toBe(response)
    expect(proxyRequest.mock.calls[0]?.[0]).toBe(event)
    expect(proxyRequest.mock.calls[0]?.[1]).toBe(`${origin}/api/catalog/search?query=Dark&titleLocale=en`)
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
  })
})
