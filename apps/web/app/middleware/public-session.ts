import { defineNuxtRouteMiddleware, useNuxtApp } from '#app'
import { useAuthSession } from '~/composables/use-auth-session.ts'
import { isCatalogQueryOnlyNavigation } from '~/utils/catalog-navigation.ts'

export default defineNuxtRouteMiddleware((to, from) => {
  const nuxtApp = useNuxtApp()
  const shouldRevalidateSession = import.meta.client && nuxtApp.isHydrating === false
  const isSearchNavigation = isCatalogQueryOnlyNavigation(to, from)

  if (!shouldRevalidateSession || isSearchNavigation) { return }

  const { restoreSession } = useAuthSession()

  // Public catalog requests should not wait for account revalidation.
  void restoreSession({ force: true })
})
