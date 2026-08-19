import type { H3Event, setResponseHeader as h3SetResponseHeader, setResponseStatus as h3SetResponseStatus } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'

const {
  getRequestURL,
  proxyRequest,
  setResponseHeader,
  setResponseStatus
} = vi.hoisted(() => {
  return {
    getRequestURL: vi.fn(),
    proxyRequest: vi.fn(),
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
  createAuthTargetUrl,
  getAuthTargetPath,
  proxyAuthRequestAtEdge,
  proxyAuthRequest
} = await import('../proxy-auth.ts')

function assertRequest(value: unknown): asserts value is Request {
  if (!(value instanceof Request)) {
    throw new TypeError('Expected the service binding input to be a Request')
  }
}

describe('auth proxy', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetAllMocks()
  })

  describe(createAuthTargetUrl, () => {
    it('uses the local API origin during Nuxt development', () => {
      const targetUrl = createAuthTargetUrl(
        new URL('http://127.0.0.1:3001/api/auth/session?fresh=true'),
        '/auth/session',
        true
      )

      expect(targetUrl.href).toBe('http://127.0.0.1:8788/auth/session?fresh=true')
    })

    it('keeps the incoming origin outside Nuxt development', () => {
      const targetUrl = createAuthTargetUrl(
        new URL('https://tv.example.com/api/auth/session?fresh=true'),
        '/auth/session',
        false
      )

      expect(targetUrl.href).toBe('https://tv.example.com/auth/session?fresh=true')
    })
  })

  describe(getAuthTargetPath, () => {
    it.each([
      ['GET', '/api/auth/session', '/auth/session'],
      ['POST', '/api/auth/register', '/auth/register'],
      ['POST', '/api/auth/sign-in', '/auth/sign-in'],
      ['POST', '/api/auth/sign-out', '/auth/sign-out']
    ])('maps %s %s to %s', (method, path, targetPath) => {
      const request = new Request(`https://tv.example.com${path}`, { method })

      expect(getAuthTargetPath(request)).toBe(targetPath)
    })

    it('does not intercept unsupported methods or paths', () => {
      const request = new Request('https://tv.example.com/api/auth/session', {
        method: 'POST'
      })

      expect(getAuthTargetPath(request)).toBeUndefined()
    })
  })

  describe(proxyAuthRequestAtEdge, () => {
    it('streams an auth request through the service binding and preserves its response', async () => {
      const serviceResponse = Response.json({ user: null }, {
        headers: {
          'Cache-Control': 'no-store'
        }
      })

      const fetch = vi.fn<Fetcher['fetch']>().mockResolvedValue(serviceResponse)

      const request = new Request('https://tv.example.com/api/auth/sign-in?fresh=true', {
        body: JSON.stringify({
          email: 'viewer@example.com',
          password: 'correct horse battery staple'
        }),

        headers: {
          'Content-Type': 'application/json',
          Cookie: 'tv_session=session-token'
        },

        method: 'POST'
      })

      const arrayBuffer = vi.spyOn(request, 'arrayBuffer')
      const result = await proxyAuthRequestAtEdge(request, { fetch })
      const targetRequest = fetch.mock.calls[0]?.[0]

      expect(arrayBuffer).not.toHaveBeenCalled()
      assertRequest(targetRequest)

      expect(targetRequest.url).toBe('https://tv.example.com/auth/sign-in?fresh=true')
      expect(targetRequest.method).toBe('POST')
      expect(targetRequest.headers.get('Cookie')).toBe('tv_session=session-token')
      await expect(targetRequest.json()).resolves.toStrictEqual({
        email: 'viewer@example.com',
        password: 'correct horse battery staple'
      })
      expect(result).toBe(serviceResponse)
      expect(result?.headers.get('Cache-Control')).toBe('no-store')
    })

    it('returns a safe no-store response when the service binding fails', async () => {
      const rootError = new Error('connection refused')
      const bindingError = new Error('Network connection lost', { cause: rootError })
      const fetch = vi.fn<Fetcher['fetch']>().mockRejectedValue(bindingError)
      const request = new Request('https://tv.example.com/api/auth/session')
      const consoleError = vi.spyOn(globalThis.console, 'error').mockReturnValue()
      const result = await proxyAuthRequestAtEdge(request, { fetch })

      expect(result?.status).toBe(503)
      expect(result?.headers.get('Cache-Control')).toBe('no-store')
      await expect(result?.json()).resolves.toStrictEqual({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Authentication is temporarily unavailable.'
        }
      })
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('connection refused'))
      expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('Network connection lost'))
    })
  })

  describe(proxyAuthRequest, () => {
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

      const consoleError = vi.spyOn(globalThis.console, 'error').mockReturnValue()
      const result = await proxyAuthRequest(event, '/auth/session')

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
