import { defineNuxtRouteMiddleware, navigateTo, useNuxtApp } from '#app'
import { useAuthSession } from '~/composables/use-auth-session.ts'
import { sanitizeRedirectTo } from '~/utils/redirect.ts'

// oxlint-disable-next-line import/no-default-export -- Nuxt route middleware requires a default export.
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
