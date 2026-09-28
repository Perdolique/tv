/* oxlint-disable eslint/no-console -- Scheduled maintenance reports results and technical failures to Worker logs. */
import { findRootCause, serializeError } from '@tv/shared/errors'
import { deleteExpiredVerificationTokens } from './auth/repository.ts'
import { deleteExpiredImportPreviews } from './catalog/import/repository.ts'
import { createDatabaseAdapter } from './database.ts'

function logCleanupFailure(job: string, error: unknown): void {
  const rootCause = findRootCause(error)
  const technicalError = serializeError(rootCause)

  const entry = JSON.stringify({
    message: 'scheduled cleanup failed',
    job,
    error: technicalError
  })

  console.error(entry)
}

async function scheduled(_controller: ScheduledController, env: CloudflareBindings): Promise<void> {
  const now = new Date()
  const adapter = createDatabaseAdapter(env.DATABASE.connectionString)
  const failures: unknown[] = []

  try {
    await adapter.client.connect()

    const [verification, previews] = await Promise.allSettled([
      deleteExpiredVerificationTokens(adapter.database, now),
      deleteExpiredImportPreviews(adapter.database, now)
    ])

    if (verification.status === 'fulfilled') {
      const entry = JSON.stringify({
        message: 'email verification token cleanup completed',
        deleted: verification.value
      })

      console.log(entry)
    } else {
      logCleanupFailure('email_verification_tokens', verification.reason)
      failures.push(verification.reason)
    }

    if (previews.status === 'fulfilled') {
      const entry = JSON.stringify({
        message: 'catalog import preview cleanup completed',
        deleted: previews.value
      })

      console.log(entry)
    } else {
      logCleanupFailure('catalog_import_previews', previews.reason)
      failures.push(previews.reason)
    }
  } catch (error) {
    logCleanupFailure('database connection', error)
    failures.push(error)
  } finally {
    try {
      await adapter.client.end()
    } catch (error) {
      logCleanupFailure('database disconnect', error)
      failures.push(error)
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, 'Scheduled cleanup failed')
  }
}

export { scheduled }
