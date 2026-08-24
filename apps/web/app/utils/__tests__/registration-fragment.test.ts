import { describe, expect, it } from 'vitest'
import { parseRegistrationFragment } from '../registration-fragment.ts'

describe(parseRegistrationFragment, () => {
  it('returns an absent state for an empty fragment', () => {
    expect(parseRegistrationFragment('')).toStrictEqual({ status: 'absent' })
  })

  it('reads a valid token from the fragment', () => {
    const token = 'a'.repeat(43)

    expect(parseRegistrationFragment(`#token=${token}`)).toStrictEqual({
      status: 'valid',
      token
    })
  })

  it.each([
    '#token=short',
    '#other=value',
    '#token=',
    '#token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa%2B'
  ])('rejects malformed fragment %s', (hash) => {
    expect(parseRegistrationFragment(hash)).toStrictEqual({ status: 'invalid' })
  })
})
