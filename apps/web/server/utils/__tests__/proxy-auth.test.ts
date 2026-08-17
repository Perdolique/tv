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

const { createAuthTargetUrl, proxyAuthRequest } = await import('../proxy-auth.ts')

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
