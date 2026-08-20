function isLoopbackHostname(hostname: string): boolean {
  return hostname === '127.0.0.1'
    || hostname === '[::1]'
    || hostname === '::1'
    || hostname === 'localhost'
}

export {
  isLoopbackHostname
}
