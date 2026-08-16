import type { Client } from 'pg'

const TEST_DATABASE_NAME_PATTERN = /^tv_test_[0-9a-f]{32}$/u

async function assertDisposableTestDatabase(client: Client): Promise<void> {
  const result = await client.query<{ database_name: string; }>(`
    SELECT current_database() AS database_name
  `)

  const databaseName = result.rows[0]?.database_name

  if (databaseName === undefined || !TEST_DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error('Refusing destructive setup outside a disposable test database')
  }
}

export { assertDisposableTestDatabase }
