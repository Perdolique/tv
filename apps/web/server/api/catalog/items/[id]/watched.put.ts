import { defineEventHandler } from 'h3'
import { proxyApiRequest } from '~~/server/utils/proxy-api.ts'

export default defineEventHandler(async (event) => proxyApiRequest(event, {
  message: 'This movie could not be marked as watched right now.',
  logContext: 'catalog watched service binding request failed'
}))
