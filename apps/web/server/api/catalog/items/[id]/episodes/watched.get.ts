import { defineEventHandler } from 'h3'
import { proxyApiRequest } from '~~/server/utils/proxy-api.ts'

export default defineEventHandler(async (event) => proxyApiRequest(event, {
  message: 'Watched episodes are temporarily unavailable.',
  logContext: 'catalog episode watches service binding request failed'
}))
