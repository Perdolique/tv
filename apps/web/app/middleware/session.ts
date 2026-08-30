import { defineNuxtRouteMiddleware, useNuxtApp } from '#app'
import { useAuthSession } from '~/composables/use-auth-session.ts'

export default defineNuxtRouteMiddleware(async () => {
  const { restoreSession } = useAuthSession()
  const nuxtApp = useNuxtApp()
  const shouldRevalidateSession = import.meta.client && nuxtApp.isHydrating === false

  await restoreSession({ force: shouldRevalidateSession })
})
