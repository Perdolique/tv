import type { RouteMiddleware } from '#app'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => {
  return {
    navigateTo: vi.fn(),
    registrationEnabled: false
  }
})

// oxlint-disable-next-line vitest/prefer-import-in-mock -- The focused mock supplies only the runtime configuration used by this middleware.
vi.mock('#app', () => {
  return {
    defineNuxtRouteMiddleware: (middleware: RouteMiddleware) => middleware,
    navigateTo: harness.navigateTo,

    useRuntimeConfig: () => {
      return { public: { registrationEnabled: harness.registrationEnabled } }
    }
  }
})

const { default: registration } = await import('../registration.ts')

const router = createRouter({
  history: createMemoryHistory(),

  routes: [{
    path: '/register',
    component: {}
  }]
})

describe('registration navigation', () => {
  beforeEach(() => {
    harness.navigateTo.mockReset()

    harness.registrationEnabled = false
  })

  it.each([
    ['/titles/example', '/titles/example'],
    ['https://outside.example', '/']
  ])('redirects disabled registration with a safe return destination for %s', async (redirectTo, expected) => {
    await router.push({
      path: '/register',
      query: { redirectTo }
    })

    const route = router.currentRoute.value

    await registration(route, route)

    expect(harness.navigateTo).toHaveBeenCalledExactlyOnceWith({
      path: '/sign-in',
      query: { redirectTo: expected }
    }, { replace: true })
  })

  it('keeps the registration page available when enabled', async () => {
    harness.registrationEnabled = true

    await router.push('/register')

    const route = router.currentRoute.value

    await registration(route, route)
    expect(harness.navigateTo).not.toHaveBeenCalled()
  })
})
