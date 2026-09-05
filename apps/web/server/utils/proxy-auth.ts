import type { H3Event } from 'h3'
import { proxyApiRequest } from './proxy-api.ts'

async function proxyAuthRequest(event: H3Event, isDevelopment = import.meta.dev): Promise<unknown> {
  return proxyApiRequest(event, {
    message: 'Authentication is temporarily unavailable.',
    logContext: 'auth service binding request failed'
  }, isDevelopment)
}

export { proxyAuthRequest }
