function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function hashSha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)

  return toHex(digest)
}

async function hashSha1(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-1', bytes)

  return toHex(digest).toUpperCase()
}

export {
  hashSha1,
  hashSha256
}
