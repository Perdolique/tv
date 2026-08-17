import { defineEventHandler } from 'h3'
import { proxyAuthRequest } from '~~/server/utils/proxy-auth.ts'

// oxlint-disable-next-line import/no-default-export -- Nitro server routes require a default export.
export default defineEventHandler(async (event) => proxyAuthRequest(event, '/auth/register'))
