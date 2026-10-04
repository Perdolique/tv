import { defineEventHandler } from 'h3'
import { proxyApiRequest } from '~~/server/utils/proxy-api.ts'

export default defineEventHandler(async (event) => proxyApiRequest(event, {
  message: 'Your season rating could not be removed right now.',
  logContext: 'catalog season rating service binding request failed'
}))
