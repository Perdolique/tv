const TURNSTILE_ACTIONS = {
  register: 'register',
  signIn: 'sign_in'
} as const

const TURNSTILE_RESPONSE_FIELD = 'cf-turnstile-response'

type TurnstileAction = typeof TURNSTILE_ACTIONS[keyof typeof TURNSTILE_ACTIONS]

export {
  TURNSTILE_ACTIONS,
  TURNSTILE_RESPONSE_FIELD
}

export type {
  TurnstileAction
}
