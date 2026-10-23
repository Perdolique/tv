import { defineEventHandler } from 'h3'
import { proxyApiRequest } from '~~/server/utils/proxy-api.ts'

export default defineEventHandler(async event => proxyApiRequest(event, {
  message: 'Catalog collections are temporarily unavailable.',
  logContext: 'catalog collection service binding request failed'
}))
