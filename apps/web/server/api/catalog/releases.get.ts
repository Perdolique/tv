import { defineEventHandler } from 'h3'
import { proxyApiRequest } from '~~/server/utils/proxy-api.ts'

export default defineEventHandler(async (event) => proxyApiRequest(event, {
  message: 'Your upcoming releases are temporarily unavailable.',
  logContext: 'catalog releases service binding request failed'
}))
