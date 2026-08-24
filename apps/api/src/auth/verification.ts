import { encodeBase64Url } from './base64url.ts'
import { hashSha256 } from './hashing.ts'

const VERIFICATION_TOKEN_BYTE_LENGTH = 32

function createVerificationToken(): string {
  const bytes = new Uint8Array(VERIFICATION_TOKEN_BYTE_LENGTH)

  crypto.getRandomValues(bytes)

  return encodeBase64Url(bytes)
}

async function hashVerificationToken(token: string): Promise<string> {
  return hashSha256(token)
}

export {
  createVerificationToken,
  hashVerificationToken,
  VERIFICATION_TOKEN_BYTE_LENGTH
}
