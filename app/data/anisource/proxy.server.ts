import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { z } from 'zod'
import apiUrls from '../../../config/api-urls.json'
import { serverSecret } from '../../lib/serverSecret'
import { scoreAttestation, scoreRequestFingerprint, SUSPICIOUS_ATTESTATION_SCORE } from '../../lib/proofOfWork'
import { cachedAbuseStore, checkAbuse, isNetworkDenied, networkFingerprint, sessionFingerprint } from './abuse.server'
import { PlaybackCapUnavailable, appendPlaybackCapability, mintPlaybackCapability } from './capability.server'
import {
  POW_CHALLENGE_BUDGET_PER_MINUTE,
  POW_EXCHANGE_BUDGET_PER_MINUTE,
  POW_SHORT_SESSION_TTL_SECONDS,
  POW_SUSPICIOUS_BURN_AMOUNT,
  attestationVersionCurrent,
  challengeStore,
  clientWeekInWindow,
  escalatedDifficulty,
  mintPowChallenge,
  parseExchangeBody,
  powDifficulty,
  redeemPowChallenge,
} from './pow.server'
import {
  anisourceMangaSchema,
  chapterPageSchema,
  episodeSchema,
  healthResponseSchema,
  mangaChapterSchema,
  mangaSearchResponseSchema,
  searchResponseSchema,
  serverSchema,
  sourceListResponseSchema,
  streamSchema,
} from './schema'

const API_PREFIX = '/api/anisource'
const FALLBACK_PREFIX = '/fallback'
// Short sessions bound the value of one solved puzzle: a harvested session
// stops working within two hours, so bulk abuse must keep solving.
const SESSION_LIFETIME_SECONDS = 2 * 60 * 60
// Ticket lifetime nests inside the playback capability TTL (600 s) with
// margin to spare: gateway expiry always fires first and its refresh pulls
// fresh API URLs and a fresh capability too. API HLS key resources may
// expire sooner (10 min); those surface as upstream 401/403/410 on the media
// fetch and ride the same expired-link refresh path.
const ASSET_TICKET_LIFETIME_SECONDS = 9 * 60
const MAX_PROXY_BODY_BYTES = 8 * 1024 * 1024
const textEncoder = new TextEncoder()

const sessionSchema = z.object({
  sid: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  exp: z.number().int(),
  // Automation score at mint. Strict: sessions minted before scores existed
  // do not verify, so a deploy cleanly retires them within one lifetime.
  scr: z.number().int().min(0),
  // Issuing-network fingerprint (opaque hash, see abuse.server). Required:
  // pre-binding sessions fail verification and re-verify transparently, so
  // no grandfathering logic ships. Metadata stays lenient across hops (the
  // check runs on media paths only); media re-verifies on drift.
  net: z.string().regex(/^[0-9a-f]{64}$/),
})
const identifierSchema = z.string().min(1).max(512).refine((value) => {
  try {
    const decoded = decodeURIComponent(value)
    return decoded.length <= 512
      && !decoded.includes('\\')
      && ![...decoded].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
      && !decoded.split('/').some((part) => part === '.' || part === '..')
  } catch {
    return false
  }
})
const emptyQuerySchema = z.object({}).strict()
const searchQuerySchema = z.object({ q: z.string().max(512), page: z.coerce.number().int().positive() }).strict()
const streamQuerySchema = z.object({ server_id: z.string().min(1).max(512) }).strict()

/**
 * Server identifier guard: `server_id` is caller-controlled and replayed to
 * the upstream API verbatim, so the gateway refuses values shaped like an
 * internal-network pivot before they leave this deployment. Legitimate IDs
 * are opaque tokens or base64 JSON carrying a public embed host (for
 * example KickAssAnime's `{name, src: https://embed.host/...}`); anything
 * embedding control bytes, non-HTTP fetch schemes, or loopback / private /
 * link-local / metadata hosts is rejected as an unknown route (404), never
 * with a message naming the rule. Public-host fetching stays upstream
 * territory: the API must allowlist embed hosts there, since Sources
 * legitimately resolve third-party hosts by design.
 */
function tryBase64UrlDecodeToText(value: string): string | null {
  if (!/^[A-Za-z0-9-_]+={0,2}$/.test(value) || value.length % 4 === 1 || value.length > 1024) return null
  try {
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4))
    if (!binary) return null
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (!/^[\x20-\x7E\s]*$/.test(text)) return null
    return text
  } catch {
    return null
  }
}

function candidateHosts(value: string): string[] {
  const hosts: string[] = []
  for (const match of value.matchAll(/https?:\/\/([^/?#\s]+)/gi)) {
    if (match[1]) hosts.push(match[1])
  }
  return hosts
}

function isNonPublicHost(host: string): boolean {
  let bare = host.toLowerCase().trim()
  if (!bare) return true
  if (bare.startsWith('[') && bare.includes(']')) bare = bare.slice(1, bare.indexOf(']'))
  bare = bare.split(':')[0] ?? ''
  if (!bare) return true
  if (bare === 'localhost' || bare.endsWith('.localhost') || bare === '0.0.0.0' || bare === '::' || bare === '::1') return true
  if (bare === 'metadata.google.internal' || bare === 'metadata.google.com' || bare === 'instance-data') return true
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(bare)
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number)
    if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
    const [a = 0, b = 0] = parts
    if (a === 127 || a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a === 0) return true
    return false
  }
  if (bare.includes(':')) {
    const normalized = bare.toLowerCase()
    if (normalized === '::1' || normalized === '::') return true
    if (/^(fc|fd)[0-9a-f]*:/.test(normalized)) return true
    if (/^fe[89ab][0-9a-f]*:/.test(normalized)) return true
    return false
  }
  return false
}

export function isSafeServerId(value: string): boolean {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) return false
  // Control bytes and backslashes never appear in legitimate opaque IDs or
  // base64 JSON. Checked by code point (not a control-character regex) so
  // the pattern stays lint-clean.
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code < 32 || code === 127 || code === 92) return false
  }
  const lower = value.toLowerCase()
  for (const scheme of ['file:', 'gopher:', 'ftp:', 'dict:', 'ldap:', 'ldaps:', 'jar:', 'tftp:', 'sftp:', 'ssh:', 'telnet:', 'javascript:', 'data:', 'vbscript:']) {
    if (lower.includes(scheme)) return false
  }
  const texts = [value]
  const decoded = tryBase64UrlDecodeToText(value)
  if (decoded) texts.push(decoded)
  for (const text of texts) {
    for (const host of candidateHosts(text)) {
      if (isNonPublicHost(host)) return false
    }
    const textLower = text.toLowerCase()
    if (/\b127\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(textLower)) return false
    if (textLower.includes('localhost')) return false
    if (/\b169\.254\.\d{1,3}\.\d{1,3}\b/.test(textLower)) return false
    if (/\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(textLower)) return false
    if (/\b192\.168\.\d{1,3}\.\d{1,3}\b/.test(textLower)) return false
    if (/\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/.test(textLower)) return false
  }
  return true
}
const ticketSchema = z.object({
  v: z.literal(1),
  p: z.string().min(1).max(4096),
  q: z.string().max(2048),
  sid: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  exp: z.number().int(),
  scope: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  f: z.boolean().optional(),
})

type Session = z.infer<typeof sessionSchema>
type AssetTicket = z.infer<typeof ticketSchema>
type Limiter = InstanceType<typeof Ratelimit>

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4))
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function hmacKey(value: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', textEncoder.encode(value), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

async function sign(value: string, purpose: string, key: CryptoKey): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(`${purpose}:${value}`))
  return encodeBase64Url(new Uint8Array(signature))
}

async function verify(value: string, signature: string, purpose: string, key: CryptoKey): Promise<boolean> {
  try {
    return await crypto.subtle.verify(
      'HMAC',
      key,
      decodeBase64Url(signature),
      textEncoder.encode(`${purpose}:${value}`),
    )
  } catch {
    return false
  }
}

function cookieName(): string {
  return process.env.NODE_ENV === 'production' ? '__Host-anisource-session' : 'anisource-session'
}

function cookieValue(request: Request): string | undefined {
  const prefix = `${cookieName()}=`
  return request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length)
}

async function readSession(request: Request, key: CryptoKey): Promise<Session | null> {
  const cookie = cookieValue(request)
  if (!cookie || cookie.length > 512) return null
  const [payload, signature, extra] = cookie.split('.')
  if (!payload || !signature || extra || !await verify(payload, signature, 'session-v1', key)) return null
  try {
    const parsed = sessionSchema.safeParse(JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))))
    return parsed.success && parsed.data.exp > Math.floor(Date.now() / 1000) ? parsed.data : null
  } catch {
    return null
  }
}

async function createSession(key: CryptoKey, ttlSeconds: number, score: number, netHash: string): Promise<{ session: Session; cookie: string }> {
  const session: Session = {
    sid: encodeBase64Url(crypto.getRandomValues(new Uint8Array(32))),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    scr: Math.max(0, Math.trunc(score)),
    net: netHash,
  }
  const payload = encodeBase64Url(textEncoder.encode(JSON.stringify(session)))
  const signature = await sign(payload, 'session-v1', key)
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  const cookie = `${cookieName()}=${payload}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttlSeconds}${secure}`
  return { session, cookie }
}

/**
 * Media-resolution operations: the only catalog paths that hand out playable
 * bytes or page images. Gating here (not on metadata lists) keeps discovery,
 * search, and detail pages working for every client while headless playback
 * dies at the point of use, in both proxied and direct-media modes.
 */
function isMediaResolutionPath(path: string): boolean {
  return (
    /^\/api\/v1\/anime\/[^/]+\/streams\/[^/]+$/.test(path) ||
    /^\/api\/v1\/manga\/[^/]+\/pages\/[^/]+$/.test(path)
  )
}

/**
 * Forged-stack ban: the request stack itself looks automated. Score 4+
 * means a Chromium claim with no browser headers, or a known automation
 * user agent with sloppy metadata — shapes no legitimate browser produces
 * (stock Chrome/Firefox/Safari score 0–2). Single signals stay priced,
 * never banned; only this conjunction of independent misses ends playback.
 */
function mediaStackForged(request: Request): boolean {
  return scoreRequestFingerprint(request.headers).score >= 4
}

function isSameOriginRequest(request: Request): boolean {
  const requestOrigin = new URL(request.url).origin
  const origin = request.headers.get('origin')
  if (origin && origin !== requestOrigin) return false
  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin') return false
  if (origin || fetchSite === 'same-origin') return true
  const referer = request.headers.get('referer')
  if (!referer) return false
  try {
    return new URL(referer).origin === requestOrigin
  } catch {
    return false
  }
}

export function requestClientIp(request: Request): string | null {
  const forwarded = process.env.NODE_ENV === 'production'
    ? request.headers.get('x-vercel-forwarded-for')
    : request.headers.get('x-vercel-forwarded-for') ?? request.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',', 1)[0]?.trim()
  return ip && ip.length <= 128 ? ip : process.env.NODE_ENV === 'production' ? null : 'local'
}

function getLimiters(): { session: Limiter; ip: Limiter } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  const cacheKey = `${url}\n${token}`
  const cached = limiterCacheKey === cacheKey ? limiterCache : undefined
  if (cached) return cached
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) return null
  } catch {
    return null
  }
  // Fail fast: the limiter sits on the request hot path, so client-side
  // retries would only stack latency before the fail-closed 503 below.
  // The REST client holds only URL/token (no sockets), so sharing one per
  // deploy avoids per-request allocation without storing request state.
  const redis = new Redis({ url, token, retry: false })
  const limiters = {
    session: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(240, '10 s'), prefix: 'anisource:session:v1' }),
    ip: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(1200, '10 s'), prefix: 'anisource:ip:v1' }),
  }
  limiterCacheKey = cacheKey
  limiterCache = limiters
  return limiters
}

let limiterCacheKey: string | null = null
let limiterCache: { session: Limiter; ip: Limiter } | null = null

const signingKeyCache = new Map<string, Promise<CryptoKey>>()
function cachedHmacKey(value: string): Promise<CryptoKey> {
  // The key derives from the deploy secret only, so caching it shares no
  // per-request state between users.
  const cached = signingKeyCache.get(value)
  if (cached) return cached
  const pending = hmacKey(value)
  signingKeyCache.set(value, pending)
  pending.catch(() => {
    if (signingKeyCache.get(value) === pending) signingKeyCache.delete(value)
  })
  return pending
}

async function checkRateLimits(request: Request, session: Session | null, key: CryptoKey): Promise<Response | null> {
  const limiters = getLimiters()
  if (!limiters) {
    return process.env.NODE_ENV === 'production'
      ? jsonError(503, 'Rate limiting is not configured.', {}, 'misconfigured')
      : null
  }
  const ip = requestClientIp(request)
  if (!ip) return jsonError(503, 'Client rate limiting is unavailable.', {}, 'misconfigured')
  try {
    // Sessionless health checks pay only the IP budget: there is no session
    // to charge, and minting one just to limit it would reopen session
    // issuance without proof-of-work.
    const checks = session
      ? await Promise.all([
        limiters.session.limit(await sign(session.sid, 'limit-session-v1', key)),
        limiters.ip.limit(await sign(ip, 'limit-ip-v1', key)),
      ])
      : [await limiters.ip.limit(await sign(ip, 'limit-ip-v1', key))]
    if (checks.every((result) => result.success)) return null
    const reset = Math.min(...checks.filter((result) => !result.success).map((result) => result.reset))
    return jsonError(429, 'Too many AniSource requests. Try again shortly.', {
      'Retry-After': String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))),
    }, 'rate-limited')
  } catch {
    return jsonError(503, 'AniSource request protection is temporarily unavailable.')
  }
}

function jsonError(status: number, detail: string, headers: HeadersInit = {}, kind?: string): Response {
  return new Response(JSON.stringify({ detail }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...Object.fromEntries(new Headers(headers)),
      ...(kind ? { 'X-AniSource-Error-Kind': kind } : {}),
    },
  })
}

/**
 * Single source for the camouflage response: unknown routes and failed
 * same-origin checks all answer identically so probers cannot tell the cases
 * apart. Sessionless catalog calls deliberately do NOT use this (401
 * session-required): the client must learn it has to verify before retrying.
 */
function hiddenRoute(): Response {
  return jsonError(404, 'AniSource route not found.', {}, 'invalid')
}

function apiBase(): URL | null {
  return upstreamBase(process.env.ANISOURCE_BASE, apiUrls.anisource)
}

/**
 * Direct media mode: the gateway passes absolute API media URLs (segments,
 * keys, subtitles, manga pages) through to the browser instead of wrapping
 * them in session-bound asset tickets. Catalog JSON still resolves through
 * the gateway, so the service credential never leaves the server. Enable
 * only once the API deployment enforces short segment TTLs and the site's
 * origin allowlist; otherwise the exposed bearer URLs stay replayable for
 * the full playlist window with no hotlink check.
 */
function directMediaEnabled(): boolean {
  const value = process.env.ANISOURCE_DIRECT_MEDIA
  return value === '1' || value?.toLowerCase() === 'true' || value?.toLowerCase() === 'yes'
}

function fallbackBase(): URL | null {
  // An explicit empty value disables the fallback; otherwise the shared
  // default keeps local/dev working without per-machine env, like primary.
  const env = process.env.ANISOURCE_FALLBACK_BASE
  const configured = env === undefined ? apiUrls.anisourceFallback : env || null
  return configured ? upstreamBase(configured, configured) : null
}

function upstreamBase(value: string | undefined, fallback: string): URL | null {
  try {
    const base = new URL(value || fallback)
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.hash) return null
    if (process.env.NODE_ENV === 'production' && base.protocol !== 'https:') return null
    base.pathname = `${base.pathname.replace(/\/+$/, '')}/`
    return base
  } catch {
    return null
  }
}

function responseSchema(path: string, search: string): z.ZodType | null {
  const entries = [...new URLSearchParams(search)]
  if (new Set(entries.map(([name]) => name)).size !== entries.length) return null
  const query = Object.fromEntries(entries)

  if (path === '/health' || path === '/api/v1/health') {
    return emptyQuerySchema.safeParse(query).success ? healthResponseSchema : null
  }
  if (/^\/api\/v1\/(?:anime|manga)\/sources$/.test(path)) {
    return emptyQuerySchema.safeParse(query).success ? sourceListResponseSchema : null
  }

  const match = /^\/api\/v1\/(anime|manga)\/([^/]+)\/(search|manga|chapters|pages|episodes|servers|streams)(?:\/([^/]+))?$/.exec(path)
  if (!match) return null
  const [, catalog, sourceId, operation, itemId] = match
  if (!identifierSchema.safeParse(sourceId).success || (itemId && !identifierSchema.safeParse(itemId).success)) return null

  if (operation === 'search' && !itemId) {
    if (!searchQuerySchema.safeParse(query).success) return null
    return catalog === 'anime' ? searchResponseSchema : mangaSearchResponseSchema
  }
  if (!itemId) return null
  if (catalog === 'anime' && operation === 'streams') {
    if (!streamQuerySchema.safeParse(query).success) return null
    // server_id replays upstream verbatim: refuse internal-pivot shapes here.
    if (typeof query.server_id !== 'string' || !isSafeServerId(query.server_id)) return null
    return streamSchema.array()
  }
  if (!emptyQuerySchema.safeParse(query).success) return null
  if (catalog === 'manga') {
    if (operation === 'manga') return anisourceMangaSchema
    if (operation === 'chapters') return mangaChapterSchema.array()
    if (operation === 'pages') return chapterPageSchema.array()
  }
  if (catalog === 'anime') {
    if (operation === 'episodes') return episodeSchema.array()
    if (operation === 'servers') return serverSchema.array()
  }
  return null
}

function isAllowedUpstreamPath(path: string, search = ''): boolean {
  return !isMediaPath(path) && responseSchema(path, search) !== null
}

function isMediaPath(path: string): boolean {
  return /^\/api\/v1\/proxy\/hls\/[^/]+$/.test(path)
    || /^\/api\/v1\/manga\/page\/[^/]+$/.test(path)
}

async function issueTicket(path: string, query: string, scope: string, session: Session, key: CryptoKey, viaFallback = false): Promise<string> {
  const ticket: AssetTicket = {
    v: 1,
    p: path,
    q: query,
    sid: session.sid,
    exp: Math.min(session.exp, Math.floor(Date.now() / 1000) + ASSET_TICKET_LIFETIME_SECONDS),
    scope,
    ...(viaFallback ? { f: true as const } : {}),
  }
  const encoded = encodeBase64Url(textEncoder.encode(JSON.stringify(ticket)))
  return `${encoded}.${await sign(encoded, 'asset-v1', key)}`
}

async function verifyTicket(value: string, session: Session, key: CryptoKey): Promise<AssetTicket | null> {
  if (value.length > 12_000) return null
  const [payload, signature, extra] = value.split('.')
  if (!payload || !signature || extra || !await verify(payload, signature, 'asset-v1', key)) return null
  try {
    const parsed = ticketSchema.safeParse(JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))))
    if (!parsed.success || parsed.data.sid !== session.sid || parsed.data.exp <= Math.floor(Date.now() / 1000)) return null
    return isMediaPath(parsed.data.p) ? parsed.data : null
  } catch {
    return null
  }
}

async function rewriteApiUrl(value: string, base: URL, session: Session | null, key: CryptoKey, scope: string, viaFallback = false): Promise<string> {
  const absoluteUrl = /^(?:https?:)?\/\//i.test(value)
  if (!absoluteUrl && !/^\/?api\/v1(?:\/|$)/i.test(value)) return value
  let url: URL
  try {
    url = new URL(value, base)
  } catch {
    if (value.includes(base.host)) throw new Error('AniSource returned an invalid same-origin URL.')
    return value
  }
  if (url.origin !== base.origin) return value
  const basePath = base.pathname.replace(/\/$/, '')
  const path = basePath && url.pathname.startsWith(`${basePath}/`) ? url.pathname.slice(basePath.length) : url.pathname
  if (isMediaPath(path)) {
    // Media URLs are always session-bound (tickets or capabilities): a
    // sessionless response (health) never contains one, so reaching here
    // without a session is an upstream shape violation, not a user state.
    if (!session) throw new Error('AniSource session is required to sign media URLs.')
    if (directMediaEnabled()) {
      // Direct mode hands the browser absolute API URLs, so each one carries
      // a session-bound capability (ADR 0006). Without a resolvable secret
      // there is nothing safe to hand out: fail closed, not bearer-open.
      const token = url.pathname.split('/').filter(Boolean).at(-1)
      if (!token) throw new PlaybackCapUnavailable()
      const cap = await mintPlaybackCapability(token, session.sid)
      return appendPlaybackCapability(url.toString(), cap)
    }
    // Ticket mode preserves the upstream signed query and, when playback
    // secrets resolve, additionally binds a session capability to it: ticket
    // asset fetches replay the stored query upstream, so deployments that
    // enforce capabilities on media keep working through the gateway, while
    // deployments that rely on Bearer or pre-signed queries ignore the extra
    // parameter. Best-effort by design — missing secrets must not break
    // ticket mode, which authenticates via Bearer plus the preserved query.
    let ticketQuery = url.search
    try {
      const token = url.pathname.split('/').filter(Boolean).at(-1)
      if (token) {
        const cap = await mintPlaybackCapability(token, session.sid)
        ticketQuery = `${ticketQuery}${ticketQuery ? '&' : '?'}${'cap'}=${encodeURIComponent(cap)}`
      }
    } catch (error) {
      if (!(error instanceof PlaybackCapUnavailable)) throw error
    }
    const ticket = await issueTicket(path, ticketQuery, scope, session, key, viaFallback)
    return `${API_PREFIX}/asset/${ticket}`
  }
  if (isAllowedUpstreamPath(path, url.search)) return `${API_PREFIX}${path}${url.search}${url.hash}`
  if (/^\/api\/v1(?:\/|$)/i.test(path)) throw new Error('AniSource returned an unsupported same-origin URL.')
  return `${path}${url.search}${url.hash}`
}

async function rewriteJson(value: unknown, base: URL, session: Session | null, key: CryptoKey, scope: string, viaFallback = false): Promise<unknown> {
  if (typeof value === 'string') return rewriteApiUrl(value, base, session, key, scope, viaFallback)
  if (Array.isArray(value)) return Promise.all(value.map((item) => rewriteJson(item, base, session, key, scope, viaFallback)))
  if (value && typeof value === 'object') {
    return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([name, item]) => [
      name,
      await rewriteJson(item, base, session, key, scope, viaFallback),
    ])))
  }
  return value
}

async function rewriteManifest(content: string, base: URL, session: Session | null, key: CryptoKey, scope: string, viaFallback = false): Promise<string> {
  const rewrite = (value: string) => rewriteApiUrl(value, base, session, key, scope, viaFallback)
  const attributes = await Promise.all([...content.matchAll(/URI=(['"])([^'"]+)\1/g)].map(async (match) => ({
    value: match[0],
    result: `URI=${match[1]}${await rewrite(match[2]!)}${match[1]}`,
  })))
  for (const item of attributes) content = content.replace(item.value, item.result)
  const lines = await Promise.all(content.split(/\r?\n/).map(async (line) => {
    const match = /^(\s*)(?!#)(\S+)(\s*)$/.exec(line)
    return match ? `${match[1]}${await rewrite(match[2]!)}${match[3]}` : line
  }))
  return lines.join('\n')
}

async function readBounded(response: Response): Promise<Uint8Array | null> {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_PROXY_BODY_BYTES) return null
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_PROXY_BODY_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function browserHeaders(upstream: Response, transformed: boolean): Headers {
  const headers = new Headers()
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'retry-after']) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  if (transformed) headers.delete('content-length')
  const cache = upstream.headers.get('cache-control') ?? 'no-store'
  headers.set('Cache-Control', cache.replace(/\bpublic\b/gi, 'private').replace(/\bs-maxage=[^,]+,?\s*/gi, '').trim() || 'private, no-store')
  return headers
}

function containsUpstreamHost(value: string, base: URL): boolean {
  return value.toLowerCase().includes(base.host.toLowerCase())
}

function appendSessionCookie(response: Response, cookie: string | undefined): Response {
  if (!cookie) return response
  const headers = new Headers(response.headers)
  headers.append('Set-Cookie', cookie)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function powNoStore(): HeadersInit {
  return { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
}

/** Issue a single-use proof-of-work challenge bound to the request network. */
async function servePowChallenge(request: Request): Promise<Response> {
  const secret = serverSecret()
  if (!secret) return jsonError(503, 'AniSource server access is not configured.', {}, 'misconfigured')
  const store = challengeStore()
  if (!store && process.env.NODE_ENV === 'production') {
    return jsonError(503, 'AniSource verification is not configured.', {}, 'misconfigured')
  }
  const ip = requestClientIp(request)
  if (await isNetworkDenied(cachedAbuseStore(), networkFingerprint(ip))) {
    return jsonError(429, 'Too many verification requests. Try again shortly.', { 'Retry-After': '900' }, 'rate-limited')
  }
  const budget = store ? await store.hitBudget(`challenge:${ip ?? 'unknown'}`, POW_CHALLENGE_BUDGET_PER_MINUTE, 60) : { allowed: true, count: 0 }
  if (store && !budget.allowed) {
    return jsonError(429, 'Too many verification requests. Try again shortly.', { 'Retry-After': '60' }, 'rate-limited')
  }
  const issued = mintPowChallenge(ip, Math.floor(Date.now() / 1000), escalatedDifficulty(powDifficulty(), budget.count))
  if (!issued) return jsonError(503, 'AniSource server access is not configured.', {}, 'misconfigured')
  return new Response(JSON.stringify(issued), { status: 200, headers: powNoStore() })
}

/** Verify a solved challenge and issue the browser session. */
async function exchangePowSession(request: Request): Promise<Response> {
  const secret = serverSecret()
  if (!secret) return jsonError(503, 'AniSource server access is not configured.', {}, 'misconfigured')
  if (Number(request.headers.get('content-length') ?? 0) > 2048) {
    return jsonError(400, 'Invalid verification payload.', {}, 'invalid')
  }
  let body: ReturnType<typeof parseExchangeBody>
  try {
    body = parseExchangeBody(await request.json())
  } catch {
    return jsonError(400, 'Invalid verification payload.', {}, 'invalid')
  }
  if (!body) return jsonError(400, 'Invalid verification payload.', {}, 'invalid')
  // Stale-but-well-formed copies reload for a fresh bundle; malformed ones
  // (including missing week/version, rejected by the schema above) stay 400.
  if (!attestationVersionCurrent(body.attestation.av)) {
    return jsonError(426, 'Client is outdated. Reload to update.', {}, 'invalid')
  }
  if (!clientWeekInWindow(body.attestation.cw, Date.now())) {
    return jsonError(426, 'Client is outdated. Reload to update.', {}, 'invalid')
  }
  const store = challengeStore()
  if (!store && process.env.NODE_ENV === 'production') {
    return jsonError(503, 'AniSource verification is not configured.', {}, 'misconfigured')
  }
  const ip = requestClientIp(request)
  if (await isNetworkDenied(cachedAbuseStore(), networkFingerprint(ip))) {
    return jsonError(429, 'Too many verification requests. Try again shortly.', { 'Retry-After': '900' }, 'rate-limited')
  }
  const budget = store ? await store.hitBudget(`exchange:${ip ?? 'unknown'}`, POW_EXCHANGE_BUDGET_PER_MINUTE, 60) : { allowed: true, count: 0 }
  if (store && !budget.allowed) {
    return jsonError(429, 'Too many verification requests. Try again shortly.', { 'Retry-After': '60' }, 'rate-limited')
  }
  const result = await redeemPowChallenge(body.challenge, body.solution.nonce, body.attestation, ip, store, Math.floor(Date.now() / 1000))
  if (!result.ok) {
    if (result.reason === 'misconfigured') {
      return jsonError(503, 'AniSource server access is not configured.', {}, 'misconfigured')
    }
    if (result.reason === 'expired' || result.reason === 'spent') {
      return jsonError(400, 'Verification expired. Request a fresh challenge and retry.', {}, 'invalid')
    }
    return jsonError(400, 'Invalid verification payload.', {}, 'invalid')
  }
  const signingKey = await cachedHmacKey(secret)
  // Automation tells price, never block: suspicious sessions get a short
  // leash (transparent re-verification) and pre-burn the network's challenge
  // budget so follow-up puzzles escalate. Forged-clean passes by design.
  const attestation = scoreAttestation(body.attestation)
  const short = attestation.score >= SUSPICIOUS_ATTESTATION_SCORE
  if (short && store) {
    await store.burnBudget(`challenge:${ip ?? 'unknown'}`, POW_SUSPICIOUS_BURN_AMOUNT, 60)
  }
  const created = await createSession(
    signingKey,
    short ? POW_SHORT_SESSION_TTL_SECONDS : SESSION_LIFETIME_SECONDS,
    attestation.score,
    networkFingerprint(ip),
  )
  const headers = new Headers(powNoStore())
  headers.append('Set-Cookie', created.cookie)
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers })
}

/** The single server-side AniSource seam for catalog JSON and signed media assets. */
export async function handleAniSourceRequest(request: Request): Promise<Response> {
  // Deliberately indistinguishable from an unknown route: confirming the
  // route exists (or why it was rejected) only teaches probers the rule.
  if (!isSameOriginRequest(request)) return hiddenRoute()
  const url = new URL(request.url)
  let rawPath = url.pathname.startsWith(`${API_PREFIX}/`) ? url.pathname.slice(API_PREFIX.length) : ''

  // Local proof-of-work session issuance is the only unauthenticated surface
  // besides health. Challenge minting costs one HMAC; exchange verification
  // costs one hash plus a single-use spend.
  if (rawPath === '/challenge' && request.method === 'GET') return servePowChallenge(request)
  if (rawPath === '/session' && request.method === 'POST') return exchangePowSession(request)
  if (!['GET', 'HEAD'].includes(request.method)) return jsonError(405, 'Method not allowed.', { Allow: 'GET, HEAD' }, 'invalid')

  const signingSecret = serverSecret()
  let viaFallback = false
  if (rawPath === FALLBACK_PREFIX || rawPath.startsWith(`${FALLBACK_PREFIX}/`)) {
    viaFallback = true
    rawPath = rawPath.slice(FALLBACK_PREFIX.length)
  }
  const requestBase = viaFallback ? fallbackBase() : apiBase()
  if (!signingSecret || !requestBase) {
    return jsonError(
      503,
      viaFallback && signingSecret
        ? 'AniSource fallback access is not configured.'
        : 'AniSource server access is not configured.',
      {},
      'misconfigured',
    )
  }
  if (!rawPath || rawPath.length > 4096 || url.search.length > 2048) return jsonError(400, 'Invalid AniSource request.', {}, 'invalid')
  const signingKey = await cachedHmacKey(signingSecret)

  const assetMatch = /^\/asset\/([^/]+)$/.exec(rawPath)
  if (!assetMatch && !isAllowedUpstreamPath(rawPath, url.search)) return hiddenRoute()

  // Every gateway route but health requires a live proof-of-work session.
  // Sessionless callers get a distinguishable 401 (never camouflage): the
  // browser client must learn it has to verify before retrying.
  const healthExempt = rawPath === '/health' || rawPath === '/api/v1/health'
  const session = await readSession(request, signingKey)
  const nowSeconds = Math.floor(Date.now() / 1000)
  const abuse = cachedAbuseStore()
  if (!healthExempt) {
    if (!session) {
      // Sessionless floods are scanner-shaped: legitimate clients 401 once
      // per session, then verify. Count every one; the tripwire below turns
      // persistent probing into a short network ban.
      const verdict = await checkAbuse(abuse, {
        ipHash: networkFingerprint(requestClientIp(request)),
        sessionFingerprint: null,
        sessionless: true,
      }, nowSeconds)
      if (!verdict.ok) {
        return jsonError(429, 'Too many verification attempts from this network. Try again shortly.', { 'Retry-After': String(verdict.retryAfterSeconds) }, 'rate-limited')
      }
      return jsonError(401, 'Browser verification is required before using AniSource.', {}, 'session-required')
    }
    // Network-bound media: the challenge was issued to one network and the
    // session carries its fingerprint. Metadata stays lenient across hops;
    // media resolution and asset tickets re-verify transparently (the browser
    // client solves on 401 and replays once), so a harvested or shared
    // session stops playing outside its home network within minutes.
    if (!!assetMatch || isMediaResolutionPath(rawPath)) {
      if (session.net !== networkFingerprint(requestClientIp(request))) {
        return jsonError(401, 'Browser verification is required before using AniSource.', {}, 'session-required')
      }
    }
    if (
      process.env.NODE_ENV === 'production' &&
      isMediaResolutionPath(rawPath) &&
      (session.scr >= SUSPICIOUS_ATTESTATION_SCORE || mediaStackForged(request))
    ) {
      // Headless playback ends here: automated sessions resolve metadata but
      // never media. Production-only by design — development and the headless
      // e2e suite keep exercising these flows, and attackers cannot reach
      // non-production deployments. Stealth clients pass by construction.
      return jsonError(403, 'Automated browsing is not supported for playback. Use a standard browser to watch or read.', {}, 'automation')
    }
  }

  // No session is ever minted here: issuance happens only through the
  // proof-of-work exchange, so health responses carry no Set-Cookie.
  const withSession = (response: Response) => appendSessionCookie(response, undefined)

  let path: string
  let search: string
  let ticket: AssetTicket | null = null
  if (assetMatch) {
    if (!session) return withSession(jsonError(403, 'Expired or invalid media ticket.', {}, 'invalid'))
    ticket = await verifyTicket(assetMatch[1]!, session, signingKey)
    if (!ticket) return withSession(jsonError(403, 'Expired or invalid media ticket.', {}, 'invalid'))
    path = ticket.p
    search = ticket.q
  } else {
    path = rawPath
    search = url.search
  }

  // Abuse telemetry runs on catalog traffic: velocity, sharing, media pacing,
  // and standing denials. Asset tickets stay write-free by design (per the
  // limiter note below): media bytes never increment counters, but a banned
  // session's ticket reads its standing denial and answers 429 immediately
  // instead of serving out the ticket lifetime. Sampled writes keep the hot
  // path cheap; denials always read.
  if (!healthExempt && !ticket && session) {
    const verdict = await checkAbuse(abuse, {
      ipHash: networkFingerprint(requestClientIp(request)),
      sessionFingerprint: sessionFingerprint(session.sid),
      sessionless: false,
      mediaResolve: isMediaResolutionPath(rawPath),
    }, nowSeconds)
    if (!verdict.ok) {
      return withSession(jsonError(429, 'Too many requests from this session. Try again shortly.', { 'Retry-After': String(verdict.retryAfterSeconds) }, 'rate-limited'))
    }
  }
  if (!healthExempt && ticket && session) {
    const verdict = await checkAbuse(abuse, {
      ipHash: networkFingerprint(requestClientIp(request)),
      sessionFingerprint: sessionFingerprint(session.sid),
      sessionless: false,
      readOnly: true,
    }, nowSeconds)
    if (!verdict.ok) {
      return withSession(jsonError(429, 'Too many requests from this session. Try again shortly.', { 'Retry-After': String(verdict.retryAfterSeconds) }, 'rate-limited'))
    }
  }

  // Media tickets are unguessable session-bound capabilities and the API applies
  // its own proxy rate limit, so only catalog JSON pays the Upstash round trips.
  // Charging every HLS segment and manga image against the limiter added two
  // Redis requests of latency to each media fetch and throttled seeking.
  const limited = ticket ? null : await checkRateLimits(request, session, signingKey)
  if (limited) return withSession(limited)

  // Media tickets are bound to the origin that issued them: a fallback ticket
  // must resolve against the fallback deployment, whose capability tokens the
  // primary origin cannot redeem.
  const activeBase = ticket?.f === true ? (fallbackBase() ?? null) : requestBase
  if (!activeBase) {
    return withSession(jsonError(503, 'AniSource fallback access is not configured.', {}, 'misconfigured'))
  }
  // Tickets carry their origin, so asset requests follow the ticket; catalog
  // JSON follows the request prefix.
  const rewriteViaFallback = ticket ? ticket.f === true : viaFallback

  const basePath = activeBase.pathname.replace(/\/$/, '')
  const upstreamPath = basePath && path.startsWith(`${basePath}/`) ? path : `${basePath}${path}`
  const upstreamUrl = new URL(upstreamPath, activeBase.origin)
  upstreamUrl.search = search
  const normalizedPath = basePath && upstreamUrl.pathname.startsWith(`${basePath}/`)
    ? upstreamUrl.pathname.slice(basePath.length)
    : upstreamUrl.pathname
  if (ticket ? !isMediaPath(normalizedPath) : !isAllowedUpstreamPath(normalizedPath, search)) {
    return withSession(jsonError(404, 'AniSource route not found.', {}, 'invalid'))
  }
  const upstreamSchema = ticket ? null : responseSchema(normalizedPath, search)
  const scope = ticket?.scope ?? await sign(`${path}${search}`, 'asset-scope-v1', signingKey)
  const serviceToken = process.env.ANISOURCE_SERVICE_TOKEN
  if ((process.env.NODE_ENV === 'production' && !serviceToken)
    || (serviceToken && new TextEncoder().encode(serviceToken).byteLength < 32)) {
    return withSession(jsonError(503, 'AniSource server access is not configured.', {}, 'misconfigured'))
  }
  // The gateway authenticates to the API on every upstream call, catalog and
  // media alike: media capability URLs are exempt from Bearer upstream, but
  // an extra header is harmless there and required when the deployment
  // enforces service auth uniformly. The credential never leaves the server.
  const sentServiceAuth = Boolean(serviceToken)

  const headers = new Headers({ Accept: request.headers.get('accept') ?? 'application/json, */*;q=0.8' })
  if (request.method === 'GET') {
    for (const name of ['range', 'if-range']) {
      const value = request.headers.get(name)
      if (value) headers.set(name, value)
    }
    // Conditional headers let the API answer 304 for cached segments instead of
    // resending bytes on every seek. They stay off catalog JSON, whose branch
    // always rewrites the body and could not honor a bodyless 304.
    if (ticket) {
      for (const name of ['if-none-match', 'if-modified-since']) {
        const value = request.headers.get(name)
        if (value) headers.set(name, value)
      }
    }
  }
  if (sentServiceAuth) headers.set('Authorization', `Bearer ${serviceToken}`)

  let upstream: Response
  try {
    upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      redirect: 'manual',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(110_000)]),
    })
  } catch (error) {
    if (request.signal.aborted) return withSession(jsonError(499, 'AniSource request cancelled.', { 'X-AniSource-Error-Kind': 'cancelled' }))
    const timeout = error instanceof Error && error.name === 'TimeoutError'
    return withSession(jsonError(timeout ? 504 : 502, timeout ? 'The streaming backend took too long to respond.' : 'Could not reach the streaming backend.', {
      'X-AniSource-Error-Kind': timeout ? 'timeout' : 'network',
    }))
  }

  if (upstream.status === 401 && sentServiceAuth) {
    // The gateway attached the service token and was still rejected: the two
    // deployments disagree on the shared secret. Surfacing the 401 would make
    // sessions report "expired stream links" and burn refresh budgets on an
    // outage no retry can heal, so translate it to a misconfigured outage.
    // This covers catalog and media alike now that both carry service auth.
    await upstream.body?.cancel()
    return withSession(jsonError(
      503,
      'The streaming service rejected the server credentials. Check that ANISOURCE_SERVICE_TOKEN matches the API service token.',
      {},
      'misconfigured',
    ))
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    return withSession(jsonError(502, 'The streaming backend returned an unsupported redirect.', {}, 'invalid'))
  }

  const contentType = upstream.headers.get('content-type')?.toLowerCase() ?? ''
  const isJson = contentType.includes('application/json')
  const isManifest = contentType.includes('mpegurl') || contentType.includes('m3u8')
  if (!ticket && !isJson) {
    await upstream.body?.cancel()
    return withSession(jsonError(502, 'AniSource returned a non-JSON API response.', {
      'X-AniSource-Error-Kind': 'invalid',
    }))
  }
  if (ticket && (contentType.includes('text/html') || contentType.includes('application/xhtml+xml'))) {
    await upstream.body?.cancel()
    return withSession(jsonError(502, 'AniSource returned an unsupported media response.', {
      'X-AniSource-Error-Kind': 'invalid',
    }))
  }
  if ((isJson || (ticket && isManifest)) && request.method !== 'HEAD' && upstream.body) {
    let bytes: Uint8Array | null
    try {
      bytes = await readBounded(upstream)
    } catch {
      const cancelled = request.signal.aborted
      return withSession(jsonError(
        cancelled ? 499 : 502,
        cancelled ? 'AniSource request cancelled.' : 'AniSource response was interrupted.',
        { 'X-AniSource-Error-Kind': cancelled ? 'cancelled' : 'network' },
      ))
    }
    if (!bytes) return withSession(jsonError(502, 'AniSource returned an oversized response.', {}, 'invalid'))
    let body = new TextDecoder().decode(bytes)
    let transformed = false
    if (isJson) {
      let parsed: unknown
      try {
        parsed = JSON.parse(body)
      } catch {
        return withSession(jsonError(502, 'AniSource returned malformed JSON.', {
          'X-AniSource-Error-Kind': 'invalid',
        }))
      }
      if (upstream.ok && upstreamSchema) {
        const validated = upstreamSchema.safeParse(parsed)
        if (!validated.success) {
          return withSession(jsonError(502, 'AniSource returned an unexpected response format.', {
            'X-AniSource-Error-Kind': 'invalid',
          }))
        }
        parsed = validated.data
        if (/^\/api\/v1\/anime\/[^/]+\/streams\/[^/]+$/.test(normalizedPath)) {
          const streams = streamSchema.array().safeParse(parsed)
          if (!streams.success) {
            return withSession(jsonError(502, 'AniSource returned an unexpected response format.', {
              'X-AniSource-Error-Kind': 'invalid',
            }))
          }
          parsed = streams.data.map(({ headers: _headers, ...stream }) => stream)
        }
      }
      try {
        const serialized = JSON.stringify(await rewriteJson(parsed, activeBase, session, signingKey, scope, rewriteViaFallback))
        if (serialized === undefined) throw new Error('AniSource response could not be serialized.')
        body = serialized
        transformed = true
      } catch (error) {
        if (error instanceof PlaybackCapUnavailable) {
          return withSession(jsonError(503, 'Direct media access is not configured.', {}, 'misconfigured'))
        }
        return withSession(jsonError(502, 'AniSource returned an unsupported URL.', {
          'X-AniSource-Error-Kind': 'invalid',
        }))
      }
    } else {
      try {
        body = await rewriteManifest(body, activeBase, session, signingKey, scope, rewriteViaFallback)
        transformed = true
      } catch (error) {
        if (error instanceof PlaybackCapUnavailable) {
          return withSession(jsonError(503, 'Direct media access is not configured.', {}, 'misconfigured'))
        }
        return withSession(jsonError(502, 'AniSource returned an unsupported playlist URL.', {
          'X-AniSource-Error-Kind': 'invalid',
        }))
      }
    }
    if (!directMediaEnabled() && containsUpstreamHost(body, activeBase)) {
      return withSession(jsonError(502, 'AniSource response contained an unrewritten upstream URL.', {
        'X-AniSource-Error-Kind': 'invalid',
      }))
    }
    const responseHeaders = browserHeaders(upstream, transformed)
    if (isJson) responseHeaders.set('Cache-Control', 'private, no-store')
    else responseHeaders.set('Cache-Control', 'private, max-age=15')
    return withSession(new Response(body, {
      status: upstream.status,
      headers: responseHeaders,
    }))
  }

  const responseHeaders = browserHeaders(upstream, false)
  if (ticket) {
    const remaining = Math.max(0, ticket.exp - Math.floor(Date.now() / 1000))
    const cache = upstream.headers.get('cache-control') ?? ''
    const maxAge = /max-age=(\d+)/i.exec(cache)?.[1]
    if (cache.includes('no-store') || !maxAge || remaining < 1) {
      responseHeaders.set('Cache-Control', 'private, no-store')
    } else {
      const age = Math.min(Number(maxAge), remaining)
      responseHeaders.set('Cache-Control', `${cache.includes('immutable') ? 'private, max-age=' + age + ', immutable' : 'private, max-age=' + age}`)
    }
  }
  const response = new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  })
  return withSession(response)
}
