import { createDatabase, type Database } from '@tv/database'
import { Client } from 'pg'

interface DatabaseAdapter {
  client: Client;
  database: Database;
}

export function createDatabaseAdapter(connectionString: string): DatabaseAdapter {
  const client = new Client({ connectionString })
  const database = createDatabase(client)

  return {
    client,
    database
  }
}
