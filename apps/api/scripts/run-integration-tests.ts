import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { createDatabase } from '@tv/database'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'

const DEFAULT_TEST_DATABASE_ADMIN_URL = 'postgresql://tv:tv@127.0.0.1:5433/postgres'
const EXPECTED_POSTGRESQL_MAJOR_VERSION = 18
const TEST_DATABASE_NAME_PATTERN = /^tv_test_[0-9a-f]{32}$/u
const apiDirectory = fileURLToPath(new URL('..', import.meta.url))

const migrationsFolder = fileURLToPath(
  new URL('../../../packages/database/migrations', import.meta.url)
)

const wranglerLogPath = join(tmpdir(), 'tv-wrangler-logs')

interface ChildResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === '127.0.0.1'
    || hostname === '[::1]'
    || hostname === '::1'
    || hostname === 'localhost'
}

async function waitForChild(child: ChildProcess): Promise<ChildResult> {
  // oxlint-disable-next-line promise/avoid-new -- Node child processes expose completion through events.
  return new Promise((resolve, reject) => {
    child.once('error', reject)

    child.once('close', (exitCode, signal) => {
      resolve({
        exitCode,
        signal
      })
    })
  })
}

async function runVitestConfig(
  configPath: string,
  testEnvironment: NodeJS.ProcessEnv
): Promise<void> {
  const child = spawn(
    'pnpm',
    ['exec', 'vitest', 'run', '--config', configPath],
    {
      cwd: apiDirectory,
      env: testEnvironment,
      stdio: 'inherit'
    }
  )

  const { exitCode, signal } = await waitForChild(child)

  if (exitCode !== 0) {
    const termination = signal === null
      ? `exit code ${String(exitCode)}`
      : `signal ${signal}`

    throw new Error(`Vitest failed with ${termination}`)
  }
}

const databaseName = `tv_test_${randomUUID().replaceAll('-', '')}`

if (!TEST_DATABASE_NAME_PATTERN.test(databaseName)) {
  throw new Error('Generated integration database name is invalid')
}

const adminUrl = new URL(
  env.TEST_DATABASE_ADMIN_URL ?? DEFAULT_TEST_DATABASE_ADMIN_URL
)

if (!isLoopbackHostname(adminUrl.hostname)) {
  throw new Error('Integration tests require a loopback PostgreSQL server')
}

const testDatabaseUrl = new URL(adminUrl)

testDatabaseUrl.pathname = `/${databaseName}`

const adminClient = new Client({ connectionString: adminUrl.toString() })

await adminClient.connect()

let databaseCreated = false

try {
  const versionResult = await adminClient.query<{ server_version_num: string; }>(
    'SHOW server_version_num'
  )

  const serverVersionNumber = Number(versionResult.rows[0]?.server_version_num)
  const serverMajorVersion = Math.trunc(serverVersionNumber / 1e4)

  if (serverMajorVersion !== EXPECTED_POSTGRESQL_MAJOR_VERSION) {
    throw new Error(
      `Integration tests require PostgreSQL ${EXPECTED_POSTGRESQL_MAJOR_VERSION}; received ${String(serverMajorVersion)}`
    )
  }

  await adminClient.query(`CREATE DATABASE "${databaseName}"`)

  databaseCreated = true

  const migrationClient = new Client({
    connectionString: testDatabaseUrl.toString()
  })

  try {
    await migrationClient.connect()
    await migrate(createDatabase(migrationClient), { migrationsFolder })
  } finally {
    await migrationClient.end()
  }

  const testEnvironment: NodeJS.ProcessEnv = {
    ...env,
    TEST_DATABASE_URL: testDatabaseUrl.toString(),
    WRANGLER_LOG_PATH: wranglerLogPath
  }

  delete testEnvironment.DATABASE_URL

  await runVitestConfig('vitest.database-integration.config.ts', testEnvironment)
  await runVitestConfig('vitest.worker-integration.config.ts', testEnvironment)
} finally {
  try {
    if (databaseCreated) {
      await adminClient.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`)
    }
  } finally {
    await adminClient.end()
  }
}
