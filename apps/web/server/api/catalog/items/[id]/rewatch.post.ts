import { defineEventHandler } from 'h3'
import { proxyApiRequest } from '~~/server/utils/proxy-api.ts'

export default defineEventHandler(async (event) => proxyApiRequest(event, {
  message: 'A rewatch could not be started right now.',
  logContext: 'catalog rewatch service binding request failed'
}))
