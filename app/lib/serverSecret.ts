/**
 * Server runtime secret shared by the SSR document code and the AniSource
 * gateway (session signing, ticket signing, request nonces).
 *
 * Safe to import from isomorphic modules: it only reads guarded
 * `process.env` and holds process-local randomness — no secret values, no
 * hosts. Outside a server runtime it returns null (fail closed) instead of
 * minting anything a gateway could not verify.
 */

const localSessionSecret = (() => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
})()

export function serverSecret(): string | null {
  const env = typeof process === 'undefined' ? undefined : process.env
  const configured = env?.ANISOURCE_SESSION_SECRET
  if (configured && new TextEncoder().encode(configured).byteLength >= 32) return configured
  if (!env || env.NODE_ENV === 'production') return null
  return localSessionSecret
}
