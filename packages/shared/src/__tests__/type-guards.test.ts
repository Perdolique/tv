import { describe, expect, it } from 'vitest'
import { isRecord } from '../type-guards.ts'

describe('isRecord()', () => {
  it('accepts non-null objects', () => {
    expect(isRecord({ value: true })).toBe(true)
    expect(isRecord(Object.create(null))).toBe(true)
  })

  it.each([
    null,
    ['value'],
    'value',
    1,
    true
  ])('rejects %j', (value) => {
    expect(isRecord(value)).toBe(false)
  })
})
