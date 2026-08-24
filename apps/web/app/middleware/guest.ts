import { defineNuxtRouteMiddleware, navigateTo, useNuxtApp } from '#app'
import { sanitizeRedirectTo } from '@tv/shared/redirect'
import { useAuthSession } from '~/composables/use-auth-session.ts'

export default defineNuxtRouteMiddleware(async (to) => {
  const { restoreSession, state } = useAuthSession()
  const nuxtApp = useNuxtApp()
  const shouldRevalidateSession = import.meta.client && nuxtApp.isHydrating === false

  await restoreSession({ force: shouldRevalidateSession })

  if (state.value.status !== 'authenticated') {
    return
  }

  const redirectTo = sanitizeRedirectTo(to.query.redirectTo)

  return navigateTo(redirectTo, { replace: true })
})
