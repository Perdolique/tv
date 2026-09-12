import { defineEventHandler } from 'h3'
import { proxyApiRequest } from '~~/server/utils/proxy-api.ts'

export default defineEventHandler(async (event) => proxyApiRequest(event, {
  message: 'Your watchlist is temporarily unavailable.',
  logContext: 'catalog watchlist service binding request failed'
}))
