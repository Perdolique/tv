import { defineEventHandler } from 'h3'
import { proxyApiRequest } from '~~/server/utils/proxy-api.ts'

export default defineEventHandler(async (event) => proxyApiRequest(event, {
  message: 'Released episodes could not be marked right now.',
  logContext: 'catalog bulk episode watches service binding request failed'
}))
