const FALLBACK_REDIRECT = '/'
const INTERNAL_ORIGIN = 'https://tv.invalid'
const AUTH_PATHS = new Set(['/register', '/sign-in'])

function sanitizeRedirectTo(value: unknown): string {
  if (typeof value !== 'string' || value === '' || !value.startsWith('/')) {
    return FALLBACK_REDIRECT
  }

  try {
    // oxlint-disable-next-line eslint/no-undef -- URL is provided by Node.js, browsers, and Workers.
    const target = new URL(value, INTERNAL_ORIGIN)

    const normalizedPath = target.pathname.endsWith('/') && target.pathname !== '/'
      ? target.pathname.slice(0, -1)
      : target.pathname

    if (target.origin !== INTERNAL_ORIGIN || AUTH_PATHS.has(normalizedPath)) {
      return FALLBACK_REDIRECT
    }

    return `${target.pathname}${target.search}`
  } catch {
    return FALLBACK_REDIRECT
  }
}

export { sanitizeRedirectTo }
