import { env } from 'cloudflare:workers'
import { createScheduledController } from 'cloudflare:test'
import { createDatabase } from '@tv/database'
import { Client } from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteExpiredVerificationTokens } from '../auth/repository.ts'
import { deleteExpiredImportPreviews } from '../catalog/import/repository.ts'
import { createDatabaseAdapter } from '../database.ts'
import { scheduled } from '../scheduled.ts'

vi.mock(import('../auth/repository.ts'), () => {
  return {
    deleteExpiredVerificationTokens: vi.fn()
  }
})

vi.mock(import('../catalog/import/repository.ts'), () => {
  return {
    deleteExpiredImportPreviews: vi.fn()
  }
})

vi.mock(import('../database.ts'), async (importOriginal) => {
  const original = await importOriginal()

  return {
    ...original,
    createDatabaseAdapter: vi.fn()
  }
})

const controller = createScheduledController({ cron: '0 3 * * *' })

function createFixture() {
  const client = new Client()
  const database = createDatabase(client)
  const connect = vi.spyOn(client, 'connect').mockResolvedValue()
  const disconnect = vi.spyOn(client, 'end').mockResolvedValue()

  const log = vi.spyOn(console, 'log').mockImplementation(() => {
    // Assert maintenance logs without printing them.
  })

  const logError = vi.spyOn(console, 'error').mockImplementation(() => {
    // Assert technical errors without printing them.
  })

  vi.mocked(createDatabaseAdapter).mockReturnValue({
    client,
    database
  })

  return {
    database,
    connect,
    disconnect,
    log,
    logError
  }
}

// oxlint-disable-next-line eslint/init-declarations -- Each test creates fresh client and logging spies.
let fixture: ReturnType<typeof createFixture>

describe('scheduled cleanup', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    fixture = createFixture()

    vi.mocked(deleteExpiredVerificationTokens).mockResolvedValue(0)
    vi.mocked(deleteExpiredImportPreviews).mockResolvedValue(0)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports empty runs and gives both jobs the same invocation cutoff', async () => {
    await scheduled(controller, env)

    const cutoff = vi.mocked(deleteExpiredVerificationTokens).mock.calls[0]?.[1]

    expect(cutoff).toBeInstanceOf(Date)
    expect(deleteExpiredImportPreviews).toHaveBeenCalledWith(fixture.database, cutoff)
    expect(createDatabaseAdapter).toHaveBeenCalledWith(env.DATABASE.connectionString)

    const expectedVerificationEntry = JSON.stringify({
      message: 'email verification token cleanup completed',
      deleted: 0
    })

    const expectedPreviewEntry = JSON.stringify({
      message: 'catalog import preview cleanup completed',
      deleted: 0
    })

    expect(fixture.log).toHaveBeenCalledWith(expectedVerificationEntry)
    expect(fixture.log).toHaveBeenCalledWith(expectedPreviewEntry)
    expect(fixture.disconnect).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      job: 'email_verification_tokens',
      fail: deleteExpiredVerificationTokens
    },
    {
      job: 'catalog_import_previews',
      fail: deleteExpiredImportPreviews
    }
  ])('preserves the cause of a $job failure and completes the other job', async ({ job, fail }) => {
    const cause = new Error('database cleanup connection reset')
    const error = new Error('query failed', { cause })

    vi.mocked(deleteExpiredVerificationTokens).mockResolvedValue(7)
    vi.mocked(deleteExpiredImportPreviews).mockResolvedValue(7)
    vi.mocked(fail).mockRejectedValue(error)
    await expect(scheduled(controller, env)).rejects.toMatchObject({ errors: [error] })
    expect(deleteExpiredVerificationTokens).toHaveBeenCalledTimes(1)
    expect(deleteExpiredImportPreviews).toHaveBeenCalledTimes(1)
    expect(fixture.disconnect).toHaveBeenCalledTimes(1)

    const expectedFailureEntry = JSON.stringify({
      message: 'scheduled cleanup failed',
      job,

      error: {
        message: cause.message,
        name: cause.name,
        stack: cause.stack
      }
    })

    expect(fixture.logError).toHaveBeenCalledWith(expectedFailureEntry)
    expect(fixture.log).toHaveBeenCalledWith(expect.stringContaining('"deleted":7'))
  })

  it('keeps the connection open until the other job settles after a failure', async () => {
    const error = new Error('verification delete failed')
    const pending = Promise.withResolvers<number>()

    vi.mocked(deleteExpiredVerificationTokens).mockRejectedValue(error)
    vi.mocked(deleteExpiredImportPreviews).mockReturnValue(pending.promise)

    // oxlint-disable-next-line vitest/valid-expect -- Attach rejection handling before releasing the pending job; await it in finally.
    const rejection = expect(scheduled(controller, env)).rejects.toMatchObject({ errors: [error] })

    try {
      await vi.waitFor(() => {
        expect(deleteExpiredImportPreviews).toHaveBeenCalledTimes(1)
      })

      expect(fixture.disconnect).not.toHaveBeenCalled()
    } finally {
      pending.resolve(0)

      await rejection
    }

    expect(fixture.disconnect).toHaveBeenCalledTimes(1)
  })

  it('attempts to close a failed connection and reports the connection cause', async () => {
    const error = new Error('connection refused')

    fixture.connect.mockRejectedValue(error)
    await expect(scheduled(controller, env)).rejects.toMatchObject({ errors: [error] })
    expect(fixture.disconnect).toHaveBeenCalledTimes(1)
    expect(deleteExpiredVerificationTokens).not.toHaveBeenCalled()
    expect(deleteExpiredImportPreviews).not.toHaveBeenCalled()
    expect(fixture.logError).toHaveBeenCalledWith(expect.stringContaining('connection refused'))
  })

  it('retains both cleanup failures when closing the connection also fails', async () => {
    const verificationError = new Error('verification delete failed')
    const previewError = new Error('preview delete failed')
    const closeError = new Error('disconnect failed')

    vi.mocked(deleteExpiredVerificationTokens).mockRejectedValue(verificationError)
    vi.mocked(deleteExpiredImportPreviews).mockRejectedValue(previewError)
    fixture.disconnect.mockRejectedValue(closeError)

    await expect(scheduled(controller, env)).rejects.toMatchObject({
      errors: [verificationError, previewError, closeError]
    })

    expect(fixture.disconnect).toHaveBeenCalledTimes(1)
    expect(fixture.logError).toHaveBeenCalledTimes(3)
  })
})
