import { defineNuxtRouteMiddleware, useNuxtApp } from '#app'
import { isCatalogQueryOnlyNavigation } from '~/utils/catalog-navigation.ts'
import { useAuthSession } from '~/composables/use-auth-session.ts'

export default defineNuxtRouteMiddleware(async (to, from) => {
  const { restoreSession, state } = useAuthSession()

  if (state.value.status === 'authenticated' && isCatalogQueryOnlyNavigation(to, from)) {
    return
  }

  const nuxtApp = useNuxtApp()
  const shouldRevalidateSession = import.meta.client && nuxtApp.isHydrating === false

  await restoreSession({ force: shouldRevalidateSession })
})
