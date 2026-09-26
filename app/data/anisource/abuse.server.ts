import { Redis } from '@upstash/redis'
import { sha256Hex } from '../../lib/proofOfWork'

/**
 * Abuse tripwires for self-run scraper stacks (ADR 0007). Threat model
 * correction baked in: every operator runs their own copy from their own
 * residential IP, so IP diversity, IP reputation, and ASN classification are
 * dead signals — unique IPs are the assumed case, not the anomaly. What
 * survives is per-identity behavior: sessions are earned and cheap to mint,
 * so abuse is detected by what an identity DOES (velocity, sharing,
 * pre-auth probing), never by where it comes from.
 *
 * Identity scoping is the whole safety design:
 * - Session judgments (velocity, sharing) touch only that session.
 * - IP judgments apply ONLY pre-auth (sessionless floods, challenge
 *   farming). A NAT neighbor with a valid session is never affected by
 *   another network's behavior; worst case for shared IPs is a short delay
 *   minting new sessions, never a wall on working ones.
 * All denials are short TTLs and surface as 429 with Retry-After through the
 * existing rate-limit UI path — no new error taxonomy.
 */

export const ABUSE_SAMPLE_RATE = 0.1
export const ABUSE_WINDOW_SECONDS = 600
/** Sampled hits per 10 min before a session trips (~10x actual volume). */
export const ABUSE_SID_VELOCITY_LIMIT = 150
/** Distinct IPs per session before sharing is assumed (NAT-safe margin). */
export const ABUSE_SID_SHARE_LIMIT = 10
/** Sessionless hits per IP per 10 min before probing is assumed. Unsampled:
 *  legitimate clients 401 exactly once per session, then verify. */
export const ABUSE_IP_ANON_LIMIT = 200
export const ABUSE_SID_BAN_TTL_SECONDS = 1800
export const ABUSE_SHARE_BAN_TTL_SECONDS = 3600
export const ABUSE_IP_BAN_TTL_SECONDS = 900

export interface AbuseStore {
  get(key: string): Promise<unknown>
  set(key: string, value: string, exSeconds: number): Promise<void>
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<void>
  pfadd(key: string, member: string): Promise<number>
  pfcount(key: string): Promise<number>
}

function redisAbuseStore(redis: Redis): AbuseStore {
  return {
    get: async (key) => redis.get(key),
    set: async (key, value, exSeconds) => {
      await redis.set(key, value, { ex: exSeconds })
    },
    incr: async (key) => redis.incr(key),
    expire: async (key, seconds) => {
      await redis.expire(key, seconds)
    },
    pfadd: async (key, member) => redis.pfadd(key, member),
    pfcount: async (key) => redis.pfcount(key),
  }
}

let abuseStoreCacheKey: string | null = null
let abuseStoreCache: AbuseStore | null = null

/**
 * Cached abuse store. The cache holds only configuration (the REST client
 * carries no sockets and no request state), mirroring the limiter cache.
 */
export function cachedAbuseStore(): AbuseStore | null {
  const env = typeof process === 'undefined' ? undefined : process.env
  const url = env?.UPSTASH_REDIS_REST_URL
  const token = env?.UPSTASH_REDIS_REST_TOKEN
  const cacheKey = `${url ?? ''}\n${token ?? ''}`
  if (abuseStoreCacheKey === cacheKey) return abuseStoreCache
  abuseStoreCacheKey = cacheKey
  abuseStoreCache = abuseStore()
  return abuseStoreCache
}

/**
 * Null outside production without Redis configuration: abuse telemetry is
 * an operator-funded control plane, and development has no abuse problem.
 * Production callers must fail closed on null (fail open would silently drop
 * every tripwire exactly where abuse pays).
 */
export function abuseStore(): AbuseStore | null {
  const env = typeof process === 'undefined' ? undefined : process.env
  const url = env?.UPSTASH_REDIS_REST_URL
  const token = env?.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) return null
  } catch {
    return null
  }
  return redisAbuseStore(new Redis({ url, token, retry: false }))
}

/** Opaque session fingerprint: stable per session, reversible by nobody. */
export function sessionFingerprint(sessionId: string): string {
  return sha256Hex(`abuse-session-v1:${sessionId}`)
}

/** Opaque network fingerprint for pre-auth accounting only. */
export function networkFingerprint(ip: string | null): string {
  return sha256Hex(`abuse-network-v1:${ip ?? 'unknown'}`)
}

function minuteBucket(nowSeconds: number): number {
  return Math.floor(nowSeconds / ABUSE_WINDOW_SECONDS)
}

export type AbuseVerdict =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number; reason: 'velocity' | 'shared' | 'probing' }

export interface AbuseSignal {
  ipHash: string
  sessionFingerprint: string | null
  sessionless: boolean
  forceSample?: boolean
}

/**
 * Judge one request. Denied identities fail fast on reads; telemetry writes
 * ride a sampling rate except the sessionless counter, which is rare for
 * legitimate traffic by construction (one 401 per session, then verify).
 */
export async function checkAbuse(
  store: AbuseStore | null,
  signal: AbuseSignal,
  nowSeconds: number,
): Promise<AbuseVerdict> {
  if (!store) return { ok: true }
  const deniedReason = async (key: string): Promise<'velocity' | 'shared' | 'probing' | null> => {
    const value = await store.get(key)
    return value === 'velocity' || value === 'shared' || value === 'probing' ? value : null
  }
  const banTtl = (reason: 'velocity' | 'shared' | 'probing'): number =>
    reason === 'shared' ? ABUSE_SHARE_BAN_TTL_SECONDS : reason === 'probing' ? ABUSE_IP_BAN_TTL_SECONDS : ABUSE_SID_BAN_TTL_SECONDS

  if (signal.sessionFingerprint) {
    const denied = await deniedReason(`abuse:denied:sid:${signal.sessionFingerprint}`)
    if (denied) return { ok: false, retryAfterSeconds: banTtl(denied), reason: denied }
  } else {
    const denied = await deniedReason(`abuse:denied:ip:${signal.ipHash}`)
    if (denied) return { ok: false, retryAfterSeconds: ABUSE_IP_BAN_TTL_SECONDS, reason: 'probing' }
  }

  if (signal.sessionless) {
    const bucket = minuteBucket(nowSeconds)
    const anonCount = await store.incr(`abuse:anon:${signal.ipHash}:${bucket}`)
    if (anonCount === 1) await store.expire(`abuse:anon:${signal.ipHash}:${bucket}`, ABUSE_WINDOW_SECONDS)
    if (anonCount > ABUSE_IP_ANON_LIMIT) {
      await store.set(`abuse:denied:ip:${signal.ipHash}`, 'probing', ABUSE_IP_BAN_TTL_SECONDS)
      return { ok: false, retryAfterSeconds: ABUSE_IP_BAN_TTL_SECONDS, reason: 'probing' }
    }
    return { ok: true }
  }

  if (signal.sessionFingerprint && (signal.forceSample === true || Math.random() < ABUSE_SAMPLE_RATE)) {
    const bucket = minuteBucket(nowSeconds)
    const velocity = await store.incr(`abuse:vel:${signal.sessionFingerprint}:${bucket}`)
    if (velocity === 1) await store.expire(`abuse:vel:${signal.sessionFingerprint}:${bucket}`, ABUSE_WINDOW_SECONDS)
    await store.pfadd(`abuse:ips:${signal.sessionFingerprint}`, signal.ipHash)
    await store.expire(`abuse:ips:${signal.sessionFingerprint}`, ABUSE_SHARE_BAN_TTL_SECONDS)
    const shared = await store.pfcount(`abuse:ips:${signal.sessionFingerprint}`)
    if (velocity > ABUSE_SID_VELOCITY_LIMIT) {
      await store.set(`abuse:denied:sid:${signal.sessionFingerprint}`, 'velocity', ABUSE_SID_BAN_TTL_SECONDS)
      return { ok: false, retryAfterSeconds: ABUSE_SID_BAN_TTL_SECONDS, reason: 'velocity' }
    }
    if (shared > ABUSE_SID_SHARE_LIMIT) {
      await store.set(`abuse:denied:sid:${signal.sessionFingerprint}`, 'shared', ABUSE_SHARE_BAN_TTL_SECONDS)
      return { ok: false, retryAfterSeconds: ABUSE_SHARE_BAN_TTL_SECONDS, reason: 'shared' }
    }
  }
  return { ok: true }
}

/** Pre-auth IP denial for challenge issuance and sessionless floods. */
export async function isNetworkDenied(store: AbuseStore | null, ipHash: string): Promise<boolean> {
  if (!store) return false
  const denied = await store.get(`abuse:denied:ip:${ipHash}`)
  return denied === 'probing'
}
