import { createDatabase, type Database } from '@tv/database'
import { Client } from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { resolveCurrentSession } from '../../auth/current-session.ts'
import type { findCatalogItemFollowed } from '../repository.ts'
import { createCatalogApp } from '../routes.ts'

type FindCatalogItemFollowed = typeof findCatalogItemFollowed
type ResolveCurrentSession = typeof resolveCurrentSession

const mocks = vi.hoisted(() => {
  return {
    findCatalogItemFollowed: vi.fn<FindCatalogItemFollowed>(),
    resolveCurrentSession: vi.fn<ResolveCurrentSession>()
  }
})

vi.mock(import('../repository.ts'), async (importOriginal) => {
  const repository = await importOriginal()

  return {
    ...repository,
    findCatalogItemFollowed: mocks.findCatalogItemFollowed
  }
})

vi.mock(import('../../auth/current-session.ts'), async (importOriginal) => {
  const session = await importOriginal()

  return {
    ...session,
    resolveCurrentSession: mocks.resolveCurrentSession
  }
})

const catalogItemId = '01991a00-0000-7000-8000-000000000001'

const user = {
  email: 'catalog-follow@example.com',
  id: '40000000-0000-4000-8000-000000000008'
}

const bindings = {
  DATABASE: {
    connectionString: 'unused-controlled-connection'
  }
}

interface CatalogAppFixture {
  close: MockInstance<Client['end']>;
  connectDatabase: ReturnType<typeof vi.fn>;
  database: Database;
  request: (cookie?: string) => Promise<Response>;
}

function setupCatalogApp(): CatalogAppFixture {
  const client = new Client()
  const database = createDatabase(client)
  const close = vi.spyOn(client, 'end').mockResolvedValue()
  const connectDatabase = vi.fn<() => Promise<{ client: Client; database: Database }>>()

  connectDatabase.mockResolvedValue({
    client,
    database
  })

  const app = createCatalogApp({ connectDatabase })

  return {
    close,
    connectDatabase,
    database,

    request: async (cookie) => {
      const headers = new Headers()

      if (cookie !== undefined) {
        headers.set('Cookie', cookie)
      }

      return app.request(
        `https://tv-api.test/api/catalog/items/${catalogItemId}/follow`,
        { headers },
        bindings
      )
    }
  }
}

describe('catalog session database lifecycle', () => {
  beforeEach(() => {
    mocks.findCatalogItemFollowed.mockReset()
    mocks.resolveCurrentSession.mockReset()

    mocks.resolveCurrentSession.mockImplementation(async (context, connectDatabase) => {
      const cookie = context.req.header('Cookie')

      if (cookie === undefined) {
        return null
      }

      const database = await connectDatabase()

      return cookie === 'expired=1'
        ? null
        : {
          database,
          user
        }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not connect without a session cookie', async () => {
    const fixture = setupCatalogApp()
    const response = await fixture.request()

    expect(response.status).toBe(401)
    expect(fixture.connectDatabase).not.toHaveBeenCalled()
    expect(fixture.close).not.toHaveBeenCalled()
  })

  it('reuses and closes one connection after a successful operation', async () => {
    const fixture = setupCatalogApp()

    mocks.findCatalogItemFollowed.mockResolvedValue(false)

    const response = await fixture.request('session=valid')

    expect(response.status).toBe(200)
    expect(fixture.connectDatabase).toHaveBeenCalledTimes(1)
    expect(fixture.close).toHaveBeenCalledTimes(1)

    expect(mocks.findCatalogItemFollowed).toHaveBeenCalledWith(
      fixture.database,
      user.id,
      catalogItemId
    )
  })

  it('closes the connection after session and repository failures', async () => {
    const expired = setupCatalogApp()
    const expiredResponse = await expired.request('expired=1')

    expect(expiredResponse.status).toBe(401)
    expect(expired.connectDatabase).toHaveBeenCalledTimes(1)
    expect(expired.close).toHaveBeenCalledTimes(1)

    const repository = setupCatalogApp()
    const failure = new Error('controlled repository failure')

    const logs = vi.spyOn(console, 'error').mockImplementation(() => {
      // The safe response and raw log are asserted below.
    })

    mocks.findCatalogItemFollowed.mockRejectedValue(failure)

    const repositoryResponse = await repository.request('session=valid')

    expect(repositoryResponse.status).toBe(503)
    expect(repository.connectDatabase).toHaveBeenCalledTimes(1)
    expect(repository.close).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(logs.mock.calls)).toContain('controlled repository failure')
  })

  it('returns a safe error and logs a connection close failure', async () => {
    const fixture = setupCatalogApp()
    const closeFailure = new Error('controlled close failure')

    const logs = vi.spyOn(console, 'error').mockImplementation(() => {
      // The safe response and raw log are asserted below.
    })

    mocks.findCatalogItemFollowed.mockResolvedValue(false)
    fixture.close.mockRejectedValue(closeFailure)

    const response = await fixture.request('session=valid')

    expect(response.status).toBe(503)

    await expect(response.json()).resolves.toStrictEqual({ error: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'The catalog is temporarily unavailable.'
    } })

    expect(fixture.connectDatabase).toHaveBeenCalledTimes(1)
    expect(fixture.close).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(logs.mock.calls)).toContain('controlled close failure')
  })

  it('keeps the repository failure when closing the connection also fails', async () => {
    const fixture = setupCatalogApp()
    const closeFailure = new Error('controlled close failure')
    const repositoryFailure = new Error('controlled repository failure')

    const logs = vi.spyOn(console, 'error').mockImplementation(() => {
      // Both raw failures are asserted below.
    })

    mocks.findCatalogItemFollowed.mockRejectedValue(repositoryFailure)
    fixture.close.mockRejectedValue(closeFailure)

    const response = await fixture.request('session=valid')
    const serializedLogs = JSON.stringify(logs.mock.calls)

    expect(response.status).toBe(503)

    await expect(response.json()).resolves.toStrictEqual({ error: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'The catalog is temporarily unavailable.'
    } })

    expect(serializedLogs).toContain('controlled repository failure')
    expect(serializedLogs).toContain('controlled close failure')
    expect(logs).toHaveBeenCalledTimes(2)
  })
})
