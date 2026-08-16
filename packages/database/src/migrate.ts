import { env } from 'node:process'
import { URL } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'
import { createDatabase } from './index.ts'

const connectionString = env.DATABASE_URL

if (connectionString === undefined || connectionString === '') {
  throw new Error('DATABASE_URL is required to run migrations')
}

const client = new Client({ connectionString })

try {
  await client.connect()

  const database = createDatabase(client)

  await migrate(database, {
    migrationsFolder: new URL('../migrations', import.meta.url).pathname
  })
} finally {
  await client.end()
}
