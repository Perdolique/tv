import { scrypt as deriveKeyWithScrypt, timingSafeEqual } from 'node:crypto'
import { decodeBase64Url, encodeBase64Url } from './base64url.ts'

const SCRYPT_LOG_N = 14
const SCRYPT_N = 2 ** SCRYPT_LOG_N
const SCRYPT_R = 8
const SCRYPT_P = 5
const SCRYPT_SALT_LENGTH = 16
const SCRYPT_KEY_LENGTH = 64
const SCRYPT_MAX_MEMORY = 2 ** 25
const SCRYPT_HASH_PATTERN = /^\$scrypt\$ln=14,r=8,p=5\$(?<salt>[A-Za-z0-9_-]+)\$(?<hash>[A-Za-z0-9_-]+)$/u

async function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  // oxlint-disable-next-line promise/avoid-new -- Node's asynchronous scrypt API is callback-only.
  return new Promise((resolve, reject) => {
    deriveKeyWithScrypt(password, salt, SCRYPT_KEY_LENGTH, {
      'N': SCRYPT_N,
      maxmem: SCRYPT_MAX_MEMORY,
      'p': SCRYPT_P,
      'r': SCRYPT_R
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Node's asynchronous scrypt API is callback-only.
    }, (error, key) => {
      if (error !== null) {
        reject(error)

        return
      }

      resolve(key)
    })
  })
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)

  crypto.getRandomValues(bytes)

  return bytes
}

function parsePasswordHash(value: string): {
  hash: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
} {
  const match = SCRYPT_HASH_PATTERN.exec(value)

  if (!match) {
    throw new Error('Unsupported password hash format')
  }

  const {
    hash: hashValue,
    salt: saltValue
  } = match.groups ?? {}

  if (
    saltValue === undefined
    || saltValue === ''
    || hashValue === undefined
    || hashValue === ''
  ) {
    throw new Error('Incomplete password hash')
  }

  const salt = decodeBase64Url(saltValue)
  const hash = decodeBase64Url(hashValue)

  if (salt.length !== SCRYPT_SALT_LENGTH || hash.length !== SCRYPT_KEY_LENGTH) {
    throw new Error('Invalid password hash length')
  }

  return {
    hash,
    salt
  }
}

async function hashPassword(password: string): Promise<string> {
  const normalizedPassword = password.normalize('NFC')
  const salt = randomBytes(SCRYPT_SALT_LENGTH)
  const hash = await deriveKey(normalizedPassword, salt)
  const encodedSalt = encodeBase64Url(salt)
  const encodedHash = encodeBase64Url(hash)

  return `$scrypt$ln=${SCRYPT_LOG_N},r=${SCRYPT_R},p=${SCRYPT_P}$${encodedSalt}$${encodedHash}`
}

async function verifyPassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  const normalizedPassword = password.normalize('NFC')
  const parsedHash = parsePasswordHash(passwordHash)
  const actualHash = await deriveKey(normalizedPassword, parsedHash.salt)

  return timingSafeEqual(actualHash, parsedHash.hash)
}

export {
  hashPassword,
  verifyPassword
}
