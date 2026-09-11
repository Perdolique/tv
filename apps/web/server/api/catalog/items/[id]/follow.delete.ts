import { defineEventHandler } from 'h3'
import { proxyApiRequest } from '~~/server/utils/proxy-api.ts'

export default defineEventHandler(async (event) => proxyApiRequest(event, {
  message: 'This title could not be unfollowed right now.',
  logContext: 'catalog follow service binding request failed'
}))
