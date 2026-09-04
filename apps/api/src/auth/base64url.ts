function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')

  const paddingLength = (4 - (base64.length % 4)) % 4
  const paddedBase64 = base64.padEnd(base64.length + paddingLength, '=')
  const binary = atob(paddedBase64)

  return Uint8Array.from(
    binary,

    // oxlint-disable-next-line unicorn/prefer-code-point -- atob returns a binary string of UTF-16 code units.
    character => character.charCodeAt(0)
  )
}

function encodeBase64Url(value: Uint8Array): string {
  const binary = Array.from(
    value,

    // oxlint-disable-next-line unicorn/prefer-code-point -- btoa consumes a binary string of UTF-16 code units.
    byte => String.fromCharCode(byte)
  ).join('')

  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

export {
  decodeBase64Url,
  encodeBase64Url
}
