import { useRequestFetch, useState } from '#app'
import type { AuthSessionState, AuthUser } from '~/types/auth.ts'
import { isAuthSessionResponse } from '~/utils/auth-response.ts'

interface RestoreSessionOptions {
  force?: boolean;
}

function useAuthSession() {
  const state = useState<AuthSessionState>('auth-session', () => {
    return { status: 'unknown' }
  })

  const requestFetch = useRequestFetch()

  async function restoreSession(options: RestoreSessionOptions = {}): Promise<void> {
    if (state.value.status !== 'unknown' && options.force !== true) {
      return
    }

    try {
      const response: unknown = await requestFetch('/api/auth/session')

      if (!isAuthSessionResponse(response)) {
        state.value = { status: 'error' }
        return
      }

      state.value = response.user === null
        ? { status: 'anonymous' }
        : {
            status: 'authenticated',
            user: response.user
          }
    } catch {
      state.value = { status: 'error' }
    }
  }

  function setAuthenticated(user: AuthUser): void {
    state.value = {
      status: 'authenticated',
      user
    }
  }

  function setAnonymous(): void {
    state.value = { status: 'anonymous' }
  }

  return {
    restoreSession,
    setAnonymous,
    setAuthenticated,
    state
  }
}

export {
  useAuthSession
}
