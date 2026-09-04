import { describe, expect, it } from 'vitest'

import {
  createExistingAccountEmail,
  createSignInUrl,
  createVerificationEmail,
  createVerificationUrl,
  EMAIL_SENDER
} from '../email.ts'

const WEB_ORIGIN = 'https://tv.perd.dev'

describe('registration email content', () => {
  it('builds a fragment verification URL without putting the token in the query', () => {
    const token = 'a'.repeat(43)
    const verificationUrl = createVerificationUrl(WEB_ORIGIN, token)
    const url = new URL(verificationUrl)

    expect(url.origin).toBe(WEB_ORIGIN)
    expect(url.pathname).toBe('/register')
    expect(url.search).toBe('')
    expect(url.hash).toBe(`#token=${token}`)
  })

  it('builds text and HTML verification messages with the one-hour expiry', () => {
    const token = 'a'.repeat(43)

    const message = createVerificationEmail({
      email: 'person@example.com',
      token,
      webOrigin: WEB_ORIGIN
    })

    expect(message).toMatchObject({
      from: EMAIL_SENDER,
      subject: 'Verify your email for TV',
      to: 'person@example.com'
    })

    expect(message.text).toContain(`${WEB_ORIGIN}/register#token=${token}`)
    expect(message.text).toContain('expires in one hour')
    expect(message.text).toContain('ignore this email')
    expect(message.html).toContain(`href="${WEB_ORIGIN}/register#token=${token}"`)
    expect(message.html).toContain('expires in one hour')
  })

  it('preserves the safe redirect in an existing-account sign-in notice', () => {
    const redirectTo = '/?view=recent&sort=title'
    const signInUrl = createSignInUrl(WEB_ORIGIN, redirectTo)

    const message = createExistingAccountEmail({
      email: 'person@example.com',
      redirectTo,
      webOrigin: WEB_ORIGIN
    })

    expect(new URL(signInUrl).searchParams.get('redirectTo')).toBe(redirectTo)

    expect(message).toMatchObject({
      from: EMAIL_SENDER,
      subject: 'A registration request was made for TV',
      to: 'person@example.com'
    })

    expect(message.text).toContain(signInUrl)
    expect(message.html).toContain('Sign in to TV')
    expect(message.html).toContain(`href="${signInUrl}"`)
    expect(message.text).not.toContain('password')
  })
})
