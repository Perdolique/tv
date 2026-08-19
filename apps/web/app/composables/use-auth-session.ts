import { useRequestFetch, useState } from '#app'
import * as v from 'valibot'
import type { AuthSessionState, AuthUser } from '~/types/auth.ts'
import { authSessionResponseSchema } from '~/utils/auth-response.ts'

interface RestoreSessionOptions {
  force?: boolean;
}

function useAuthSession() {
  const state = useState<AuthSessionState>('auth-session', () => {
    return { status: 'unknown' }
  })

  const generation = useState<number>('auth-session-generation', () => 0)
  const requestFetch = useRequestFetch()

  async function restoreSession(options: RestoreSessionOptions = {}): Promise<void> {
    if (state.value.status !== 'unknown' && options.force !== true) {
      return
    }

    const restoreGeneration = generation.value + 1

    generation.value = restoreGeneration

    try {
      const response = await requestFetch('/api/auth/session')
      const { user } = v.parse(authSessionResponseSchema, response)

      if (generation.value !== restoreGeneration) {
        return
      }

      state.value = user === null
        ? { status: 'anonymous' }
        : {
            status: 'authenticated',
            user
          }
    } catch {
      if (generation.value !== restoreGeneration) {
        return
      }

      state.value = { status: 'error' }
    }
  }

  function setAuthenticated(user: AuthUser): void {
    generation.value += 1
    state.value = {
      status: 'authenticated',
      user
    }
  }

  function setAnonymous(): void {
    generation.value += 1
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
