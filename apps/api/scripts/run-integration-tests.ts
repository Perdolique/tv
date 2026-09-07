import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { argv, env } from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { createDatabase } from '@tv/database'
import { isLoopbackHostname } from '@tv/shared/network'
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
const filters = argv.slice(2).map(path => path.replace(/^apps\/api\//u, ''))

for (const path of filters) {
  const isDatabaseTest = path.endsWith('/database.integration.test.ts')
  const isWorkerTest = path.endsWith('.worker.integration.test.ts')
  const testPath = join(apiDirectory, path)

  if ((!isDatabaseTest && !isWorkerTest) || !existsSync(testPath)) {
    throw new Error(`Expected an existing API integration test file: ${path}`)
  }
}

const databaseFilters = filters.filter(path => path.endsWith('/database.integration.test.ts'))
const workerFilters = filters.filter(path => path.endsWith('.worker.integration.test.ts'))

interface ChildResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
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
  testEnvironment: NodeJS.ProcessEnv,
  fileFilters: string[]
): Promise<void> {
  const child = spawn(
    'pnpm',
    ['exec', 'vitest', 'run', '--config', configPath, ...fileFilters],
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
  const versionResult = await adminClient.query<{ server_version_num: string }>(
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

  if (filters.length === 0 || databaseFilters.length > 0) {
    await runVitestConfig('vitest.database-integration.config.ts', testEnvironment, databaseFilters)
  }

  if (filters.length === 0 || workerFilters.length > 0) {
    await runVitestConfig('vitest.worker-integration.config.ts', testEnvironment, workerFilters)
  }
} finally {
  try {
    if (databaseCreated) {
      await adminClient.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`)
    }
  } finally {
    await adminClient.end()
  }
}
