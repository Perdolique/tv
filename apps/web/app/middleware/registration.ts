import { defineNuxtRouteMiddleware, navigateTo, useRequestURL, useRouter, useRuntimeConfig } from '#app'
import { sanitizeRedirectTo } from '@tv/shared/redirect'

export default defineNuxtRouteMiddleware(async (to) => {
  const { registrationEnabled } = useRuntimeConfig().public

  if (registrationEnabled === true) {
    return
  }

  const redirectTo = sanitizeRedirectTo(to.query.redirectTo)

  const signInLocation = {
    path: '/sign-in',
    query: { redirectTo }
  }

  if (import.meta.server) {
    const router = useRouter()
    const { href } = router.resolve(signInLocation)
    const requestUrl = useRequestURL({ xForwardedHost: false })
    const destination = new globalThis.URL(href, requestUrl)

    // Nuxt strips empty fragments from internal redirects.
    // An absolute redirect clears inherited tokens before guest redirects run.
    destination.hash = '#'

    const redirectUrl = destination.toString()

    return navigateTo(redirectUrl, {
      external: true,
      replace: true
    })
  }

  return navigateTo(signInLocation, { replace: true })
})
