import { defineNuxtRouteMiddleware, navigateTo, useRequestEvent } from '#app'
import { setResponseStatus } from 'h3'
import { useCatalogImportAccess } from '~/composables/use-catalog-import-access.ts'

export default defineNuxtRouteMiddleware(async (to) => {
  const { check } = useCatalogImportAccess()
  const status = await check()

  if (status === 'unauthorized') {
    return navigateTo({
      path: '/sign-in',
      query: { redirectTo: to.fullPath }
    }, { replace: true })
  }

  if (status === 'denied' && import.meta.server) {
    const event = useRequestEvent()

    if (event !== undefined) {
      setResponseStatus(event, 403)
    }
  }
})
