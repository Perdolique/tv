import type { AuthSessionResponse, AuthUser } from '~/types/auth.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAuthUser(value: unknown): value is AuthUser {
  return isRecord(value)
    && typeof value.email === 'string'
    && typeof value.id === 'string'
}

function isAuthSessionResponse(value: unknown): value is AuthSessionResponse {
  return isRecord(value) && (value.user === null || isAuthUser(value.user))
}

export {
  isAuthSessionResponse,
  isAuthUser
}
