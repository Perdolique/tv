import { defineEventHandler } from 'h3'
import { proxyApiRequest } from '~~/server/utils/proxy-api.ts'

export default defineEventHandler(async (event) => proxyApiRequest(event, {
  message: 'Season viewer rating is temporarily unavailable.',
  logContext: 'catalog season rating summary service binding request failed'
}))
