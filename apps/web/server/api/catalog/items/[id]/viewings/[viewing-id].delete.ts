import { defineEventHandler } from 'h3'
import { proxyApiRequest } from '~~/server/utils/proxy-api.ts'

export default defineEventHandler(async (event) => proxyApiRequest(event, {
  message: 'Your movie viewings are temporarily unavailable.',
  logContext: 'catalog movie viewing service binding request failed'
}))
