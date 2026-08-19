import { defineEventHandler } from 'h3'
import { proxyAuthRequest } from '~~/server/utils/proxy-auth.ts'

export default defineEventHandler(async (event) => proxyAuthRequest(event, '/auth/sign-in'))
