import {
  getRequestURL,
  getProxyRequestHeaders,
  proxyRequest,
  sendProxy,
  setResponseHeader,
  setResponseStatus,
  type H3Event
} from 'h3'

import { findRootCause, serializeError } from '@tv/shared/errors'
import { isRecord } from '@tv/shared/type-guards'

interface ApiBinding {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

interface ApiProxyOptions {
  message: string;
  logContext: string;
}

const LOCAL_API_ORIGIN = 'http://127.0.0.1:8788'

function isApiBinding(value: unknown): value is ApiBinding {
  return isRecord(value) && typeof value.fetch === 'function'
}

function getApiBinding(value: unknown): ApiBinding {
  if (!isRecord(value) || !isRecord(value.env) || !isApiBinding(value.env.API)) {
    throw new Error('API service binding is unavailable')
  }

  return value.env.API
}

function logApiProxyError(error: unknown, logContext: string, requestId: string): void {
  const technicalError = findRootCause(error)
  const serializedTechnicalError = serializeError(technicalError)

  const logEntry = JSON.stringify({
    error: serializedTechnicalError,
    message: logContext,
    requestId
  })

  // oxlint-disable-next-line eslint/no-console -- Worker logs retain the technical binding failure without exposing it to clients.
  console.error(logEntry)
}

function createApiTargetUrl(
  requestUrl: URL,
  isDevelopment: boolean
): URL {
  const targetOrigin = isDevelopment ? LOCAL_API_ORIGIN : requestUrl.origin
  const targetUrl = new URL(requestUrl.pathname, targetOrigin)

  targetUrl.search = requestUrl.search

  return targetUrl
}

interface ApiForwardOptions {
  fetch?: ApiBinding['fetch'];
  headers: Record<string, string>;
  streamRequest: boolean;
}

async function forwardApiRequest(event: H3Event, target: string, options: ApiForwardOptions): Promise<unknown> {
  const platform: unknown = event.context.cloudflare
  const original = isRecord(platform) ? platform.request : null

  // Nitro's Cloudflare adapter buffers POST, PUT and PATCH, but leaves DELETE bodies on the original Request.
  if (event.method === 'DELETE' && original instanceof globalThis.Request && original.method === 'DELETE') {
    const headers = new Headers(options.headers)
    const requestHeaders: unknown = getProxyRequestHeaders(event)

    if (isRecord(requestHeaders)) {
      const entries = Object.entries(requestHeaders)

      for (const [name, value] of entries) {
        if (typeof value === 'string' && !headers.has(name)) { headers.set(name, value) }
      }
    }

    return sendProxy(event, target, {
      ...options,

      fetchOptions: {
        method: event.method,
        body: original.body,
        duplex: 'half',
        headers
      }
    })
  }

  return proxyRequest(event, target, options)
}

async function proxyApiRequest(
  event: H3Event,
  options: ApiProxyOptions,
  isDevelopment = import.meta.dev
): Promise<unknown> {
  const requestUrl = getRequestURL(event)
  const targetUrl = createApiTargetUrl(requestUrl, isDevelopment)
  const requestId = globalThis.crypto.randomUUID()
  const headers = { 'X-Request-ID': requestId }

  try {
    if (isDevelopment) {
      return await forwardApiRequest(event, targetUrl.href, {
        headers,
        streamRequest: true
      })
    }

    const api = getApiBinding(event.context.cloudflare)

    return await forwardApiRequest(event, targetUrl.href, {
      fetch: api.fetch.bind(api),
      headers,
      streamRequest: true
    })
  } catch (error) {
    logApiProxyError(error, options.logContext, requestId)
    setResponseStatus(event, 503)
    setResponseHeader(event, 'Cache-Control', 'no-store')
    setResponseHeader(event, 'X-Request-ID', requestId)

    return { error: {
      code: 'SERVICE_UNAVAILABLE',
      message: options.message
    } }
  }
}

export {
  createApiTargetUrl,
  proxyApiRequest
}
