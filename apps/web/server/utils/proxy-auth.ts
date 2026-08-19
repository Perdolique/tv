import { getRequestURL, proxyRequest, setResponseHeader, setResponseStatus, type H3Event } from 'h3'

interface ApiBinding {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

interface SerializedError {
  message: string;
  name: string;
  stack?: string;
}

const SERVICE_UNAVAILABLE_BODY = {
  error: {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Authentication is temporarily unavailable.'
  }
} as const

const LOCAL_API_ORIGIN = 'http://127.0.0.1:8788'

const AUTH_TARGET_PATHS: ReadonlyMap<string, string> = new Map([
  ['GET /api/auth/session', '/auth/session'],
  ['POST /api/auth/register', '/auth/register'],
  ['POST /api/auth/sign-in', '/auth/sign-in'],
  ['POST /api/auth/sign-out', '/auth/sign-out']
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isApiBinding(value: unknown): value is ApiBinding {
  return isRecord(value) && typeof value.fetch === 'function'
}

function getApiBinding(value: unknown): ApiBinding {
  if (!isRecord(value) || !isRecord(value.env) || !isApiBinding(value.env.API)) {
    throw new Error('API service binding is unavailable')
  }

  return value.env.API
}

function serializeError(error: unknown): SerializedError {
  if (!(error instanceof Error)) {
    return {
      message: String(error),
      name: 'UnknownError'
    }
  }

  const serializedError: SerializedError = {
    message: error.message,
    name: error.name
  }

  if (error.stack !== undefined && error.stack !== '') {
    serializedError.stack = error.stack
  }

  return serializedError
}

function findRootCause(error: unknown): unknown {
  const visitedErrors = new Set<Error>()
  let rootCause = error

  while (
    rootCause instanceof Error
    && rootCause.cause !== undefined
    && !visitedErrors.has(rootCause)
  ) {
    visitedErrors.add(rootCause)
    rootCause = rootCause.cause
  }

  return rootCause
}

function logAuthProxyError(error: unknown): void {
  const technicalError = findRootCause(error)

  globalThis.console.error(JSON.stringify({
    error: serializeError(technicalError),
    message: 'auth service binding request failed'
  }))
}

function createAuthTargetUrl(
  requestUrl: URL,
  targetPath: string,
  isDevelopment: boolean
): URL {
  const targetOrigin = isDevelopment ? LOCAL_API_ORIGIN : requestUrl.origin
  const targetUrl = new URL(targetPath, targetOrigin)

  targetUrl.search = requestUrl.search

  return targetUrl
}

function getAuthTargetPath(request: Request): string | undefined {
  const requestUrl = new URL(request.url)
  const routeKey = `${request.method} ${requestUrl.pathname}`

  return AUTH_TARGET_PATHS.get(routeKey)
}

async function proxyAuthRequestAtEdge(
  request: Request,
  api: ApiBinding
): Promise<Response | undefined> {
  const targetPath = getAuthTargetPath(request)

  if (targetPath === undefined) {
    return
  }

  try {
    const requestUrl = new URL(request.url)
    const targetUrl = createAuthTargetUrl(requestUrl, targetPath, false)
    const targetRequest = new Request(targetUrl, request)

    return await api.fetch(targetRequest)
  } catch (error) {
    logAuthProxyError(error)

    return Response.json(SERVICE_UNAVAILABLE_BODY, {
      headers: {
        'Cache-Control': 'no-store'
      },

      status: 503
    })
  }
}

async function proxyAuthRequest(event: H3Event, targetPath: string): Promise<unknown> {
  const requestUrl = getRequestURL(event)
  const targetUrl = createAuthTargetUrl(requestUrl, targetPath, import.meta.dev)

  try {
    if (import.meta.dev) {
      return await proxyRequest(event, targetUrl.href, { streamRequest: true })
    }

    const api = getApiBinding(event.context.cloudflare)

    return await proxyRequest(event, targetUrl.href, {
      fetch: api.fetch.bind(api),
      streamRequest: true
    })
  } catch (error) {
    logAuthProxyError(error)

    setResponseStatus(event, 503)
    setResponseHeader(event, 'Cache-Control', 'no-store')

    return SERVICE_UNAVAILABLE_BODY
  }
}

export {
  createAuthTargetUrl,
  getAuthTargetPath,
  proxyAuthRequestAtEdge,
  proxyAuthRequest
}
