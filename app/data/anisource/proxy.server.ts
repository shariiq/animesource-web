import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { z } from 'zod'
import apiUrls from '../../../config/api-urls.json'
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
const SESSION_LIFETIME_SECONDS = 12 * 60 * 60
// Ticket lifetime sits just under the API media capability TTL (60 min) so a
// gateway expiry always fires first and its refresh pulls fresh API URLs too.
// API HLS key resources may expire sooner (10 min); those surface as upstream
// 401/403/410 on the media fetch and ride the same expired-link refresh path.
const ASSET_TICKET_LIFETIME_SECONDS = 55 * 60
const MAX_PROXY_BODY_BYTES = 8 * 1024 * 1024
const textEncoder = new TextEncoder()
const localSessionSecret = encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)))

const sessionSchema = z.object({ sid: z.string().regex(/^[A-Za-z0-9_-]{43}$/), exp: z.number().int() })
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

function secret(): string | null {
  const configured = process.env.ANISOURCE_SESSION_SECRET
  if (configured) return new TextEncoder().encode(configured).byteLength >= 32 ? configured : null
  return process.env.NODE_ENV === 'production' ? null : localSessionSecret
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

async function createSession(key: CryptoKey): Promise<{ session: Session; cookie: string }> {
  const session = {
    sid: encodeBase64Url(crypto.getRandomValues(new Uint8Array(32))),
    exp: Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS,
  }
  const payload = encodeBase64Url(textEncoder.encode(JSON.stringify(session)))
  const signature = await sign(payload, 'session-v1', key)
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  const cookie = `${cookieName()}=${payload}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_LIFETIME_SECONDS}${secure}`
  return { session, cookie }
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

function requestClientIp(request: Request): string | null {
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

async function checkRateLimits(request: Request, session: Session, key: CryptoKey): Promise<Response | null> {
  const limiters = getLimiters()
  if (!limiters) {
    return process.env.NODE_ENV === 'production'
      ? jsonError(503, 'Rate limiting is not configured.', {}, 'misconfigured')
      : null
  }
  const ip = requestClientIp(request)
  if (!ip) return jsonError(503, 'Client rate limiting is unavailable.', {}, 'misconfigured')
  try {
    const [bySession, byIp] = await Promise.all([
      limiters.session.limit(await sign(session.sid, 'limit-session-v1', key)),
      limiters.ip.limit(await sign(ip, 'limit-ip-v1', key)),
    ])
    if (bySession.success && byIp.success) return null
    const reset = Math.min(...[bySession, byIp].filter((result) => !result.success).map((result) => result.reset))
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
  return process.env.ANISOURCE_DIRECT_MEDIA === '1'
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
    return streamQuerySchema.safeParse(query).success ? streamSchema.array() : null
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

async function rewriteApiUrl(value: string, base: URL, session: Session, key: CryptoKey, scope: string, viaFallback = false): Promise<string> {
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
    if (directMediaEnabled()) return url.toString()
    const ticket = await issueTicket(path, url.search, scope, session, key, viaFallback)
    return `${API_PREFIX}/asset/${ticket}`
  }
  if (isAllowedUpstreamPath(path, url.search)) return `${API_PREFIX}${path}${url.search}${url.hash}`
  if (/^\/api\/v1(?:\/|$)/i.test(path)) throw new Error('AniSource returned an unsupported same-origin URL.')
  return `${path}${url.search}${url.hash}`
}

async function rewriteJson(value: unknown, base: URL, session: Session, key: CryptoKey, scope: string, viaFallback = false): Promise<unknown> {
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

async function rewriteManifest(content: string, base: URL, session: Session, key: CryptoKey, scope: string, viaFallback = false): Promise<string> {
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

/** The single server-side AniSource seam for catalog JSON and signed media assets. */
export async function handleAniSourceRequest(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) return jsonError(403, 'Same-origin request required.', {}, 'forbidden')
  if (!['GET', 'HEAD'].includes(request.method)) return jsonError(405, 'Method not allowed.', { Allow: 'GET, HEAD' }, 'invalid')

  const signingSecret = secret()
  const url = new URL(request.url)
  let rawPath = url.pathname.startsWith(`${API_PREFIX}/`) ? url.pathname.slice(API_PREFIX.length) : ''
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
  if (!assetMatch && !isAllowedUpstreamPath(rawPath, url.search)) return jsonError(404, 'AniSource route not found.', {}, 'invalid')
  let session = await readSession(request, signingKey)
  if (assetMatch && !session) return jsonError(403, 'Expired or invalid media ticket.', {}, 'invalid')

  let newCookie: string | undefined
  if (!session) {
    const created = await createSession(signingKey)
    session = created.session
    newCookie = created.cookie
  }
  const withSession = (response: Response) => appendSessionCookie(response, newCookie)

  let path: string
  let search: string
  let ticket: AssetTicket | null = null
  if (assetMatch) {
    ticket = await verifyTicket(assetMatch[1]!, session, signingKey)
    if (!ticket) return withSession(jsonError(403, 'Expired or invalid media ticket.', {}, 'invalid'))
    path = ticket.p
    search = ticket.q
  } else {
    path = rawPath
    search = url.search
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
  const sentServiceAuth = Boolean(serviceToken && !isMediaPath(normalizedPath))

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
      } catch {
        return withSession(jsonError(502, 'AniSource returned an unsupported URL.', {
          'X-AniSource-Error-Kind': 'invalid',
        }))
      }
    } else {
      try {
        body = await rewriteManifest(body, activeBase, session, signingKey, scope, rewriteViaFallback)
        transformed = true
      } catch {
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
