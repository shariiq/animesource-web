/**
 * Request-nonce scheme for the AniSource gateway.
 *
 * This module is intentionally pure: it holds no secrets, no hosts, and no
 * environment access, so both the server-only gateway and the isomorphic
 * route/client code may import it. The secret always arrives as an argument
 * from server runtime configuration and never enters the browser bundle.
 *
 * A nonce proves the caller rendered site HTML recently: the document
 * response sets it as a readable cookie, and the browser client echoes it
 * on catalog requests. It is a speed bump for naive replay scripts, not
 * identity — rate limits remain the real abuse control, and a script that
 * fetches and parses HTML can still obtain one.
 */

export const REQUEST_NONCE_HEADER = 'x-anisource-nonce'
export const REQUEST_NONCE_COOKIE = 'anisource-nonce'
/** Aligned with the anonymous session lifetime: a visit's nonce lasts the visit. */
export const REQUEST_NONCE_TTL_SECONDS = 12 * 60 * 60
const MAX_NONCE_LENGTH = 256

function rightRotate(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount))
}

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]

const SHA256_ROUND = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

function sha256Digest(data: Uint8Array): Uint8Array {
  let paddedLength = data.length + 1 + 8
  while (paddedLength % 64 !== 0) paddedLength += 1
  const padded = new Uint8Array(paddedLength)
  padded.set(data)
  padded[data.length] = 0x80
  const view = new DataView(padded.buffer)
  // Messages here are far below 2^32 bits, so the high length word stays zero.
  view.setUint32(paddedLength - 4, data.length * 8)
  const h = [...SHA256_INITIAL]
  const w = new Array<number>(64).fill(0)
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) w[index] = view.getUint32(offset + index * 4)
    for (let index = 16; index < 64; index += 1) {
      const s0 = rightRotate(w[index - 15]!, 7) ^ rightRotate(w[index - 15]!, 18) ^ (w[index - 15]! >>> 3)
      const s1 = rightRotate(w[index - 2]!, 17) ^ rightRotate(w[index - 2]!, 19) ^ (w[index - 2]! >>> 10)
      w[index] = (w[index - 16]! + s0 + w[index - 7]! + s1) | 0
    }
    let a = h[0]!
    let b = h[1]!
    let c = h[2]!
    let d = h[3]!
    let e = h[4]!
    let f = h[5]!
    let g = h[6]!
    let hh = h[7]!
    for (let index = 0; index < 64; index += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (hh + s1 + ch + SHA256_ROUND[index]! + w[index]!) | 0
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + maj) | 0
      hh = g
      g = f
      f = e
      e = (d + temp1) | 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) | 0
    }
    h[0] = (h[0]! + a) | 0
    h[1] = (h[1]! + b) | 0
    h[2] = (h[2]! + c) | 0
    h[3] = (h[3]! + d) | 0
    h[4] = (h[4]! + e) | 0
    h[5] = (h[5]! + f) | 0
    h[6] = (h[6]! + g) | 0
    h[7] = (h[7]! + hh) | 0
  }
  const digest = new Uint8Array(32)
  const out = new DataView(digest.buffer)
  for (let index = 0; index < 8; index += 1) out.setUint32(index * 4, h[index]! >>> 0)
  return digest
}

/** Synchronous HMAC-SHA256. Exported so tests can check it against RFC 4231 vectors. */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const keyBlock = key.length > 64 ? sha256Digest(key) : key
  const inner = new Uint8Array(64 + message.length)
  const outer = new Uint8Array(64 + 32)
  for (let index = 0; index < 64; index += 1) {
    const byte = index < keyBlock.length ? keyBlock[index]! : 0
    inner[index] = byte ^ 0x36
    outer[index] = byte ^ 0x5c
  }
  inner.set(message, 64)
  outer.set(sha256Digest(inner), 64)
  return sha256Digest(outer)
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4))
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * Mint a nonce: `<exp>.<tag>` where tag authenticates the expiry. Both
 * arguments arrive from server runtime configuration; `nowSeconds` must be
 * whole seconds.
 */
export function issueRequestNonce(signingSecret: string, nowSeconds: number): string {
  const now = Math.floor(nowSeconds)
  const payload = `request-nonce-v1:${now + REQUEST_NONCE_TTL_SECONDS}`
  const tag = hmacSha256(new TextEncoder().encode(signingSecret), new TextEncoder().encode(payload))
  return `${now + REQUEST_NONCE_TTL_SECONDS}.${toBase64Url(tag)}`
}

/** Accept only a live, well-formed, correctly-tagged nonce. Anything else is false, never an error. */
export function verifyRequestNonce(nonce: string | null | undefined, signingSecret: string, nowSeconds: number): boolean {
  if (!nonce || nonce.length > MAX_NONCE_LENGTH) return false
  const [expRaw, tag, extra] = nonce.split('.')
  if (!expRaw || !tag || extra || !/^\d{1,20}$/.test(expRaw)) return false
  // HMAC-SHA256 tags are always 32 bytes: 43 base64url characters, no padding.
  if (!/^[A-Za-z0-9_-]{43}$/.test(tag)) return false
  const exp = Number(expRaw)
  const now = Math.floor(nowSeconds)
  if (!Number.isSafeInteger(exp) || exp <= now || exp - now > REQUEST_NONCE_TTL_SECONDS + 60) return false
  const expected = hmacSha256(
    new TextEncoder().encode(signingSecret),
    new TextEncoder().encode(`request-nonce-v1:${expRaw}`),
  )
  let actual: Uint8Array
  try {
    actual = fromBase64Url(tag)
  } catch {
    return false
  }
  if (actual.length !== expected.length) return false
  let diff = 0
  for (let index = 0; index < actual.length; index += 1) diff |= actual[index]! ^ expected[index]!
  return diff === 0
}
