import { describe, expect, it } from 'vitest'
import { empty, emptySummary, harness, setup, summary, viewing } from '../../testing/catalog-viewings-harness.ts'

describe('catalog viewing stale requests', () => {
  it.each(['account', 'title'] as const)('clears personal data and ignores late reads on a %s change', async kind => {
    const old = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(old.promise)

    const { account, item, state } = setup()
    const load = state.load()
    const signal = harness.fetch.mock.calls[0]?.[1].signal

    // oxlint-disable-next-line vitest/no-conditional-in-test -- Each table case changes one identity source.
    if (kind === 'account') { account.value = 'account-two' } else { item.value = '01991a00-0000-7000-8000-000000000003' }

    expect(signal?.aborted).toBe(true)

    old.resolve({
      items: [viewing],
      summary,
      nextCursor: null
    })

    await load

    expect(state.items.value).toStrictEqual([])
    expect(state.summary.value).toStrictEqual(emptySummary)
  })

  it('ignores late mutations after an account change', async () => {
    harness.fetch.mockResolvedValueOnce(empty)

    const { account, state } = setup()

    await state.load()

    const old = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(old.promise)

    const save = state.create('current')

    account.value = 'account-two'

    old.resolve({
      viewing,
      summary
    })

    await expect(save).resolves.toBe(false)
    expect(state.summary.value).toStrictEqual(emptySummary)
    expect(state.items.value).toStrictEqual([])
    expect(state.isSaving.value).toBe(false)
    expect(harness.fetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    {
      identity: 'account',
      statusCode: 401,
      nextAccount: 'account-two',
      nextTitle: '01991a00-0000-7000-8000-000000000001'
    },
    {
      identity: 'account',
      statusCode: 503,
      nextAccount: 'account-two',
      nextTitle: '01991a00-0000-7000-8000-000000000001'
    },
    {
      identity: 'title',
      statusCode: 401,
      nextAccount: 'account-one',
      nextTitle: '01991a00-0000-7000-8000-000000000003'
    },
    {
      identity: 'title',
      statusCode: 503,
      nextAccount: 'account-one',
      nextTitle: '01991a00-0000-7000-8000-000000000003'
    },
    {
      identity: 'sign-out',
      statusCode: 401,
      nextAccount: null,
      nextTitle: '01991a00-0000-7000-8000-000000000001'
    },
    {
      identity: 'sign-out',
      statusCode: 503,
      nextAccount: null,
      nextTitle: '01991a00-0000-7000-8000-000000000001'
    }
  ] as const)('ignores a rejected mutation after $identity with a late $statusCode response', async ({ statusCode, nextAccount, nextTitle }) => {
    harness.fetch.mockResolvedValueOnce(empty)

    const { account, item, state } = setup()

    await state.load()

    const pending = Promise.withResolvers<unknown>()

    harness.fetch.mockReturnValueOnce(pending.promise)

    const saving = state.create('current')
    const signal = harness.fetch.mock.calls[1]?.[1].signal

    account.value = nextAccount
    item.value = nextTitle

    expect(signal?.aborted).toBe(true)

    pending.reject({
      statusCode,
      data: { error: { fields: { completedOn: 'Stale date error.' } } }
    })

    await expect(saving).resolves.toBe(false)
    expect(state.items.value).toStrictEqual([])
    expect(state.summary.value).toStrictEqual(emptySummary)
    expect(state.unauthorized.value).toBeNull()
    expect(state.saveError.value).toBe('')
    expect(state.readError.value).toBe('')
    expect(state.fields.value).toStrictEqual({})
    expect(state.isSaving.value).toBe(false)
    expect(globalThis.console.warn).not.toHaveBeenCalled()
    expect(harness.fetch).toHaveBeenCalledTimes(2)
  })

})
