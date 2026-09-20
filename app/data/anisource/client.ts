import { z } from 'zod'
import { API_DEFAULTS, API_URLS, normalizeApiUrl } from '../../config/api'
import {
  healthResponseSchema,
  searchResponseSchema,
  sourceListResponseSchema,
  episodeSchema,
  serverSchema,
  streamSchema,
  type HealthResponse,
  type SourceListResponse,
  type SearchResponse,
  type Episode,
  type Server,
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

/**
 * Client for the deployed AniSource API. All methods are client-only —
 * they are never called from loaders, SSR, or on initial page load; the
 * watch route invokes them only after explicit user navigation.
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

  /** In-memory cache for the source listing — it rarely changes within a session. */
  let cachedSources: { promise: Promise<SourceListResponse>; ts: number } | null = null
  const SOURCE_CACHE_TTL = 10 * 60 * 1000 // 10 minutes

  return {
    health(onSlow?: () => void, signal?: AbortSignal): Promise<HealthResponse> {
      return request('/health', healthResponseSchema, onSlow, signal)
    },

    sources(onSlow?: () => void, signal?: AbortSignal): Promise<SourceListResponse> {
      const now = Date.now()
      if (cachedSources && now - cachedSources.ts < SOURCE_CACHE_TTL) {
        return cachedSources.promise
      }
      const promise = request('/api/v1/sources', sourceListResponseSchema, onSlow, signal)
      cachedSources = { promise, ts: now }
      // Evict the cache on failure so subsequent calls retry.
      promise.catch(() => {
        if (cachedSources?.promise === promise) cachedSources = null
      })
      return promise
    },

    search(sourceId: string, q: string, page = 1, onSlow?: () => void, signal?: AbortSignal): Promise<SearchResponse> {
      const path =
        `/api/v1/${encodeURIComponent(sourceId)}/search` +
        `?q=${encodeURIComponent(q)}&page=${encodeURIComponent(page)}`
      return request(path, searchResponseSchema, onSlow, signal)
    },

    episodes(sourceId: string, animeId: string, onSlow?: () => void, signal?: AbortSignal): Promise<Episode[]> {
      const path = `/api/v1/${encodeURIComponent(sourceId)}/episodes/${encodeURIComponent(animeId)}`
      return request(path, episodeSchema.array(), onSlow, signal)
    },

    servers(sourceId: string, episodeId: string, onSlow?: () => void, signal?: AbortSignal): Promise<Server[]> {
      const path = `/api/v1/${encodeURIComponent(sourceId)}/servers/${encodeURIComponent(episodeId)}`
      return request(path, serverSchema.array(), onSlow, signal)
    },

    streams(
      sourceId: string,
      episodeId: string,
      serverId: string,
      onSlow?: () => void,
      signal?: AbortSignal,
    ): Promise<Stream[]> {
      const path =
        `/api/v1/${encodeURIComponent(sourceId)}/streams/${encodeURIComponent(episodeId)}` +
        `?server_id=${encodeURIComponent(serverId)}`
      return request(path, streamSchema.array(), onSlow, signal)
    },
  }
}

/** Resolves relative AniSource asset URLs against the configured base. */
export function resolveUrl(url: string | null | undefined): string | null | undefined {
  if (!url) return url
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('/')) return API_URLS.anisource + url
  return url
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

/** Fetches a subtitle payload and returns browser-ready WebVTT text. */
export async function loadSubtitle(url: string, headers: Record<string, string> = {}): Promise<string> {
  const resolved = resolveUrl(url) ?? url
  const relayHeaders = relaySubtitleHeaders(headers)
  const fetchDirect = async (): Promise<string> => {
    const response = await fetch(resolved, { headers: { Accept: 'text/vtt, text/plain;q=0.9, */*;q=0.1' } })
    if (!response.ok) throw new AniSourceError(`Subtitle request failed (${response.status}).`, 'http', response.status)
    const length = Number(response.headers.get('content-length') ?? 0)
    if (Number.isFinite(length) && length > MAX_SUBTITLE_BYTES) {
      throw new AniSourceError('The subtitle track is too large to load safely.', 'invalid')
    }
    return response.text()
  }

  const fetchViaRelay = async (): Promise<string> => {
    if (!resolved.startsWith('http')) throw new AniSourceError('The subtitle URL is not relayable.', 'invalid')
    const { fetchSubtitleText } = await import('./subtitle-server')
    return fetchSubtitleText({ data: { url: resolved, headers: relayHeaders } })
  }

  let text: string
  if (Object.keys(relayHeaders).length > 0 && resolved.startsWith('http')) {
    try {
      text = await fetchViaRelay()
    } catch (relayError) {
      try {
        text = await fetchDirect()
      } catch {
        throw relayError
      }
    }
  } else {
    try {
      text = await fetchDirect()
    } catch (error) {
      if (!resolved.startsWith('http')) throw error
      try {
        text = await fetchViaRelay()
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

export const anisourceClient = createAniSourceClient()
