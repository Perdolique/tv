const FALLBACK_REDIRECT = '/'
const INTERNAL_ORIGIN = 'https://tv.invalid'
const AUTH_PATHS = new Set(['/register', '/sign-in'])

function sanitizeRedirectTo(value: unknown): string {
  if (typeof value !== 'string' || value === '' || !value.startsWith('/')) {
    return FALLBACK_REDIRECT
  }

  try {
    const target = new globalThis.URL(value, INTERNAL_ORIGIN)

    const normalizedPath = target.pathname.endsWith('/') && target.pathname !== '/'
      ? target.pathname.slice(0, -1)
      : target.pathname

    if (target.origin !== INTERNAL_ORIGIN || AUTH_PATHS.has(normalizedPath)) {
      return FALLBACK_REDIRECT
    }

    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return FALLBACK_REDIRECT
  }
}

export {
  sanitizeRedirectTo
}
