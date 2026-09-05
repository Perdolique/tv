import { getRequestURL, proxyRequest, setResponseHeader, setResponseStatus, type H3Event } from 'h3'
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

function logApiProxyError(error: unknown, logContext: string): void {
  const technicalError = findRootCause(error)
  const serializedTechnicalError = serializeError(technicalError)

  const logEntry = JSON.stringify({
    error: serializedTechnicalError,
    message: logContext
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

async function proxyApiRequest(
  event: H3Event,
  options: ApiProxyOptions,
  isDevelopment = import.meta.dev
): Promise<unknown> {
  const requestUrl = getRequestURL(event)
  const targetUrl = createApiTargetUrl(requestUrl, isDevelopment)

  try {
    if (isDevelopment) {
      return await proxyRequest(event, targetUrl.href, { streamRequest: true })
    }

    const api = getApiBinding(event.context.cloudflare)

    return await proxyRequest(event, targetUrl.href, {
      fetch: api.fetch.bind(api),
      streamRequest: true
    })
  } catch (error) {
    logApiProxyError(error, options.logContext)
    setResponseStatus(event, 503)
    setResponseHeader(event, 'Cache-Control', 'no-store')

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
