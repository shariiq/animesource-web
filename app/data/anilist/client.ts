import { z } from 'zod'
import { API_DEFAULTS, API_URLS } from '../../config/api'
import { graphQLResponseShape } from './schema'

export const ANILIST_DEFAULT_API_URL = API_DEFAULTS.anilist
export const ANILIST_API_URL = API_URLS.anilist
export const AL_FETCH_TIMEOUT_MS = 15_000
export const AL_MAX_RETRIES = 1

export class AniListError extends Error {
  constructor(
    message: string,
    readonly options: {
      status?: number
      isGraphQL?: boolean
      details?: z.infer<typeof graphQLResponseShape>['errors']
      retryAfterMs?: number
      cancelled?: boolean
    } = {},
  ) {
    super(message)
    this.name = 'AniListError'
  }

  get status() {
    return this.options.status
  }

  get isGraphQL() {
    return this.options.isGraphQL ?? false
  }

  get details() {
    return this.options.details
  }
}

export interface AniListTransport {
  fetch(input: string, init?: RequestInit): Promise<Response>
  sleep(milliseconds: number): Promise<void>
  setTimeout(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>
  clearTimeout(timeout: ReturnType<typeof setTimeout>): void
}

export interface AniListClientOptions {
  url?: string
  fetchTimeoutMs?: number
  maxRetries?: number
  transport?: Partial<AniListTransport>
}

const defaultTransport: AniListTransport = {
  fetch: (input, init) => fetch(input, init),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (timeout) => clearTimeout(timeout),
}

function retryAfterMilliseconds(value: string | null): number {
  const seconds = value === null ? Number.NaN : Number.parseFloat(value)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : 1_000
}

function rateLimitResetMilliseconds(value: string | null): number | null {
  if (value === null) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const asNumber = Number(trimmed)
  // AniList sends X-RateLimit-Reset as a Unix timestamp in seconds.
  if (Number.isFinite(asNumber) && asNumber > 0) {
    // Values far in the past are millisecond timestamps already; values near
    // the current epoch in seconds need scaling. Anything below 1e12 is
    // treated as seconds.
    const resetMs = asNumber < 1_000_000_000_000 ? asNumber * 1_000 : asNumber
    return resetMs > Date.now() ? resetMs : null
  }
  const parsed = Date.parse(trimmed)
  return Number.isFinite(parsed) && parsed > Date.now() ? parsed : null
}

function rateLimitRemaining(value: string | null): number | null {
  if (value === null) return null
  const remaining = Number.parseInt(value.trim(), 10)
  return Number.isFinite(remaining) ? remaining : null
}

/** Network client only: caller-owned QueryClient scopes caching and deduplication. */
export function createAniListClient(options: AniListClientOptions = {}) {
  const transport: AniListTransport = { ...defaultTransport, ...options.transport }
  const url = options.url ?? ANILIST_API_URL
  const timeoutMs = options.fetchTimeoutMs ?? AL_FETCH_TIMEOUT_MS
  const maxRetries = options.maxRetries ?? AL_MAX_RETRIES
  let rateLimitedUntil = 0

  const cancelledError = () => new AniListError('AniList request was cancelled.', { cancelled: true })

  const noteRateLimitHeaders = (headers: Headers) => {
    // A successful response with no remaining quota still tells us when the
    // window resets. Banking that timestamp keeps the next request from
    // spending the shared retry budget on a predictable 429.
    const resetMs = rateLimitResetMilliseconds(headers.get('x-ratelimit-reset'))
    if (resetMs !== null && rateLimitRemaining(headers.get('x-ratelimit-remaining')) === 0) {
      rateLimitedUntil = Math.max(rateLimitedUntil, resetMs)
    }
  }

  const rateLimitError = (headers: Headers, details?: z.infer<typeof graphQLResponseShape>['errors']) => {
    const retryAfterMs = Math.max(
      retryAfterMilliseconds(headers.get('retry-after')),
      (() => {
        const resetMs = rateLimitResetMilliseconds(headers.get('x-ratelimit-reset'))
        return resetMs === null ? 0 : resetMs - Date.now()
      })(),
    )
    rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + retryAfterMs)
    return new AniListError('AniList rate limit exceeded.', {
      status: 429,
      retryAfterMs,
      details,
    })
  }

  const throwIfCancelled = (signal?: AbortSignal) => {
    if (signal?.aborted) throw cancelledError()
  }

  const waitForRateLimit = async (signal?: AbortSignal) => {
    const remaining = rateLimitedUntil - Date.now()
    if (remaining <= 0) return
    throwIfCancelled(signal)
    if (!signal) {
      await transport.sleep(remaining)
      return
    }

    await new Promise<void>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | undefined
      const finish = (error?: AniListError) => {
        if (timeout !== undefined) transport.clearTimeout(timeout)
        signal.removeEventListener('abort', onAbort)
        if (error) reject(error)
        else resolve()
      }
      const onAbort = () => finish(cancelledError())
      timeout = transport.setTimeout(() => finish(), remaining)
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    })
  }

  async function once(query: string, variables: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    throwIfCancelled(signal)
    const controller = new AbortController()
    const relayAbort = () => controller.abort()
    signal?.addEventListener('abort', relayAbort, { once: true })
    const timeout = transport.setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await transport.fetch(url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      })

      if (response.status === 429) {
        throw rateLimitError(response.headers)
      }
      if (!response.ok) {
        throw new AniListError(`AniList request failed (${response.status}).`, { status: response.status })
      }

      let raw: unknown
      try {
        raw = await response.json()
      } catch {
        throw new AniListError('AniList returned malformed JSON.', { status: response.status })
      }
      const parsed = graphQLResponseShape.safeParse(raw)
      if (!parsed.success) {
        throw new AniListError('AniList returned an unexpected response shape.', { status: response.status })
      }
      if (parsed.data.errors?.length) {
        const rateLimited = parsed.data.errors.some(
          (entry) => entry.message.toLowerCase().includes('too many requests') || entry.message.toLowerCase().includes('rate limit'),
        )
        if (rateLimited || response.status === 429) throw rateLimitError(response.headers, parsed.data.errors)
        throw new AniListError(parsed.data.errors[0]?.message ?? 'AniList reported a GraphQL error.', {
          status: response.status,
          isGraphQL: true,
          details: parsed.data.errors,
        })
      }
      if (parsed.data.data === null) {
        throw new AniListError('AniList returned no data.', { status: response.status })
      }
      noteRateLimitHeaders(response.headers)
      return parsed.data.data
    } catch (error) {
      if (signal?.aborted) throw cancelledError()
      if (error instanceof AniListError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AniListError('AniList took too long to respond.')
      }
      throw new AniListError("Couldn't reach AniList. Check your connection and try again.")
    } finally {
      transport.clearTimeout(timeout)
      signal?.removeEventListener('abort', relayAbort)
    }
  }

  return {
    async request(query: string, variables: Record<string, unknown> = {}, signal?: AbortSignal): Promise<unknown> {
      throwIfCancelled(signal)
      for (let attempt = 0; ; attempt += 1) {
        try {
          await waitForRateLimit(signal)
          return await once(query, variables, signal)
        } catch (error) {
          if (!(error instanceof AniListError) || error.options.cancelled || signal?.aborted) {
            throw error
          }
          if (error.status !== 429 || attempt >= maxRetries) throw error
        }
      }
    },
  }
}

export const anilistClient = createAniListClient()
