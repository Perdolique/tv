import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'

interface RequestOptions {
  method?: string;
  retry: number;
  signal: AbortSignal;
}

const harness = vi.hoisted(() => {
  return { fetch: vi.fn<(url: string, options: RequestOptions) => Promise<unknown>>() }
})

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Nuxt's virtual alias has no runtime module in this Node unit test.
vi.mock('#app', () => {
  return { useRequestFetch: () => harness.fetch }
})

const { useCatalogFollow } = await import('../use-catalog-follow.ts')
const id = '01991a00-0000-7000-8000-000000000001'
const accountId = '01991a00-0000-7000-8000-000000000002'
const scopes: ReturnType<typeof effectScope>[] = []

function setup(
  initialAccountId: string | null = accountId,
  automaticLoad = false
) {
  const scope = effectScope()
  const item = ref<string | null>(id)
  const account = ref<string | null>(initialAccountId)

  const follow = scope.run(() => useCatalogFollow(item, account, {
    automaticLoad
  }))

  scopes.push(scope)

  if (follow === undefined) {
    throw new Error('The catalog follow scope did not start')
  }

  return {
    account,
    follow
  }
}

describe('catalog follow request lifecycle', () => {
  beforeEach(() => { harness.fetch.mockReset() })

  afterEach(() => {
    for (const scope of scopes.splice(0)) {
      scope.stop()
    }

    vi.restoreAllMocks()
  })

  it('loads only when a title and authenticated account are available', async () => {
    harness.fetch.mockResolvedValue({ followed: false })

    const anonymous = setup(null)

    await anonymous.follow.load()
    expect(harness.fetch).not.toHaveBeenCalled()

    anonymous.account.value = accountId

    await anonymous.follow.load()
    expect(anonymous.follow.status.value).toBe('loaded')
    expect(anonymous.follow.followed.value).toBe(false)

    expect(harness.fetch).toHaveBeenCalledWith(
      `/api/catalog/items/${id}/follow`,
      expect.objectContaining({ retry: 0 })
    )
  })

  it('updates optimistically and preserves the response state after success', async () => {
    harness.fetch
      .mockResolvedValueOnce({ followed: false })
      .mockResolvedValueOnce({ followed: true })

    const { follow } = setup()

    await follow.load()

    const saved = follow.toggle()

    expect(follow.followed.value).toBe(true)
    expect(follow.isSaving.value).toBe(true)

    expect(harness.fetch).toHaveBeenLastCalledWith(
      `/api/catalog/items/${id}/follow`,
      expect.objectContaining({
        method: 'PUT',
        retry: 0
      })
    )

    await saved

    expect(follow.followed.value).toBe(true)
    expect(follow.isSaving.value).toBe(false)
    expect(follow.saveError.value).toBe('')
  })

  it('rolls back a failed save and can retry the same action', async () => {
    const failure = { statusCode: 503 }

    const telemetry = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {
      // The raw transport failure is asserted below.
    })

    harness.fetch
      .mockResolvedValueOnce({ followed: false })
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ followed: true })

    const { follow } = setup()

    await follow.load()
    await follow.toggle()
    expect(follow.followed.value).toBe(false)
    expect(follow.isSaving.value).toBe(false)
    expect(follow.saveError.value).toBe('We couldn’t save this change. Try again.')
    await follow.toggle()
    expect(follow.followed.value).toBe(true)
    expect(follow.saveError.value).toBe('')

    expect(telemetry).toHaveBeenCalledWith({
      error: failure,
      message: 'Catalog follow update request failed.'
    })
  })

  it('blocks repeated mutations while a save is pending', async () => {
    const pending = Promise.withResolvers<unknown>()

    harness.fetch
      .mockResolvedValueOnce({ followed: false })
      .mockReturnValueOnce(pending.promise)

    const { follow } = setup()

    await follow.load()

    const firstSave = follow.toggle()
    const repeatedSave = follow.toggle()

    expect(follow.followed.value).toBe(true)
    expect(follow.isSaving.value).toBe(true)
    expect(harness.fetch).toHaveBeenCalledTimes(2)
    pending.resolve({ followed: true })
    await Promise.all([firstSave, repeatedSave])
    expect(follow.followed.value).toBe(true)
    expect(follow.isSaving.value).toBe(false)
  })

  it('rolls back a failed unfollow and retries with DELETE', async () => {
    const telemetry = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {
      // The transport failure is expected in this rollback scenario.
    })

    harness.fetch
      .mockResolvedValueOnce({ followed: true })
      .mockRejectedValueOnce({ statusCode: 503 })
      .mockResolvedValueOnce({ followed: false })

    const { follow } = setup()

    await follow.load()
    await follow.toggle()
    expect(follow.followed.value).toBe(true)
    expect(follow.saveError.value).toBe('We couldn’t save this change. Try again.')
    await follow.toggle()
    expect(follow.followed.value).toBe(false)
    expect(follow.saveError.value).toBe('')

    expect(harness.fetch).toHaveBeenNthCalledWith(
      2,
      `/api/catalog/items/${id}/follow`,
      expect.objectContaining({ method: 'DELETE' })
    )

    expect(harness.fetch).toHaveBeenNthCalledWith(
      3,
      `/api/catalog/items/${id}/follow`,
      expect.objectContaining({ method: 'DELETE' })
    )

    expect(telemetry).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed load and mutation responses', async () => {
    const log = vi.spyOn(globalThis.console, 'error').mockImplementation(() => {
      // Inspect expected contract failures below.
    })

    harness.fetch.mockResolvedValueOnce({ followed: 'yes' })

    const { follow } = setup()

    await follow.load()
    expect(follow.status.value).toBe('error')
    harness.fetch.mockResolvedValueOnce({ followed: false })
    await follow.load()
    harness.fetch.mockResolvedValueOnce({ followed: false })
    await follow.toggle()
    expect(follow.followed.value).toBe(false)
    expect(follow.saveError.value).toBe('We couldn’t save this change. Try again.')
    expect(log).toHaveBeenCalledTimes(2)
  })

  it('keeps a raw load transport failure in client telemetry', async () => {
    const failure = new Error('controlled browser transport failure')

    const telemetry = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {
      // The raw transport failure is asserted below.
    })

    harness.fetch.mockRejectedValueOnce(failure)

    const { follow } = setup()

    await follow.load()
    expect(follow.status.value).toBe('error')

    expect(telemetry).toHaveBeenCalledWith({
      error: failure,
      message: 'Catalog follow status request failed.'
    })
  })

  it('distinguishes authentication loss while loading and saving', async () => {
    harness.fetch.mockRejectedValueOnce({ statusCode: 401 })

    const loading = setup()

    await loading.follow.load()
    expect(loading.follow.status.value).toBe('idle')
    expect(loading.follow.unauthorized.value).toBe('load')

    harness.fetch
      .mockResolvedValueOnce({ followed: false })
      .mockRejectedValueOnce({ statusCode: 401 })

    const saving = setup()

    await saving.follow.load()
    await saving.follow.toggle()
    expect(saving.follow.followed.value).toBe(false)
    expect(saving.follow.unauthorized.value).toBe('mutation')
    expect(saving.follow.saveError.value).toBe('')

    harness.fetch
      .mockResolvedValueOnce({ followed: true })
      .mockRejectedValueOnce({ statusCode: 401 })

    const unfollowing = setup()

    await unfollowing.follow.load()
    await unfollowing.follow.toggle()
    expect(unfollowing.follow.followed.value).toBe(true)
    expect(unfollowing.follow.unauthorized.value).toBe('mutation')
    expect(unfollowing.follow.saveError.value).toBe('')
  })

  it('clears account state and cancels a late response after sign-out', async () => {
    const pending = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(pending.promise)

    const signedOut = setup()
    const load = signedOut.follow.load()
    const signal = harness.fetch.mock.calls[0]?.[1].signal

    signedOut.account.value = null

    expect(signal?.aborted).toBe(true)
    expect(signedOut.follow.status.value).toBe('idle')
    pending.resolve({ followed: true })

    await load

    expect(signedOut.follow.followed.value).toBe(false)
  })

  it('cancels the old account response and loads the new account state', async () => {
    const oldAccountResponse = Promise.withResolvers<unknown>()
    const newAccountResponse = Promise.withResolvers<unknown>()

    harness.fetch
      .mockReturnValueOnce(oldAccountResponse.promise)
      .mockReturnValueOnce(newAccountResponse.promise)

    const switched = setup(null, true)

    switched.account.value = accountId

    const oldSignal = harness.fetch.mock.calls[0]?.[1].signal

    switched.account.value = '01991a00-0000-7000-8000-000000000003'

    expect(oldSignal?.aborted).toBe(true)
    expect(harness.fetch).toHaveBeenCalledTimes(2)
    oldAccountResponse.resolve({ followed: false })
    newAccountResponse.resolve({ followed: true })

    await vi.waitFor(() => {
      expect(switched.follow.status.value).toBe('loaded')
    })

    expect(switched.follow.followed.value).toBe(true)
  })
})
