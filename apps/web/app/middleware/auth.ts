import { defineNuxtRouteMiddleware, navigateTo, useNuxtApp } from '#app'
import { useAuthSession } from '~/composables/use-auth-session.ts'
import { sanitizeRedirectTo } from '~/utils/redirect.ts'

export default defineNuxtRouteMiddleware(async (to) => {
  const { restoreSession, state } = useAuthSession()
  const nuxtApp = useNuxtApp()
  const shouldRevalidateSession = import.meta.client && nuxtApp.isHydrating === false

  await restoreSession({ force: shouldRevalidateSession })

  if (state.value.status !== 'anonymous') {
    return
  }

  const redirectTo = sanitizeRedirectTo(to.fullPath)

  return navigateTo({
    path: '/sign-in',
    query: { redirectTo }
  }, { replace: true })
})
