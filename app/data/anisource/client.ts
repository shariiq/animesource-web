import { z } from 'zod'
import { normalizeApiUrl } from '../../config/api'
import { REQUEST_NONCE_COOKIE, REQUEST_NONCE_HEADER } from '../../lib/requestNonce'
import {
  createOriginRoutingState,
  isFailFastPath,
  isSwitchableFailure,
  otherOrigin,
  pickOrigin,
  recordOriginCall,
  type OriginRoutingState,
  type RoutingOrigin,
} from '../../lib/source-session/originRouting'
import {
  healthResponseSchema,
  chapterPageSchema,
  mangaChapterSchema,
  mangaSearchResponseSchema,
  anisourceMangaSchema,
  searchResponseSchema,
  sourceListResponseSchema,
  episodeSchema,
  serverSchema,
  streamSchema,
  type HealthResponse,
  type ChapterPage,
  type MangaSearchResponse,
  type SourceListResponse,
  type SearchResponse,
  type Stream,
} from './schema'

export const ANISOURCE_PROXY_BASE = '/api/anisource'

/** Same-origin gateway prefix of the overflow deployment. */
export const ANISOURCE_OVERFLOW_BASE = '/api/anisource/fallback'

/** At most one overflow warm per browser tab per window: warming is best-effort upkeep, not tracking. */
const OVERFLOW_WARM_THROTTLE_MS = 5 * 60_000
let lastOverflowWarmAt = 0

/**
 * Best-effort wake-up for a sleeping overflow deployment, fired once per
 * streaming-page visit. Same-origin gateway call, so no upstream host or
 * credential enters the browser bundle; failures are swallowed because a
 * cold origin is handled honestly by the routing policy when it matters.
 * Call only from a mounted session (`onMount`); never from loaders or
 * shared layouts.
 */
export function warmOverflowOrigin(now: number = Date.now()): void {
  if (now - lastOverflowWarmAt < OVERFLOW_WARM_THROTTLE_MS) return
  lastOverflowWarmAt = now
  // A bare client on purpose: the warm-up is upkeep, not user traffic, so it
  // must not pollute the routed client's latency statistics.
  const warm = createAniSourceClient({ baseUrl: ANISOURCE_OVERFLOW_BASE })
  void warm.health().catch(() => undefined)
}

/** A slow first response beyond this delay is surfaced as a probable cold start. */
export const AS_COLD_START_DELAY_MS = 4_500
export const AS_FETCH_TIMEOUT_MS = 25_000
export const AS_MAX_RETRIES = 0 // AniSource failures are surfaced, not silently retried

/**
 * Error raised for any AniSource failure — network, HTTP status, timeout, or
 * a body that fails schema validation. `kind` distinguishes the
 * backend-cold-start timeout case so the UI can message it differently.
 */
export class AniSourceError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'http' | 'timeout' | 'invalid' | 'cancelled' | 'rate-limited' | 'misconfigured',
    readonly status?: number,
  ) {
    super(message)
    this.name = 'AniSourceError'
  }

  get isColdStart(): boolean {
    return this.kind === 'timeout'
  }
}

export interface AniSourceTransport {
  fetch(input: string, init?: RequestInit): Promise<Response>
  setTimeout(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>
  clearTimeout(timeout: ReturnType<typeof setTimeout>): void
}

/** Every error kind the gateway may report in `x-anisource-error-kind`. */
const GATEWAY_ERROR_KINDS: ReadonlySet<string> = new Set([
  'network',
  'http',
  'timeout',
  'invalid',
  'cancelled',
  'rate-limited',
  'misconfigured',
])

function gatewayErrorKind(value: string | null): AniSourceError['kind'] | null {
  // The header is gateway-controlled, so a set-membership check is the whole
  // validation: unknown kinds fall through to the status-based handling below.
  return value && GATEWAY_ERROR_KINDS.has(value) ? value as AniSourceError['kind'] : null
}

const defaultTransport: AniSourceTransport = {
  fetch: async (input, init) => {
    const response = await fetch(input, init)
    const kind = gatewayErrorKind(response.headers.get('x-anisource-error-kind'))
    if (kind && kind !== 'http') {
      let detail = 'The AniSource request could not be completed.'
      try {
        const payload = z.object({ detail: z.string() }).safeParse(await response.clone().json())
        if (payload.success) detail = payload.data.detail
      } catch {
        // Keep the stable generic message when the proxy error body is malformed.
      }
      throw new AniSourceError(detail, kind, response.status)
    }
    return response
  },
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (timeout) => clearTimeout(timeout),
}

export interface AniSourceClientOptions {
  baseUrl?: string
  /**
   * Same-origin gateway prefix of the overflow deployment (e.g.
   * `/api/anisource/fallback`). When set, switchable origin-health failures
   * get one bounded alternate attempt there; everything else behaves exactly
   * as a single-origin client.
   */
  overflowBaseUrl?: string
  fetchTimeoutMs?: number
  /** Clock for routing windows; defaults to Date.now. Tests inject fake time. */
  clock?: () => number
  transport?: Partial<AniSourceTransport>
}

/** Catalog branch of the AniSource REST API; both share the same request machinery. */
export type AniSourceCatalog = 'anime' | 'manga'

/**
 * True for the operations whose responses mint media-byte URLs (segment and
 * playlist capabilities, reader images). Identifiers are encoded before they
 * reach here, so a literal `/streams/` or `/pages/` segment can only be the
 * operation itself.
 */
export function isMediaResolvingPath(path: string): boolean {
  return path.includes('/streams/') || path.includes('/pages/')
}

/**
 * Browser-initiated AniSource client. Requests are sent only to the same-origin
 * server route and are never called from loaders, SSR, or initial page load.
 */
export function createAniSourceClient(options: AniSourceClientOptions = {}) {
  const transport: AniSourceTransport = { ...defaultTransport, ...options.transport }
  const baseUrl = normalizeApiUrl(options.baseUrl ?? ANISOURCE_PROXY_BASE)
  const overflowUrl = options.overflowBaseUrl ? normalizeApiUrl(options.overflowBaseUrl) : null
  const routed = overflowUrl !== null && overflowUrl !== baseUrl
  // Catalog metadata stays on primary; operations that mint media-byte URLs
  // (streams, manga pages) prefer overflow so video bandwidth leaves the
  // primary deployment. Each class converges independently.
  const catalogRouting: OriginRoutingState | null = routed ? createOriginRoutingState('primary') : null
  const mediaRouting: OriginRoutingState | null = routed ? createOriginRoutingState('overflow') : null
  const clock = options.clock ?? (() => Date.now())
  const timeoutMs = options.fetchTimeoutMs ?? AS_FETCH_TIMEOUT_MS

  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    onSlow?: () => void,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!baseUrl) throw new AniSourceError('AniSource base URL is not configured.', 'invalid')

    let callerAborted = signal?.aborted ?? false
    let attemptController: AbortController | null = null
    const abortFromCaller = () => {
      callerAborted = true
      attemptController?.abort()
    }
    if (signal) {
      if (signal.aborted) callerAborted = true
      else signal.addEventListener('abort', abortFromCaller, { once: true })
    }

    async function fetchAndParse(url: string, attemptSignal: AbortSignal): Promise<T> {
      const nonce = requestNonce()
      let response: Response
      try {
        response = await transport.fetch(url, {
          signal: attemptSignal,
          headers: nonce
            ? { Accept: 'application/json', [REQUEST_NONCE_HEADER]: nonce }
            : { Accept: 'application/json' },
        })
      } catch (error) {
        if (error instanceof AniSourceError) throw error
        if (error instanceof Error && error.name === 'AbortError') {
          if (callerAborted) throw new AniSourceError('The streaming request was cancelled.', 'cancelled')
          throw new AniSourceError(
            'The streaming backend took too long to respond. It may still be waking up — try again in a moment.',
            'timeout',
          )
        }
        throw new AniSourceError(
          "Couldn't reach the streaming backend. Check your connection, or it may be waking up from sleep.",
          'network',
        )
      }

      if (!response.ok) {
        let detail = ''
        try {
          const body: unknown = await response.json()
          const errorPayload = z.object({ detail: z.union([z.string(), z.array(z.unknown())]) }).safeParse(body)
          if (errorPayload.success) {
            const { detail: responseDetail } = errorPayload.data
            detail = Array.isArray(responseDetail)
              ? responseDetail.map((entry) => String(entry)).join('; ')
              : responseDetail
          }
        } catch {
          // Non-JSON error body — fall back to the generic message.
        }
        throw new AniSourceError(
          detail || `Request failed (${response.status}).`,
          'http',
          response.status,
        )
      }

      let raw: unknown
      try {
        raw = await response.json()
      } catch {
        throw new AniSourceError('The streaming backend returned malformed JSON.', 'invalid')
      }

      const parsed = schema.safeParse(raw)
      if (!parsed.success) {
        throw new AniSourceError(
          'The streaming backend returned an unexpected response format.',
          'invalid',
        )
      }
      return parsed.data
    }

    try {
      let routing: OriginRoutingState | null = null
      if (routed && mediaRouting && catalogRouting) {
        routing = isMediaResolvingPath(path) ? mediaRouting : catalogRouting
      }
      const skipAlternate = routing ? isFailFastPath(routing, clock()) : false
      const first = routing ? pickOrigin(routing, clock()) : 'primary'
      const order: RoutingOrigin[] = routing ? [first, otherOrigin(first)] : ['primary']
      const overflowBase = overflowUrl ?? baseUrl
      for (const [attempt, origin] of order.entries()) {
        if (callerAborted || signal?.aborted) {
          throw new AniSourceError('The streaming request was cancelled.', 'cancelled')
        }
        const base = origin === 'primary' ? baseUrl : overflowBase
        let slowFired = false
        attemptController = new AbortController()
        if (callerAborted) attemptController.abort()
        const timeout = transport.setTimeout(() => attemptController?.abort(), timeoutMs)
        const slowTimer = onSlow || routing
          ? transport.setTimeout(() => {
            slowFired = true
            onSlow?.()
          }, AS_COLD_START_DELAY_MS)
          : null
        try {
          const result = await fetchAndParse(base + path, attemptController.signal)
          if (routing) {
            recordOriginCall(routing, { origin, ok: true, slow: slowFired, kind: null, aborted: false }, clock())
          }
          return result
        } catch (error) {
          const aborted = callerAborted || signal?.aborted || false
          const kind = error instanceof AniSourceError ? error.kind : null
          const status = error instanceof AniSourceError ? error.status : undefined
          if (routing) {
            recordOriginCall(routing, { origin, ok: false, slow: slowFired, kind, status, aborted }, clock())
          }
          const mayAlternate = routing !== null &&
            attempt === 0 &&
            !aborted &&
            !skipAlternate &&
            error instanceof AniSourceError &&
            isSwitchableFailure(error.kind, error.status)
          if (!mayAlternate) throw error
          // The policy already moved `active` to the alternate origin; the
          // next iteration serves the single bounded retry there.
        } finally {
          transport.clearTimeout(timeout)
          if (slowTimer !== null) transport.clearTimeout(slowTimer)
        }
      }
      // Unreachable: every iteration returns or throws.
      throw new AniSourceError('The AniSource request could not be completed.', 'network')
    } finally {
      signal?.removeEventListener('abort', abortFromCaller)
    }
  }

  /** In-memory cache for source listings — they rarely change within a session. */
  const sourceCache = new Map<AniSourceCatalog, { promise: Promise<SourceListResponse>; ts: number }>()
  const SOURCE_CACHE_TTL = 10 * 60 * 1000 // 10 minutes

  const catalogPath = (catalog: AniSourceCatalog, sourceId: string, noun: string, itemId: string): string =>
    `/api/v1/${catalog}/${encodeURIComponent(sourceId)}/${noun}/${encodeURIComponent(itemId)}`

  const listSources = (
    catalog: AniSourceCatalog,
    onSlow?: () => void,
    signal?: AbortSignal,
  ): Promise<SourceListResponse> => {
    const now = Date.now()
    const cached = sourceCache.get(catalog)
    if (cached && now - cached.ts < SOURCE_CACHE_TTL) return cached.promise
    const promise = request(`/api/v1/${catalog}/sources`, sourceListResponseSchema, onSlow, signal)
    sourceCache.set(catalog, { promise, ts: now })
    // Evict the cache on failure so subsequent calls retry.
    promise.catch(() => {
      if (sourceCache.get(catalog)?.promise === promise) sourceCache.delete(catalog)
    })
    return promise
  }

  const searchPath = (catalog: AniSourceCatalog, sourceId: string, q: string, page: number): string =>
    `/api/v1/${catalog}/${encodeURIComponent(sourceId)}/search` +
    `?q=${encodeURIComponent(q)}&page=${encodeURIComponent(page)}`

  const resolveAsset = (url: string): string => resolveUrl(url, baseUrl) ?? url
  const normalizePages = (pages: ChapterPage[]): ChapterPage[] => pages.map((page) => ({
    ...page,
    url: resolveAsset(page.url),
    page_url: resolveAsset(page.page_url),
  }))
  const normalizeStreams = (streams: Stream[]): Stream[] => streams.map((stream) => ({
    ...stream,
    url: resolveAsset(stream.url),
    subtitles: stream.subtitles.map((subtitle) => ({ ...subtitle, url: resolveAsset(subtitle.url) })),
  }))

  return {
    health(onSlow?: () => void, signal?: AbortSignal): Promise<HealthResponse> {
      return request('/health', healthResponseSchema, onSlow, signal)
    },

    sources: (onSlow?: () => void, signal?: AbortSignal) => listSources('anime', onSlow, signal),

    mangaSources: (onSlow?: () => void, signal?: AbortSignal) => listSources('manga', onSlow, signal),

    search: (sourceId: string, q: string, page = 1, onSlow?: () => void, signal?: AbortSignal): Promise<SearchResponse> =>
      request(searchPath('anime', sourceId, q, page), searchResponseSchema, onSlow, signal),

    mangaSearch: (sourceId: string, q: string, page = 1, onSlow?: () => void, signal?: AbortSignal): Promise<MangaSearchResponse> =>
      request(searchPath('manga', sourceId, q, page), mangaSearchResponseSchema, onSlow, signal),

    mangaDetails: (sourceId: string, mangaId: string, onSlow?: () => void, signal?: AbortSignal) =>
      request(catalogPath('manga', sourceId, 'manga', mangaId), anisourceMangaSchema, onSlow, signal),

    mangaChapters: (sourceId: string, mangaId: string, onSlow?: () => void, signal?: AbortSignal) =>
      request(catalogPath('manga', sourceId, 'chapters', mangaId), mangaChapterSchema.array(), onSlow, signal),

    mangaPages: async (sourceId: string, chapterId: string, onSlow?: () => void, signal?: AbortSignal) =>
      normalizePages(await request(catalogPath('manga', sourceId, 'pages', chapterId), chapterPageSchema.array(), onSlow, signal)),

    episodes: (sourceId: string, animeId: string, onSlow?: () => void, signal?: AbortSignal) =>
      request(catalogPath('anime', sourceId, 'episodes', animeId), episodeSchema.array(), onSlow, signal),

    servers: (sourceId: string, episodeId: string, onSlow?: () => void, signal?: AbortSignal) =>
      request(catalogPath('anime', sourceId, 'servers', episodeId), serverSchema.array(), onSlow, signal),

    streams: async (sourceId: string, episodeId: string, serverId: string, onSlow?: () => void, signal?: AbortSignal) =>
      normalizeStreams(await request(
        `${catalogPath('anime', sourceId, 'streams', episodeId)}?server_id=${encodeURIComponent(serverId)}`,
        streamSchema.array(),
        onSlow,
        signal,
      )),

    clearSourceCache(): void {
      sourceCache.clear()
    },
  }
}

/** Reads the request nonce the document response set; null outside the browser or before first paint. */
function requestNonce(): string | null {
  if (typeof document === 'undefined' || !document.cookie) return null
  const prefix = `${REQUEST_NONCE_COOKIE}=`
  const value = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length)
  return value && value.length <= 256 ? value : null
}

/** Resolves relative AniSource asset URLs against the given (or configured) base. */
export function resolveUrl(
  url: string | null | undefined,
  baseUrl: string = ANISOURCE_PROXY_BASE,
): string | null | undefined {
  if (!url) return url
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  const normalizedBase = normalizeApiUrl(baseUrl)
  if (!/^https?:\/\//i.test(normalizedBase)) {
    if (url.startsWith(`${ANISOURCE_PROXY_BASE}/`)) return url
    return `${normalizedBase}${url.startsWith('/') ? url : `/${url}`}`
  }
  try {
    const resolved = new URL(url, `${normalizedBase}/`)
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.toString() : url
  } catch {
    return url
  }
}

const MAX_SUBTITLE_BYTES = 2_000_000

/** Converts SRT timing syntax into the WebVTT format the media element requires. */
export function normalizeSubtitleText(raw: string): string {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1).replace(/\r\n?/g, '\n').trim() : raw.replace(/\r\n?/g, '\n').trim()
  if (!text || /<\/?(?:html|body|script)\b/i.test(text)) {
    throw new AniSourceError('The subtitle source did not return caption data.', 'invalid')
  }
  if (text.startsWith('WEBVTT')) return text
  if (!/\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/m.test(text)) {
    throw new AniSourceError('The subtitle source returned an unsupported caption format.', 'invalid')
  }
  const webVttText = text.replace(
    /^(\s*\d{2}:\d{2}:\d{2}),(\d{3})(\s*-->\s*)(\d{2}:\d{2}:\d{2}),(\d{3})(.*)$/gm,
    '$1.$2$3$4.$5$6',
  )
  return `WEBVTT\n\n${webVttText}`
}

export interface SubtitleTransport {
  fetch(url: string): Promise<string>
}

/**
 * Loads and normalizes a subtitle track returned by AniSource.
 */
export function createSubtitleLoader(transport: SubtitleTransport) {
  return async function load(url: string): Promise<string> {
    const text = await transport.fetch(url)
    if (new Blob([text]).size > MAX_SUBTITLE_BYTES) {
      throw new AniSourceError('The subtitle track is too large to load safely.', 'invalid')
    }
    return normalizeSubtitleText(text)
  }
}

const defaultSubtitleLoader = createSubtitleLoader({
  fetch: async (url) => {
    const response = await fetch(url, { headers: { Accept: 'text/vtt, text/plain;q=0.9, */*;q=0.1' } })
    if (!response.ok) throw new AniSourceError(`Subtitle request failed (${response.status}).`, 'http', response.status)
    const length = Number(response.headers.get('content-length') ?? 0)
    if (Number.isFinite(length) && length > MAX_SUBTITLE_BYTES) {
      throw new AniSourceError('The subtitle track is too large to load safely.', 'invalid')
    }
    return response.text()
  },
})

/** Fetches a subtitle payload and returns browser-ready WebVTT text. */
export function loadSubtitle(url: string): Promise<string> {
  return defaultSubtitleLoader(resolveUrl(url) ?? url)
}

export const anisourceClient = createAniSourceClient()
