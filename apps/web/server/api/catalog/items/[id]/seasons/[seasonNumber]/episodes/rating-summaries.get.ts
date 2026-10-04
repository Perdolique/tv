import { defineEventHandler } from 'h3'
import { proxyApiRequest } from '~~/server/utils/proxy-api.ts'

export default defineEventHandler(async (event) => proxyApiRequest(event, {
  message: 'Episode viewer ratings are temporarily unavailable.',
  logContext: 'catalog episode rating summaries service binding request failed'
}))
