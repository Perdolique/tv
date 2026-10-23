import { defineEventHandler } from 'h3'
import { proxyApiRequest } from '~~/server/utils/proxy-api.ts'

export default defineEventHandler(async event => proxyApiRequest(event, {
  message: 'Title requests are temporarily unavailable.',
  logContext: 'title request API failed'
}))
