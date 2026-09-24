// oxlint-disable-next-line import/no-relative-parent-imports -- The scheduled job shares the API database adapter.
import { connectDatabaseAdapter } from '../../database.ts'
import { deleteExpiredImportPreviews } from './repository.ts'

async function scheduled(_controller: ScheduledController, env: CloudflareBindings): Promise<void> {
  const adapter = await connectDatabaseAdapter(env.DATABASE.connectionString)

  try {
    const deleted = await deleteExpiredImportPreviews(adapter.database, new Date())

    const entry = JSON.stringify({
      message: 'catalog import preview cleanup completed',
      deleted
    })

    // oxlint-disable-next-line eslint/no-console -- Record every scheduled cleanup, including runs that delete nothing.
    console.log(entry)
  } finally {
    await adapter.client.end()
  }
}

export { scheduled }
