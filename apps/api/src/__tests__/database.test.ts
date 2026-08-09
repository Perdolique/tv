import { describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { createDatabaseAdapter } from '../database.ts'

describe(createDatabaseAdapter, () => {
  it('wires an unconnected PostgreSQL client into the shared database package', () => {
    const adapter = createDatabaseAdapter('postgres://tv:test@localhost:5432/tv')

    expect(adapter.client).toBeInstanceOf(Client)
    expect(adapter.database.$client).toBe(adapter.client)
  })
})
