import type { Database } from '@tv/database'
import type { Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { findUserBySession } from './repository.ts'
import { getExpiredSessionCookieOptions, getSessionCookieName, hashSessionToken, isSessionToken } from './session.ts'

interface ActiveSession {
  database: Database;
  user: NonNullable<Awaited<ReturnType<typeof findUserBySession>>>;
}

type ConnectDatabase = () => Promise<Database>

function clearSessionCookie(context: Context): void {
  const cookieName = getSessionCookieName(context.req.url)
  const options = getExpiredSessionCookieOptions(context.req.url)

  setCookie(context, cookieName, '', options)
}

async function resolveCurrentSession(
  context: Context,
  connectDatabase: ConnectDatabase,
  now = new Date()
): Promise<ActiveSession | null> {
  const cookieName = getSessionCookieName(context.req.url)
  const token = getCookie(context, cookieName)

  if (token === undefined || token.length === 0) {
    return null
  }

  if (!isSessionToken(token)) {
    clearSessionCookie(context)

    return null
  }

  const tokenHash = await hashSessionToken(token)
  const database = await connectDatabase()
  const user = await findUserBySession(database, tokenHash, now)

  if (user === null) {
    clearSessionCookie(context)

    return null
  }

  return {
    database,
    user
  }
}

export type { ActiveSession }

export {
  clearSessionCookie,
  resolveCurrentSession
}
