import { defineEventHandler } from 'h3'
import { proxyApiRequest } from '~~/server/utils/proxy-api.ts'

export default defineEventHandler(async (event) => proxyApiRequest(event, {
  message: 'A rewatch could not be canceled right now.',
  logContext: 'catalog rewatch cancellation service binding request failed'
}))
