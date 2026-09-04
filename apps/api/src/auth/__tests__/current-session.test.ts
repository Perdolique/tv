import { createDatabase } from '@tv/database'
import { Hono } from 'hono'
import { Client } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { resolveCurrentSession } from '../current-session.ts'
import { hashSessionToken } from '../session.ts'

const repositoryMocks = vi.hoisted(() => {
  return {
    findUserBySession: vi.fn()
  }
})

vi.mock(import('../repository.ts'), async (importOriginal) => {
  const repository = await importOriginal()

  return {
    ...repository,
    findUserBySession: repositoryMocks.findUserBySession
  }
})

const SESSION_TOKEN = 'c'.repeat(43)

describe(resolveCurrentSession, () => {
  it('reads the clock after an asynchronous database connection completes', async () => {
    const database = createDatabase(new Client())
    const beforeConnection = new Date('2026-09-01T11:59:59.999Z')
    const afterConnection = new Date('2026-09-01T12:00:00.001Z')
    let currentTime = beforeConnection
    const clock = vi.fn(() => currentTime)

    const connectDatabase = vi.fn(async () => {
      expect(clock).not.toHaveBeenCalled()
      await Promise.resolve()

      currentTime = afterConnection

      return database
    })

    const user = {
      email: 'clock@example.com',
      id: '40000000-0000-4000-8000-000000000001'
    }

    repositoryMocks.findUserBySession.mockResolvedValue(user)

    const app = new Hono()

    app.get('/', async (context) => {
      const session = await resolveCurrentSession(
        context,
        connectDatabase,
        clock
      )

      expect(session).not.toBeNull()
      expect(session?.database).toBe(database)

      return context.json({ user: session?.user })
    })

    const response = await app.request('https://tv-api.test/', {
      headers: {
        Cookie: `__Host-tv_session=${SESSION_TOKEN}`
      }
    })

    const tokenHash = await hashSessionToken(SESSION_TOKEN)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toStrictEqual({ user })
    expect(connectDatabase).toHaveBeenCalledTimes(1)
    expect(clock).toHaveBeenCalledTimes(1)

    expect(repositoryMocks.findUserBySession).toHaveBeenCalledWith(
      database,
      tokenHash,
      afterConnection
    )
  })
})
