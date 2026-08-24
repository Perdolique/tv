import * as v from 'valibot'
import { describe, expect, it } from 'vitest'

import {
  authSessionResponseSchema,
  registrationCompletionResponseSchema,
  registrationResponseSchema,
  signInResponseSchema
} from '../auth-response.ts'

describe('auth session response validation', () => {
  it('accepts an authenticated session and strips unknown properties', () => {
    const result = v.parse(authSessionResponseSchema, {
      requestId: 'request-1',

      user: {
        email: 'viewer@example.com',
        id: 'user-1',
        role: 'admin'
      }
    })

    expect(result).toStrictEqual({
      user: {
        email: 'viewer@example.com',
        id: 'user-1'
      }
    })
  })

  it('accepts an anonymous session', () => {
    expect(v.parse(authSessionResponseSchema, { user: null })).toStrictEqual({
      user: null
    })
  })

  it.each([
    null,
    {},
    { user: {} },
    { user: {
      email: 'viewer@example.com',
      id: 42
    } }
  ])('rejects malformed session response %j', (value) => {
    expect(v.safeParse(authSessionResponseSchema, value).success).toBe(false)
  })
})

describe('registration response validation', () => {
  it('accepts the registration response and strips unknown properties', () => {
    expect(v.parse(registrationResponseSchema, {
      requestId: 'request-1',
      status: 'accepted'
    })).toStrictEqual({
      status: 'accepted'
    })
  })

  it.each([
    {},
    { status: 'created' }
  ])('rejects malformed registration response %j', (value) => {
    expect(v.safeParse(registrationResponseSchema, value).success).toBe(false)
  })
})

describe('sign-in response validation', () => {
  it('accepts a response with an authenticated user', () => {
    expect(v.parse(signInResponseSchema, {
      user: {
        email: 'viewer@example.com',
        id: 'user-1'
      }
    })).toStrictEqual({
      user: {
        email: 'viewer@example.com',
        id: 'user-1'
      }
    })
  })

  it('rejects a response without an authenticated user', () => {
    expect(v.safeParse(signInResponseSchema, { user: null }).success).toBe(false)
  })
})

describe('registration completion response validation', () => {
  it('accepts the created account handoff', () => {
    expect(v.parse(registrationCompletionResponseSchema, {
      email: 'viewer@example.com',
      redirectTo: '/?view=recent',
      status: 'created'
    })).toStrictEqual({
      email: 'viewer@example.com',
      redirectTo: '/?view=recent',
      status: 'created'
    })
  })

  it.each([
    { status: 'created' },
    {
      email: 'viewer@example.com',
      redirectTo: '/',
      status: 'accepted'
    }
  ])('rejects malformed completion response %j', (value) => {
    expect(v.safeParse(registrationCompletionResponseSchema, value).success).toBe(false)
  })
})
