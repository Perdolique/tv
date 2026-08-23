import type { Ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface Deferred<Value> {
  promise: Promise<Value>;
  reject: (reason: unknown) => void;
  resolve: (value: Value) => void;
}

const harness = vi.hoisted(() => {
  return {
    requestFetch: vi.fn(),
    states: new Map<string, { value: unknown; }>()
  }
})

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The string form keeps this focused mock independent of Nuxt's full overloaded useState type.
vi.mock('#app', () => {
  return {
    useRequestFetch: () => harness.requestFetch,

    useState: <Value>(key: string, initializer: () => Value): Ref<Value> => {
      const existingState = harness.states.get(key)

      if (existingState !== undefined) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The state is stored under the same typed key supplied by the composable.
        return existingState as Ref<Value>
      }

      const state = { value: initializer() }

      harness.states.set(key, state)

      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This minimal Ref shape is sufficient for useState value access in the composable.
      return state as Ref<Value>
    }
  }
})

const { useAuthSession } = await import('../use-auth-session.ts')

function createDeferred<Value>(): Deferred<Value> {
  const controls: Partial<Pick<Deferred<Value>, 'reject' | 'resolve'>> = {}

  // oxlint-disable-next-line promise/avoid-new -- The test controls when an in-flight session request settles.
  const promise = new Promise<Value>((resolve, reject) => {
    controls.resolve = resolve
    controls.reject = reject
  })

  return {
    promise,

    reject(reason) {
      controls.reject?.(reason)
    },

    resolve(value) {
      controls.resolve?.(value)
    }
  }
}

describe(useAuthSession, () => {
  beforeEach(() => {
    harness.requestFetch.mockReset()
    harness.states.clear()
  })

  it('does not let an older restore overwrite a newer authenticated session', async () => {
    const sessionResponse = createDeferred<unknown>()

    harness.requestFetch.mockReturnValue(sessionResponse.promise)

    const auth = useAuthSession()
    const restore = auth.restoreSession({ force: true })

    auth.setAuthenticated({
      email: 'new-session@example.com',
      id: 'new-session'
    })

    sessionResponse.resolve({ user: null })
    await restore

    expect(auth.state.value).toStrictEqual({
      status: 'authenticated',

      user: {
        email: 'new-session@example.com',
        id: 'new-session'
      }
    })
  })

  it('does not let an older restore failure overwrite an explicit sign-out', async () => {
    const sessionResponse = createDeferred<unknown>()

    harness.requestFetch.mockReturnValue(sessionResponse.promise)

    const auth = useAuthSession()
    const restore = auth.restoreSession({ force: true })

    auth.setAnonymous()
    sessionResponse.reject(new Error('stale failure'))
    await restore

    expect(auth.state.value).toStrictEqual({ status: 'anonymous' })
  })
})
