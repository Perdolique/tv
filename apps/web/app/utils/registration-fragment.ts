import { isVerificationToken } from '@tv/shared/verification'

type RegistrationFragment =
  | { status: 'absent'; }
  | { status: 'invalid'; }
  | { status: 'valid'; token: string; }

function parseRegistrationFragment(hash: string): RegistrationFragment {
  if (hash === '') {
    return { status: 'absent' }
  }

  const parameters = new globalThis.URLSearchParams(
    hash.startsWith('#') ? hash.slice(1) : hash
  )

  const token = parameters.get('token')

  if (!isVerificationToken(token)) {
    return { status: 'invalid' }
  }

  return {
    status: 'valid',
    token
  }
}

export {
  parseRegistrationFragment
}

export type { RegistrationFragment }
