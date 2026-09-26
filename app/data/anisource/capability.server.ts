import { z } from 'zod'
import { serverSecret } from '../../lib/serverSecret'

/**
 * Website-minted playback capabilities (ADR 0006). In direct-media mode the
 * browser receives absolute API media URLs, so each one carries a `cap` query
 * parameter binding it to the current session and the exact API registry
 * token in its path. The API verifies signature, expiry, and scope; segments
 * stay TTL-gated by the API registry. Server-only: secrets never leave
 * configuration, and nothing here runs in the browser bundle.
 */

export const PLAYBACK_CAP_VERSION = 1
export const PLAYBACK_CAP_PURPOSE = 'playback-cap-v1'
export const PLAYBACK_CAP_PARAM = 'cap'
export const PLAYBACK_CAP_LEEWAY_SECONDS = 60

const DEFAULT_CAP_TTL_SECONDS = 600
const MIN_SECRET_BYTES = 32

const textEncoder = new TextEncoder()

// Schema fields stay in canonical (sorted) order: Zod emits parsed objects
// in schema order, and both implementations must serialize byte-identical
// JSON for the same claims (see ADR 0006 interop vector).
const capClaimsSchema = z.object({
  exp: z.number().int(),
  iat: z.number().int(),
  kid: z.string().regex(/^[0-9a-f]{8}$/),
  scope: z.string().regex(/^[0-9a-f]{64}$/),
  sid: z.string().regex(/^[0-9a-f]{32}$/),
  v: z.literal(PLAYBACK_CAP_VERSION),
})

export type PlaybackCapClaims = z.infer<typeof capClaimsSchema>

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function playbackCapKeyId(secret: string): Promise<string> {
  return sha256Hex(secret).then((hex) => hex.slice(0, 8))
}

export function capTtlSeconds(): number {
  const parsed = Number.parseInt(process.env.ANISOURCE_PLAYBACK_TTL ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CAP_TTL_SECONDS
}

export function playbackSecrets(): { primary: string; previous: string[] } | null {
  const env = typeof process === 'undefined' ? undefined : process.env
  // One variable, comma-separated: the first entry signs, the rest verify
  // during rotation. Short entries are ignored so a trailing comma cannot
  // silently weaken the set; with no usable entry there is no secret.
  const configured = (env?.ANISOURCE_PLAYBACK_SECRETS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => textEncoder.encode(entry).byteLength >= MIN_SECRET_BYTES)
  if (configured.length > 0) {
    const [primary, ...previous] = configured as [string, ...string[]]
    return { primary, previous }
  }
  // Local development derives from the existing server secret (which itself
  // falls back to process-local randomness outside production), so direct
  // mode works without env. Production fails closed: no resolvable secret.
  if (!env || env.NODE_ENV === 'production') return null
  const fallback = serverSecret()
  return fallback ? { primary: fallback, previous: [] } : null
}

export class PlaybackCapUnavailable extends Error {
  constructor() {
    super('Playback capability secret is not configured.')
    this.name = 'PlaybackCapUnavailable'
  }
}

/**
 * Mint a capability binding one API registry token to one website session.
 * `nowSeconds` exists so tests pin time; callers pass nothing in production.
 */
export async function mintPlaybackCapability(
  scopeToken: string,
  sessionSid: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const secrets = playbackSecrets()
  if (!secrets) throw new PlaybackCapUnavailable()
  const [scope, sid, kid] = await Promise.all([
    sha256Hex(scopeToken),
    sha256Hex(sessionSid).then((hex) => hex.slice(0, 32)),
    playbackCapKeyId(secrets.primary),
  ])
  const iat = Math.floor(nowSeconds)
  // Keys are inserted in sorted order so both implementations serialize
  // byte-identical JSON for the same claims (see ADR 0006 interop vector).
  const claims: PlaybackCapClaims = { exp: iat + capTtlSeconds(), iat, kid, scope, sid, v: PLAYBACK_CAP_VERSION }
  const parsed = capClaimsSchema.parse(claims)
  const encoded = encodeBase64Url(textEncoder.encode(JSON.stringify(parsed)))
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(secrets.primary), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(`${PLAYBACK_CAP_PURPOSE}:${encoded}`))
  return `v${PLAYBACK_CAP_VERSION}.${encoded}.${encodeBase64Url(new Uint8Array(signature))}`
}

/** Append a capability to a media URL, preserving any query and fragment. */
export function appendPlaybackCapability(url: string, cap: string): string {
  const hashIndex = url.indexOf('#')
  const fragment = hashIndex >= 0 ? url.slice(hashIndex) : ''
  const bare = hashIndex >= 0 ? url.slice(0, hashIndex) : url
  const separator = bare.includes('?') ? '&' : '?'
  return `${bare}${separator}${PLAYBACK_CAP_PARAM}=${encodeURIComponent(cap)}${fragment}`
}
