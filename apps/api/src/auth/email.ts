const EMAIL_SENDER = {
  email: 'noreply@perd.dev',
  name: 'TV'
} as const

interface VerificationEmailInput {
  email: string;
  token: string;
  webOrigin: string;
}

interface ExistingAccountEmailInput {
  email: string;
  redirectTo: string;
  webOrigin: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function createVerificationUrl(webOrigin: string, token: string): string {
  const url = new URL('/register', webOrigin)

  url.hash = new URLSearchParams({ token }).toString()

  return url.toString()
}

function createSignInUrl(webOrigin: string, redirectTo: string): string {
  const url = new URL('/sign-in', webOrigin)

  url.searchParams.set('redirectTo', redirectTo)

  return url.toString()
}

function createVerificationEmail(input: VerificationEmailInput): EmailMessageBuilder {
  const verificationUrl = createVerificationUrl(input.webOrigin, input.token)
  const escapedVerificationUrl = escapeHtml(verificationUrl)

  return {
    from: EMAIL_SENDER,

    html: [
      '<p>Confirm this email address to create your TV account.</p>',
      `<p><a href="${escapedVerificationUrl}">Verify your email</a></p>`,
      '<p>This link expires in one hour.</p>',
      '<p>If you did not request this, you can ignore this email.</p>'
    ].join(''),

    subject: 'Verify your email for TV',

    text: [
      'Confirm this email address to create your TV account:',
      verificationUrl,
      '',
      'This link expires in one hour.',
      'If you did not request this, you can ignore this email.'
    ].join('\n'),

    to: input.email
  }
}

function createExistingAccountEmail(input: ExistingAccountEmailInput): EmailMessageBuilder {
  const signInUrl = createSignInUrl(input.webOrigin, input.redirectTo)
  const escapedSignInUrl = escapeHtml(signInUrl)

  return {
    from: EMAIL_SENDER,

    html: [
      '<p>Someone requested registration for this email address on TV.</p>',
      '<p>If this was you, sign in to continue:</p>',
      `<p><a href="${escapedSignInUrl}">Sign in to TV</a></p>`,
      '<p>If you did not request this, you can ignore this email.</p>'
    ].join(''),

    subject: 'A registration request was made for TV',

    text: [
      'Someone requested registration for this email address on TV.',
      'If this was you, sign in to continue:',
      signInUrl,
      '',
      'If you did not request this, you can ignore this email.'
    ].join('\n'),

    to: input.email
  }
}

export {
  createExistingAccountEmail,
  createSignInUrl,
  createVerificationEmail,
  createVerificationUrl,
  EMAIL_SENDER
}

export type {
  ExistingAccountEmailInput,
  VerificationEmailInput
}
