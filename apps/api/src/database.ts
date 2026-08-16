import { createDatabase, type Database } from '@tv/database'
import { Client } from 'pg'

interface DatabaseAdapter {
  client: Client;
  database: Database;
}

function createDatabaseAdapter(connectionString: string): DatabaseAdapter {
  const client = new Client({ connectionString })
  const database = createDatabase(client)

  return {
    client,
    database
  }
}

async function connectDatabaseAdapter(
  connectionString: string
): Promise<DatabaseAdapter> {
  const adapter = createDatabaseAdapter(connectionString)

  await adapter.client.connect()

  return adapter
}

export {
  connectDatabaseAdapter,
  createDatabaseAdapter
}
