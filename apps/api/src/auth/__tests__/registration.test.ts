import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectDatabaseAdapter } from '../../database.ts'
import { createAuthApp } from '../routes.ts'
import { verifyTurnstileToken } from '../turnstile.ts'

vi.mock(import('../../database.ts'), () => {
  return { connectDatabaseAdapter: vi.fn() }
})

vi.mock(import('../turnstile.ts'), async (importOriginal) => {
  const turnstile = await importOriginal()

  return {
    ...turnstile,
    verifyTurnstileToken: vi.fn()
  }
})

const registrationToken = 'a'.repeat(43)

const registrationRequests = [
  {
    path: '/api/auth/register',

    body: {
      email: 'registration@example.com',
      redirectTo: '/',
      'cf-turnstile-response': 'registration-challenge'
    }
  },
  {
    path: '/api/auth/register/complete',

    body: {
      token: registrationToken,
      password: 'A long registration password'
    }
  }
]

describe('registration availability', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it.each(registrationRequests)('blocks $path before downstream work when disabled', async ({ path, body }) => {
    const app = createAuthApp()
    const limit = vi.fn().mockResolvedValue({ success: true })
    const send = vi.fn()
    const url = `https://tv-api.test${path}`
    const requestBody = JSON.stringify(body)

    const response = await app.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody
    }, {
      REGISTRATION_ENABLED: 'false',
      REGISTRATION_EMAIL_RATE_LIMITER: { limit },
      REGISTRATION_ACTIVATION_RATE_LIMITER: { limit },
      EMAIL: { send }
    })

    expect(response.status).toBe(403)

    const cacheControl = response.headers.get('Cache-Control')

    expect(cacheControl).toBe('no-store')

    const responseBody = response.json()

    await expect(responseBody).resolves.toStrictEqual({ error: {
      code: 'REGISTRATION_DISABLED',
      message: 'Registration is not available.'
    } })

    expect(verifyTurnstileToken).not.toHaveBeenCalled()
    expect(limit).not.toHaveBeenCalled()
    expect(connectDatabaseAdapter).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('does not enable registration when the flag is missing', async () => {
    const app = createAuthApp()

    const response = await app.request('https://tv-api.test/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }, {})

    expect(response.status).toBe(403)
    expect(connectDatabaseAdapter).not.toHaveBeenCalled()
  })

  it.each(registrationRequests)('preserves validation for $path when enabled', async ({ path }) => {
    const app = createAuthApp()
    const url = `https://tv-api.test${path}`

    const response = await app.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }, { REGISTRATION_ENABLED: 'true' })

    expect(response.status).toBe(400)
  })

  it('keeps anonymous sessions and sign-in available when registration is disabled', async () => {
    const app = createAuthApp()
    const bindings = { REGISTRATION_ENABLED: 'false' }
    const session = await app.request('https://tv-api.test/api/auth/session', {}, bindings)

    const signIn = await app.request('https://tv-api.test/api/auth/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }, bindings)

    expect(session.status).toBe(200)

    const sessionBody = session.json()

    await expect(sessionBody).resolves.toStrictEqual({ user: null })
    expect(signIn.status).toBe(400)
    expect(connectDatabaseAdapter).not.toHaveBeenCalled()
  })
})
