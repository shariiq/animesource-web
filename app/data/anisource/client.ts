import { z } from 'zod'
import { API_DEFAULTS, API_URLS, normalizeApiUrl } from '../../config/api'
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

export const ANISOURCE_DEFAULT_BASE_URL = API_DEFAULTS.anisource

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
    readonly kind: 'network' | 'http' | 'timeout' | 'invalid' | 'cancelled',
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

const defaultTransport: AniSourceTransport = {
  fetch: (input, init) => fetch(input, init),
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (timeout) => clearTimeout(timeout),
}

export interface AniSourceClientOptions {
  baseUrl?: string
  fetchTimeoutMs?: number
  transport?: Partial<AniSourceTransport>
}

/** Catalog branch of the AniSource REST API; both share the same request machinery. */
export type AniSourceCatalog = 'anime' | 'manga'

/**
 * Client for the deployed AniSource API. All methods are client-only —
 * they are never called from loaders, SSR, or on initial page load; the
 * watch and reader routes invoke them only after explicit user navigation.
 */
export function createAniSourceClient(options: AniSourceClientOptions = {}) {
  const transport: AniSourceTransport = { ...defaultTransport, ...options.transport }
  const baseUrl = normalizeApiUrl(options.baseUrl ?? API_URLS.anisource)
  const timeoutMs = options.fetchTimeoutMs ?? AS_FETCH_TIMEOUT_MS

  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    onSlow?: () => void,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!baseUrl) throw new AniSourceError('AniSource base URL is not configured.', 'invalid')

    const controller = new AbortController()
    let callerAborted = signal?.aborted ?? false
    const abortFromCaller = () => {
      callerAborted = true
      controller.abort()
    }
    if (signal) {
      if (signal.aborted) controller.abort()
      else signal.addEventListener('abort', abortFromCaller, { once: true })
    }
    const timeout = transport.setTimeout(() => controller.abort(), timeoutMs)
    const slowTimer = onSlow ? transport.setTimeout(onSlow, AS_COLD_START_DELAY_MS) : null
    try {
      const response = await transport.fetch(baseUrl + path, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })

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
    } finally {
      transport.clearTimeout(timeout)
      if (slowTimer !== null) transport.clearTimeout(slowTimer)
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

/** Resolves relative AniSource asset URLs against the given (or configured) base. */
export function resolveUrl(
  url: string | null | undefined,
  baseUrl: string = API_URLS.anisource,
): string | null | undefined {
  if (!url) return url
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  try {
    const resolved = new URL(url, `${normalizeApiUrl(baseUrl)}/`)
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

function relaySubtitleHeaders(headers: Record<string, string>): { referer?: string; origin?: string } {
  const relayHeaders: { referer?: string; origin?: string } = {}
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase()
    if (normalized === 'referer') relayHeaders.referer = value
    if (normalized === 'origin') relayHeaders.origin = value
  }
  return relayHeaders
}

export interface SubtitleTransport {
  /** Plain client-side fetch of the track body. */
  fetchDirect(url: string): Promise<string>
  /** Fetch through the same-origin relay with spoofed referer/origin headers. */
  fetchViaRelay(url: string, headers: { referer?: string; origin?: string }): Promise<string>
}

/**
 * Builds a subtitle loader over an explicit transport seam. Relay-first when the
 * stream demands referer/origin headers a browser cannot set; direct-first
 * otherwise, with the other path as fallback.
 */
export function createSubtitleLoader(transport: SubtitleTransport) {
  return async function load(url: string, headers: Record<string, string> = {}): Promise<string> {
    const relayHeaders = relaySubtitleHeaders(headers)
    let text: string
    if (Object.keys(relayHeaders).length > 0 && url.startsWith('http')) {
      try {
        text = await transport.fetchViaRelay(url, relayHeaders)
      } catch (relayError) {
        try {
          text = await transport.fetchDirect(url)
        } catch {
          throw relayError
        }
      }
    } else {
      try {
        text = await transport.fetchDirect(url)
      } catch (error) {
        if (!url.startsWith('http')) throw error
        try {
          text = await transport.fetchViaRelay(url, relayHeaders)
        } catch {
          throw error
        }
      }
    }
    if (new Blob([text]).size > MAX_SUBTITLE_BYTES) {
      throw new AniSourceError('The subtitle track is too large to load safely.', 'invalid')
    }
    return normalizeSubtitleText(text)
  }
}

const defaultSubtitleLoader = createSubtitleLoader({
  fetchDirect: async (url) => {
    const response = await fetch(url, { headers: { Accept: 'text/vtt, text/plain;q=0.9, */*;q=0.1' } })
    if (!response.ok) throw new AniSourceError(`Subtitle request failed (${response.status}).`, 'http', response.status)
    const length = Number(response.headers.get('content-length') ?? 0)
    if (Number.isFinite(length) && length > MAX_SUBTITLE_BYTES) {
      throw new AniSourceError('The subtitle track is too large to load safely.', 'invalid')
    }
    return response.text()
  },
  fetchViaRelay: async (url, headers) => {
    const { fetchSubtitleText } = await import('./subtitle-server')
    return fetchSubtitleText({ data: { url, headers } })
  },
})

/** Fetches a subtitle payload and returns browser-ready WebVTT text. */
export function loadSubtitle(url: string, headers: Record<string, string> = {}): Promise<string> {
  return defaultSubtitleLoader(resolveUrl(url) ?? url, headers)
}

export const anisourceClient = createAniSourceClient()
