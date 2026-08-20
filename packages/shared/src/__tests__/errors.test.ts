import { describe, expect, it } from 'vitest'
import { findRootCause, serializeError } from '../errors.ts'

describe('findRootCause()', () => {
  it('returns the deepest error cause', () => {
    const rootCause = new Error('database unavailable')
    const serviceError = new Error('service failed', { cause: rootCause })
    const requestError = new Error('request failed', { cause: serviceError })

    expect(findRootCause(requestError)).toBe(rootCause)
  })

  it('preserves a non-error cause', () => {
    const error = new Error('request failed', { cause: 'socket closed' })

    expect(findRootCause(error)).toBe('socket closed')
  })
})

describe('serializeError()', () => {
  it('serializes error details including a non-empty stack', () => {
    const error = new TypeError('invalid response')

    error.stack = 'TypeError: invalid response\n    at request'

    expect(serializeError(error)).toStrictEqual({
      message: 'invalid response',
      name: 'TypeError',
      stack: 'TypeError: invalid response\n    at request'
    })
  })

  it('omits an empty stack', () => {
    const error = new Error('invalid response')

    error.stack = ''

    expect(serializeError(error)).toStrictEqual({
      message: 'invalid response',
      name: 'Error'
    })
  })

  it('serializes non-error values without inventing an error type', () => {
    expect(serializeError('socket closed')).toStrictEqual({
      message: 'socket closed',
      name: 'UnknownError'
    })
  })
})
