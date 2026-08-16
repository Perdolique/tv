import type { Client } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'

export function createDatabase(client: Client) {
  return drizzle({ client })
}

export type Database = ReturnType<typeof createDatabase>
