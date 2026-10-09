import { defineEventHandler } from 'h3'
import { proxyApiRequest } from '~~/server/utils/proxy-api.ts'

export default defineEventHandler(async (event) => proxyApiRequest(event, {
  message: 'Released season episodes could not be marked right now.',
  logContext: 'catalog bulk season watches service binding request failed'
}))
