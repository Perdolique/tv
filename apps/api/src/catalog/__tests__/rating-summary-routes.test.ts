import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { connectDatabaseAdapter } from '../../database.ts'
import type { findCatalogItemRatingSummary } from '../ratings-repository.ts'
import { createCatalogApp } from '../routes.ts'

const mocks = vi.hoisted(() => {
  return { findSummary: vi.fn<typeof findCatalogItemRatingSummary>() }
})

vi.mock(import('../ratings-repository.ts'), async importOriginal => {
  const repository = await importOriginal()

  return {
    ...repository,
    findCatalogItemRatingSummary: mocks.findSummary
  }
})

const id = '01991a00-0000-7000-8000-000000000001'
const bindings = { DATABASE: { connectionString: 'unused-summary-connection' } }

function setup() {
  const client = new Client()
  const database = createDatabase(client)
  const close = vi.spyOn(client, 'end').mockResolvedValue()
  const connectDatabase = vi.fn<typeof connectDatabaseAdapter>()

  connectDatabase.mockResolvedValue({
    client,
    database
  })

  const app = createCatalogApp({ connectDatabase })

  return {
    close,
    connectDatabase,
    request: async (targetId = id) => app.request(`https://tv-api.test/api/catalog/items/${targetId}/rating-summary`, {}, bindings)
  }
}

describe('public summary database lifecycle', () => {
  beforeEach(() => {
    mocks.findSummary.mockReset().mockResolvedValue({
      averageScore: null,
      ratingCount: 0
    })
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('closes a public read without resolving a session', async () => {
    const fixture = setup()
    const response = await fixture.request()

    expect(response.status).toBe(200)
    expect(fixture.connectDatabase).toHaveBeenCalledTimes(1)
    expect(fixture.close).toHaveBeenCalledTimes(1)
  })

  it('validates before connecting and closes an unknown-title read', async () => {
    const fixture = setup()
    const invalid = await fixture.request('invalid')

    expect(invalid.status).toBe(400)
    expect(fixture.connectDatabase).not.toHaveBeenCalled()
    mocks.findSummary.mockResolvedValue(null)

    const missing = await fixture.request()

    expect(missing.status).toBe(404)
    expect(fixture.close).toHaveBeenCalledTimes(1)
  })

  it('does not try to close an adapter that failed to connect', async () => {
    const fixture = setup()
    const log = vi.spyOn(console, 'error').mockReturnValue()

    fixture.connectDatabase.mockRejectedValue(new Error('private connection failure'))

    const response = await fixture.request()

    expect(response.status).toBe(503)
    expect(fixture.close).not.toHaveBeenCalled()
    expect(JSON.stringify(log.mock.calls)).toContain('private connection failure')
  })

  it('closes a failed query and returns no private database details', async () => {
    const fixture = setup()
    const log = vi.spyOn(console, 'error').mockReturnValue()

    mocks.findSummary.mockRejectedValue(new Error('private summary query failure'))

    const response = await fixture.request()

    expect(response.status).toBe(503)
    expect(fixture.close).toHaveBeenCalledTimes(1)

    await expect(response.json()).resolves.toStrictEqual({ error: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'The catalog is temporarily unavailable.'
    } })

    expect(JSON.stringify(log.mock.calls)).toContain('private summary query failure')
  })

  it('translates a close failure into a safe 503 instead of an unexpected 500', async () => {
    const fixture = setup()
    const log = vi.spyOn(console, 'error').mockReturnValue()

    fixture.close.mockRejectedValue(new Error('private summary close failure'))

    const response = await fixture.request()

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')

    await expect(response.json()).resolves.toStrictEqual({ error: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'The catalog is temporarily unavailable.'
    } })

    expect(JSON.stringify(log.mock.calls)).toContain('private summary close failure')
  })

  it('retains both diagnostics when a failed query also fails to close', async () => {
    const fixture = setup()
    const log = vi.spyOn(console, 'error').mockReturnValue()

    mocks.findSummary.mockRejectedValue(new Error('private summary query failure'))
    fixture.close.mockRejectedValue(new Error('private summary close failure'))

    const response = await fixture.request()
    const diagnostics = JSON.stringify(log.mock.calls)

    expect(response.status).toBe(503)
    expect(fixture.close).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledTimes(2)
    expect(diagnostics).toContain('private summary query failure')
    expect(diagnostics).toContain('private summary close failure')
  })
})
