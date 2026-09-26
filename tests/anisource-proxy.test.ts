// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import apiUrls from '../config/api-urls.json'
import { handleAniSourceRequest } from '../app/data/anisource/proxy.server'
import { attestationDigest, clientWeekId, countLeadingZeroBits, hmacSha256, powAttemptHash, solvePowChallenge } from '../app/lib/proofOfWork'
import type { PowAttestation } from '../app/lib/proofOfWork'

const APP_ORIGIN = 'https://app.test'
const API_ORIGIN = 'https://api.test'
const SERVICE_TOKEN = 'test-service-token-'.padEnd(48, 'x')

function request(path: string, cookie?: string, origin = APP_ORIGIN): Request {
  return new Request(`${APP_ORIGIN}${path}`, {
    headers: {
      Origin: origin,
      'Sec-Fetch-Site': origin === APP_ORIGIN ? 'same-origin' : 'cross-site',
      ...(cookie ? { Cookie: cookie } : {}),
    },
  })
}

/**
 * Answers Upstash REST shapes without a network, with just enough state to
 * be honest: SET NX claims stick per key (single-use enforcement works),
 * INCR counts per key (budgets trip), pipelines always allow (rate-limiter
 * success path, as the pre-existing tests require). Reset per test.
 */
const upstashKv = new Map<string, string>()
const upstashCounters = new Map<string, number>()
const upstashHll = new Map<string, Set<string>>()

function resetUpstashMock(): void {
  upstashKv.clear()
  upstashCounters.clear()
  upstashHll.clear()
}

function upstashKey(target: URL, body: unknown): string {
  if (Array.isArray(body) && typeof body[1] === 'string') return body[1]
  const segments = target.pathname.split('/').filter(Boolean)
  return segments.length > 1 ? segments.slice(1).join('/') : target.pathname
}

/** Apply one Redis command against the mock state; mirrors Upstash result shapes. */
function applyUpstashCommand(command: unknown[], base64: boolean): unknown {
  const name = typeof command[0] === 'string' ? command[0].toLowerCase() : ''
  const key = typeof command[1] === 'string' ? command[1] : ''
  const args = command.slice(2).map((entry) => String(entry).toLowerCase())
  if (name === 'set') {
    if (args.includes('nx') && upstashKv.has(key)) return null
    upstashKv.set(key, typeof command[2] === 'string' ? command[2] : JSON.stringify(command[2] ?? null))
    return 'OK'
  }
  if (name === 'get') {
    // Data-returning commands arrive base64-encoded on the wire, exactly
    // like production: a mock returning raw strings would decode into
    // mojibake and hide real comparison bugs.
    const stored = upstashKv.has(key) ? upstashKv.get(key) : null
    if (stored === null || stored === undefined || !base64) return stored
    return Buffer.from(stored, 'utf8').toString('base64')
  }
  if (name === 'incr' || name === 'incrby') {
    const step = name === 'incrby' && typeof command[2] === 'number' ? command[2] : 1
    const count = (upstashCounters.get(key) ?? 0) + step
    upstashCounters.set(key, count)
    return count
  }
  if (name === 'expire') return 1
  if (name === 'pfadd') {
    const member = typeof command[2] === 'string' ? command[2] : JSON.stringify(command[2] ?? null)
    let set = upstashHll.get(key)
    if (!set) {
      set = new Set()
      upstashHll.set(key, set)
    }
    const size = set.size
    set.add(member)
    return set.size > size ? 1 : 0
  }
  if (name === 'pfcount') return upstashHll.get(key)?.size ?? 0
  if (name === 'eval') {
    // Budget/telemetry scripts: ["EVAL", script, numkeys, key, ...args].
    // Emulate the INCRBY + expire-if-first and PFADD + expire-if-first
    // shapes honestly against the same maps; TTLs don't affect assertions.
    // Arity tells the shapes apart: single-argument scripts increment by a
    // literal 1 (the argument is the window), while the burn script carries
    // its amount first. Reading the window as the step would brick budgets.
    const evalKey = typeof command[3] === 'string' ? command[3] : ''
    const evalArgs = command.slice(4)
    if (typeof command[1] === 'string' && command[1].includes('PFADD')) {
      const member = typeof evalArgs[0] === 'string' ? evalArgs[0] : JSON.stringify(evalArgs[0] ?? null)
      let set = upstashHll.get(evalKey)
      if (!set) {
        set = new Set()
        upstashHll.set(evalKey, set)
      }
      const size = set.size
      set.add(member)
      return set.size > size ? 1 : 0
    }
    const step = evalArgs.length === 1 || typeof evalArgs[0] !== 'number' ? 1 : evalArgs[0]
    const count = (upstashCounters.get(evalKey) ?? 0) + step
    upstashCounters.set(evalKey, count)
    return count
  }
  // Rate-limiter Lua scripts and anything else: allow.
  return [1, 240, 239, 9_999_999_999_999]
}

function upstashAnswer(input: RequestInfo | URL, init?: RequestInit): Response | null {
  const target = new URL(input instanceof Request ? input.url : input.toString())
  if (target.host !== 'upstash.test') return null
  const json = (value: unknown) => new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  })
  let body: unknown = null
  try {
    body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
  } catch {
    body = null
  }
  let base64 = false
  try {
    base64 = new Headers(init?.headers).get('Upstash-Encoding') === 'base64'
  } catch {
    base64 = false
  }
  if (Array.isArray(body) && body.every((entry) => Array.isArray(entry))) {
    // The client pipelines every command: one response entry per command.
    return json(body.map((entry) => ({ result: applyUpstashCommand(entry as unknown[], base64) })))
  }
  if (Array.isArray(body)) {
    return json({ result: applyUpstashCommand(body, base64) })
  }
  const command = target.pathname.split('/').filter(Boolean)[0]?.toUpperCase() ?? ''
  const key = upstashKey(target, body)
  if (command === 'SET') {
    if (upstashKv.has(key)) return json({ result: null })
    upstashKv.set(key, '1')
    return json({ result: 'OK' })
  }
  if (command === 'INCR' || command === 'INCRBY') {
    const step = command === 'INCRBY' && Array.isArray(body) && typeof body[2] === 'number' ? body[2] : 1
    const count = (upstashCounters.get(key) ?? 0) + step
    upstashCounters.set(key, count)
    return json({ result: count })
  }
  if (command === 'EXPIRE') return json({ result: 1 })
  return json({ result: null })
}

/**
 * Solves a real proof-of-work challenge and exchanges it, returning the
 * session cookie exactly as a browser would hold it. Uses whatever
 * environment the test stubbed (including production + mocked Redis).
 */
const CLEAN_ATTESTATION: PowAttestation = {
  webdriver: false,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  plugins: 5,
  languages: 2,
  hardwareConcurrency: 8,
  screenWidth: 1920,
  screenHeight: 1080,
  touchPoints: 0,
  mobile: false,
  av: 1,
  cw: clientWeekId(Date.now()),
}

const HEADLESS_ATTESTATION: PowAttestation = {
  webdriver: true,
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0 Safari/537.36',
  plugins: 0,
  languages: 1,
  hardwareConcurrency: 4,
  screenWidth: 800,
  screenHeight: 600,
  touchPoints: 0,
  mobile: false,
  av: 1,
  cw: clientWeekId(Date.now()),
}

async function verifiedSession(attestation: PowAttestation = CLEAN_ATTESTATION, forwardedFor?: string): Promise<string> {
  const ipHeaders: Record<string, string> = forwardedFor ? { 'X-Vercel-Forwarded-For': forwardedFor } : {}
  const challengeRes = await handleAniSourceRequest(new Request(`${APP_ORIGIN}/api/anisource/challenge`, {
    headers: { Origin: APP_ORIGIN, 'Sec-Fetch-Site': 'same-origin', ...ipHeaders },
  }))
  expect(challengeRes.status).toBe(200)
  const { challenge, difficulty } = z
    .object({ challenge: z.string(), difficulty: z.number(), expiresIn: z.number() })
    .parse(await challengeRes.json())
  const id = challenge.split('.')[0]
  if (!id) throw new Error('Expected the challenge to carry an id.')
  const { nonce } = await solvePowChallenge(id, difficulty, { binding: attestationDigest(attestation) })
  const exchange = await handleAniSourceRequest(new Request(`${APP_ORIGIN}/api/anisource/session`, {
    method: 'POST',
    headers: {
      Origin: APP_ORIGIN,
      'Sec-Fetch-Site': 'same-origin',
      'Content-Type': 'application/json',
      ...ipHeaders,
    },
    body: JSON.stringify({ challenge, solution: { nonce }, attestation }),
  }))
  expect(exchange.status).toBe(200)
  const setCookie = exchange.headers.get('set-cookie')
  if (!setCookie) throw new Error('Expected the exchange to mint a session cookie.')
  const cookie = setCookie.split(';', 1)[0]
  if (!cookie) throw new Error('Expected the session cookie to carry a value.')
  return cookie
}

/** Solves a fresh challenge and returns the exchange POST body for it. */
async function solvedExchangeBody(attestation: PowAttestation, forwardedFor?: string): Promise<{ challenge: string; solution: { nonce: number }; attestation: PowAttestation }> {
  const ipHeaders: Record<string, string> = forwardedFor ? { 'X-Vercel-Forwarded-For': forwardedFor } : {}
  const challengeRes = await handleAniSourceRequest(new Request(`${APP_ORIGIN}/api/anisource/challenge`, {
    headers: { Origin: APP_ORIGIN, 'Sec-Fetch-Site': 'same-origin', ...ipHeaders },
  }))
  if (challengeRes.status !== 200) throw new Error('Expected a challenge.')
  const { challenge, difficulty } = z
    .object({ challenge: z.string(), difficulty: z.number(), expiresIn: z.number() })
    .parse(await challengeRes.json())
  const id = challenge.split('.')[0]
  if (!id) throw new Error('Expected the challenge to carry an id.')
  const { nonce } = await solvePowChallenge(id, difficulty, { binding: attestationDigest(attestation) })
  return { challenge, solution: { nonce }, attestation }
}

function ticketUrl(response: Response): Promise<string> {
  return response.json().then((body: unknown) =>
    z.array(z.object({ url: z.string() })).parse(body)[0]!.url,
  )
}

/**
 * Re-labels a dev-minted session cookie with its production `__Host-` name.
 * The value verifies identically (the name is not part of the HMAC), which
 * lets prod-fail-closed tests hold a session without a Redis-backed
 * production exchange.
 */
function asProdCookie(cookie: string): string {
  return cookie.replace(/^anisource-session=/, '__Host-anisource-session=')
}

describe('AniSource server boundary', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('ANISOURCE_BASE', API_ORIGIN)
    vi.stubEnv('ANISOURCE_SERVICE_TOKEN', SERVICE_TOKEN)
    vi.stubEnv('ANISOURCE_SESSION_SECRET', 'session-secret-'.padEnd(48, 's'))
    vi.stubEnv('ANISOURCE_FALLBACK_BASE', '')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
    vi.stubEnv('ANISOURCE_DIRECT_MEDIA', '')
    vi.stubEnv('ANISOURCE_POW_DIFFICULTY', '6')
    resetUpstashMock()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('uses the shared AniSource URL default when no server override is set', async () => {
    vi.stubEnv('ANISOURCE_BASE', '')
    const upstreamFetch = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({
      status: 'ok',
      version: 'test',
      uptime_seconds: 1,
      memory_usage_mb: 1,
      active_sources: 0,
      cache_stats: {},
    }), { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', upstreamFetch)

    const response = await handleAniSourceRequest(request('/api/anisource/health'))

    expect(response.status).toBe(200)
    expect(new URL(upstreamFetch.mock.calls[0]![0].toString()).origin).toBe(apiUrls.anisource)
  })

  it('rewrites HLS children to session-bound same-origin tickets and keeps the API key server-side', async () => {
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = new URL(input.toString())
      if (url.pathname.includes('/streams/')) {
        return new Response(JSON.stringify([{
          url: `${API_ORIGIN}/api/v1/proxy/hls/master`,
          quality: 'Auto',
          headers: { Referer: 'https://extractor.test/watch', Authorization: 'private-extractor-token' },
        }]), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response([
        '#EXTM3U',
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",URI="https://api.test/api/v1/proxy/hls/audio?sig=1"',
        '#EXTINF:4,',
        'https://api.test/api/v1/proxy/hls/segment?sig=2',
      ].join('\n'), {
        headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
      })
    })
    vi.stubGlobal('fetch', upstreamFetch)

    const cookie = await verifiedSession()
    const catalog = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/test/streams/episode?server_id=1', cookie))
    expect(catalog.status).toBe(200)
    const catalogBody = await catalog.clone().json()
    const streamUrl = await ticketUrl(catalog)
    expect(streamUrl).toMatch(/^\/api\/anisource\/asset\//)
    expect(JSON.stringify(catalogBody)).not.toContain(API_ORIGIN)
    expect(JSON.stringify(catalogBody)).not.toContain('private-extractor-token')
    expect(JSON.stringify(catalogBody)).not.toContain('extractor.test')
    expect(catalogBody[0]).not.toHaveProperty('headers')
    expect(new Headers(upstreamFetch.mock.calls[0]![1]?.headers).get('Authorization')).toBe(`Bearer ${SERVICE_TOKEN}`)

    const manifest = await handleAniSourceRequest(request(new URL(streamUrl, APP_ORIGIN).pathname, cookie))
    const body = await manifest.text()
    expect(body).toContain('URI="/api/anisource/asset/')
    expect(body).toContain('\n/api/anisource/asset/')
    expect(body).not.toContain(API_ORIGIN)
    // Ticket-mode media carries service auth upstream like catalog, so a
    // uniformly-enforced API keeps serving through the gateway.
    expect(new Headers(upstreamFetch.mock.calls[1]![1]?.headers).get('Authorization')).toBe(`Bearer ${SERVICE_TOKEN}`)

    const foreignSession = await handleAniSourceRequest(request(new URL(streamUrl, APP_ORIGIN).pathname))
    expect(foreignSession.status).toBe(401)
    expect(foreignSession.headers.get('x-anisource-error-kind')).toBe('session-required')
    expect(upstreamFetch).toHaveBeenCalledTimes(2)
  })

  it('passes absolute API media URLs through directly when direct media is enabled', async () => {
    vi.stubEnv('ANISOURCE_DIRECT_MEDIA', '1')
    const upstreamFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify([
      {
        url: `${API_ORIGIN}/api/v1/proxy/hls/master`,
        quality: 'Auto',
        headers: { Referer: 'https://extractor.test/watch', Authorization: 'private-extractor-token' },
      },
      {
        // Protocol-relative URLs inherit the API origin and pass through too.
        url: `//${new URL(API_ORIGIN).host}/api/v1/proxy/hls/variant`,
        quality: '720p',
        is_hls: true,
        is_audio: false,
      },
    ]), {
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', upstreamFetch)

    const cookie = await verifiedSession()
    const catalog = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/test/streams/episode?server_id=1', cookie))

    expect(catalog.status).toBe(200)
    const body = await catalog.json()
    // Direct mode passes absolute API URLs through, each carrying a
    // session-bound playback capability (ADR 0006) instead of a bare bearer.
    for (const [index, token] of ['master', 'variant'].entries()) {
      const url = new URL(body[index].url)
      expect(`${url.origin}${url.pathname}`).toBe(`${API_ORIGIN}/api/v1/proxy/hls/${token}`)
      const cap = url.searchParams.get('cap')
      expect(cap).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
      const claims = JSON.parse(Buffer.from(cap!.split('.')[1]!, 'base64url').toString('utf8'))
      expect(claims.v).toBe(1)
      expect(claims.scope).toMatch(/^[0-9a-f]{64}$/)
      expect(claims.exp).toBeGreaterThan(claims.iat)
    }
    // Capabilities bind the exact API token: the two URLs carry different caps.
    expect(new URL(body[0].url).searchParams.get('cap')).not.toBe(new URL(body[1].url).searchParams.get('cap'))
    expect(JSON.stringify(body)).not.toContain('/api/anisource/asset/')
    // Extractor credentials are still stripped even though URLs pass through.
    expect(JSON.stringify(body)).not.toContain('private-extractor-token')
    expect(JSON.stringify(body)).not.toContain('extractor.test')
    expect(body[0]).not.toHaveProperty('headers')
    expect(new Headers(upstreamFetch.mock.calls[0]![1]?.headers).get('Authorization')).toBe(`Bearer ${SERVICE_TOKEN}`)
  })

  it('fails closed in production when direct media has no capability secret', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ANISOURCE_DIRECT_MEDIA', '1')
    vi.stubEnv('ANISOURCE_PLAYBACK_SECRETS', '')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.test')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-secret')
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const mocked = upstashAnswer(input, init)
      if (mocked) return mocked
      return new Response(JSON.stringify([{
        url: `${API_ORIGIN}/api/v1/proxy/hls/master`,
        quality: 'Auto',
        is_hls: true,
        is_audio: false,
      }]), { headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', upstreamFetch)

    const cookie = await verifiedSession(CLEAN_ATTESTATION, '203.0.113.7')
    // Production rate limiting keys off the platform forwarding header;
    // without it this would 503 before ever reaching capability minting,
    // passing for the wrong reason. The session is minted from the same
    // network so its media binding matches the follow-up request.
    const catalog = await handleAniSourceRequest(new Request(`${APP_ORIGIN}/api/anisource/api/v1/anime/test/streams/episode?server_id=1`, {
      headers: {
        Origin: APP_ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
        Cookie: cookie,
        'X-Vercel-Forwarded-For': '203.0.113.7',
      },
    }))
    expect(catalog.status).toBe(503)
    expect(catalog.headers.get('X-AniSource-Error-Kind')).toBe('misconfigured')
  })

  it('rewrites protocol-relative HLS URLs to session-bound same-origin tickets', async () => {
    const protocolRelativeUrl = `//${new URL(API_ORIGIN).host}/api/v1/proxy/hls/master-token`
    const upstreamFetch = vi.fn(async () => new Response(JSON.stringify([{
      url: protocolRelativeUrl,
      quality: 'Auto',
      is_hls: true,
      is_audio: false,
    }]), { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', upstreamFetch)

    const cookie = await verifiedSession()
    const response = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/test/streams/episode?server_id=1', cookie))
    const body = await response.clone().json()
    const url = await ticketUrl(response)

    expect(response.status).toBe(200)
    expect(url).toMatch(/^\/api\/anisource\/asset\//)
    expect(JSON.stringify(body)).not.toContain(API_ORIGIN)
  })

  it('forwards byte ranges through HLS media tickets and preserves partial responses', async () => {
    const byteRange = 'bytes=10-19'
    const ifRange = '"segment-v1"'
    const segmentBytes = Uint8Array.from({ length: 10 }, (_, index) => index + 10)
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(input.toString()).pathname
      if (path.includes('/streams/')) {
        return new Response(JSON.stringify([{
          url: `${API_ORIGIN}/api/v1/proxy/hls/master-token`,
          quality: 'Auto',
          is_hls: true,
          is_audio: false,
        }]), { headers: { 'Content-Type': 'application/json' } })
      }
      if (path.endsWith('/master-token')) {
        return new Response(`#EXTM3U\n#EXTINF:4,\n${API_ORIGIN}/api/v1/proxy/hls/segment-token`, {
          headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
        })
      }
      expect(path).toBe('/api/v1/proxy/hls/segment-token')
      expect(new Headers(init?.headers).get('Range')).toBe(byteRange)
      expect(new Headers(init?.headers).get('If-Range')).toBe(ifRange)
      return new Response(segmentBytes, {
        status: 206,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': String(segmentBytes.byteLength),
          'Content-Range': 'bytes 10-19/100',
          'Content-Type': 'video/mp4',
        },
      })
    })
    vi.stubGlobal('fetch', upstreamFetch)

    const cookie = await verifiedSession()
    const streams = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/test/streams/episode?server_id=1', cookie))
    const masterUrl = await ticketUrl(streams)
    const manifest = await handleAniSourceRequest(request(new URL(masterUrl, APP_ORIGIN).pathname, cookie))
    const segmentPath = (await manifest.text()).match(/\/api\/anisource\/asset\/[A-Za-z0-9_.-]+/)?.[0]
    if (!segmentPath) throw new Error('Expected the HLS segment to be rewritten to an asset ticket.')
    const segment = await handleAniSourceRequest(new Request(`${APP_ORIGIN}${segmentPath}`, {
      headers: {
        Origin: APP_ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
        Cookie: cookie,
        Range: byteRange,
        'If-Range': ifRange,
      },
    }))

    expect(segment.status).toBe(206)
    expect(segment.headers.get('Accept-Ranges')).toBe('bytes')
    expect(segment.headers.get('Content-Range')).toBe('bytes 10-19/100')
    expect(segment.headers.get('Content-Length')).toBe('10')
    expect([...new Uint8Array(await segment.arrayBuffer())]).toEqual([...segmentBytes])
    expect(upstreamFetch).toHaveBeenCalledTimes(3)
  })

  it('streams signed manga pages and forwards range without sharing the upstream cache policy', async () => {
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (!new URL(input.toString()).pathname.includes('/manga/page/')) {
        return new Response(JSON.stringify([{ index: 0, url: `${API_ORIGIN}/api/v1/manga/page/page-token` }]), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Length': '3',
          'Cache-Control': 'public, max-age=86400, immutable',
        },
      })
    })
    vi.stubGlobal('fetch', upstreamFetch)

    const cookie = await verifiedSession()
    const pages = await handleAniSourceRequest(request('/api/anisource/api/v1/manga/test/pages/chapter', cookie))
    const url = await ticketUrl(pages)
    const page = await handleAniSourceRequest(new Request(`${APP_ORIGIN}${url}`, {
      headers: {
        Origin: APP_ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
        Cookie: cookie,
        Range: 'bytes=0-2',
      },
    }))

    expect(new Headers(upstreamFetch.mock.calls[1]![1]?.headers).get('Range')).toBe('bytes=0-2')
    expect(new Headers(upstreamFetch.mock.calls[1]![1]?.headers).get('Authorization')).toBe(`Bearer ${SERVICE_TOKEN}`)
    expect(page.headers.get('Cache-Control')).toContain('private')
    expect(page.headers.get('Cache-Control')).not.toContain('public')
    expect(page.headers.get('Content-Length')).toBe('3')
    expect([...new Uint8Array(await page.arrayBuffer())]).toEqual([1, 2, 3])
  })

  it('validates request shape and AniSource JSON before returning it to the client', async () => {
    const upstreamFetch = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({ items: 'not-an-array' }), {
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', upstreamFetch)

    const cookie = await verifiedSession()
    const response = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/source%2Fid/search?q=title&page=1', cookie))
    const malformedRoute = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/test/streams/episode'))

    expect(response.status).toBe(502)
    expect(response.headers.get('x-anisource-error-kind')).toBe('invalid')
    expect(new URL(upstreamFetch.mock.calls[0]![0].toString()).pathname).toContain('/source%2Fid/search')
    expect(malformedRoute.status).toBe(404)
    expect(upstreamFetch).toHaveBeenCalledOnce()
  })

  it('preserves source-relative result URLs in a search response', async () => {
    const sourceUrl = '/anime/return-of-the-blossoming-blade'
    const upstreamFetch = vi.fn(async () => new Response(JSON.stringify({
      items: [
        { id: 'return-of-the-blossoming-blade', title: 'Return of the Blossoming Blade', url: sourceUrl },
        { id: 'absolute-result', title: 'Absolute result', url: `${API_ORIGIN}/anime/absolute-result` },
      ],
      page: 1,
      has_next: false,
      total_returned: 1,
    }), {
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', upstreamFetch)

    const cookie = await verifiedSession()
    const response = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/kickassanime/search?q=Return&page=1', cookie))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      items: [{ url: sourceUrl }, { url: '/anime/absolute-result' }],
    })
  })

  it('rejects unsupported AniSource API URLs embedded in JSON', async () => {
    const upstreamFetch = vi.fn(async () => new Response(JSON.stringify({
      items: [{ id: 'unexpected', title: 'Unexpected', url: `${API_ORIGIN}/api/v1/private` }],
      page: 1,
      has_next: false,
      total_returned: 1,
    }), { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', upstreamFetch)

    const cookie = await verifiedSession()
    const response = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/kickassanime/search?q=Return&page=1', cookie))

    expect(response.status).toBe(502)
    expect(response.headers.get('x-anisource-error-kind')).toBe('invalid')
  })

  it('hides cross-origin and non-allowlisted requests as unknown routes before contacting AniSource', async () => {
    const upstreamFetch = vi.fn()
    vi.stubGlobal('fetch', upstreamFetch)

    const crossOrigin = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/sources', undefined, 'https://evil.test'))
    const arbitraryPath = await handleAniSourceRequest(request('/api/anisource/https://evil.test/secret'))

    expect(crossOrigin.status).toBe(404)
    expect(arbitraryPath.status).toBe(404)
    // A rejected prober learns nothing: byte-identical to an unknown route.
    expect(await crossOrigin.text()).toBe(await arbitraryPath.text())
    expect(crossOrigin.headers.get('x-anisource-error-kind')).toBe(arbitraryPath.headers.get('x-anisource-error-kind'))
    expect(crossOrigin.headers.get('set-cookie')).toBeNull()
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('checks the HMAC-SHA256 primitive against RFC 4231 vectors', () => {
    const hex = (bytes: Uint8Array): string => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    const bytes = (values: number[]): Uint8Array => new Uint8Array(values)
    const ascii = (text: string): Uint8Array => new TextEncoder().encode(text)
    expect(hex(hmacSha256(bytes(new Array(20).fill(0x0b)), ascii('Hi There')))).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    )
    expect(hex(hmacSha256(ascii('Jefe'), ascii('what do ya want for nothing?')))).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    )
    expect(hex(hmacSha256(bytes(new Array(20).fill(0xaa)), bytes(new Array(50).fill(0xdd))))).toBe(
      '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe',
    )
    const key25 = bytes(Array.from({ length: 25 }, (_, index) => index + 1))
    expect(hex(hmacSha256(key25, bytes(new Array(50).fill(0xcd))))).toBe(
      '82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b',
    )
  })

  it('counts leading zero bits at bit granularity', () => {
    expect(countLeadingZeroBits(new Uint8Array([0x00, 0x00, 0x01]))).toBe(23)
    expect(countLeadingZeroBits(new Uint8Array([0x80]))).toBe(0)
    expect(countLeadingZeroBits(new Uint8Array([0x0f]))).toBe(4)
    expect(countLeadingZeroBits(new Uint8Array([0xff]))).toBe(0)
  })

  it('solves challenges and rejects wrong nonces by hash', async () => {
    const { nonce } = await solvePowChallenge('test-challenge', 8)
    expect(countLeadingZeroBits(powAttemptHash('test-challenge', nonce))).toBeGreaterThanOrEqual(8)
    expect(countLeadingZeroBits(powAttemptHash('test-challenge', nonce + 1_000_000_007))).not.toBeGreaterThanOrEqual(256)
  })

  it('charges the exchange budget before parsing, so garbage still pays', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.test')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-secret')
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const mocked = upstashAnswer(input, init)
      if (mocked) return mocked
      throw new Error(`Unexpected upstream fetch: ${input.toString()}`)
    })
    vi.stubGlobal('fetch', upstreamFetch)

    const garbage = () => handleAniSourceRequest(new Request(`${APP_ORIGIN}/api/anisource/session`, {
      method: 'POST',
      headers: { Origin: APP_ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
      body: 'not-json{{{',
    }))
    // Five malformed attempts answer 400; the sixth trips the tight exchange
    // budget with 429 — budgets run before the parser by design.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await garbage()).status).toBe(400)
    }
    const throttled = await garbage()
    expect(throttled.status).toBe(429)
    expect(throttled.headers.get('x-anisource-error-kind')).toBe('rate-limited')
  })

  it('fails closed with typed outages when Redis is unreachable', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.test')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-secret')
    const working = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const mocked = upstashAnswer(input, init)
      if (mocked) return mocked
      const target = new URL(input instanceof Request ? input.url : input.toString())
      if (target.pathname.includes('/streams/')) {
        return new Response(JSON.stringify([{
          url: `${API_ORIGIN}/api/v1/proxy/hls/master`,
          quality: 'Auto',
          is_hls: true,
          is_audio: false,
        }]), { headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'video/mp4' } })
    })
    vi.stubGlobal('fetch', working)

    const cookie = await verifiedSession()
    const catalog = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/test/streams/episode?server_id=1', cookie))
    expect(catalog.status).toBe(200)
    const ticketPath = new URL(await ticketUrl(catalog), APP_ORIGIN).pathname

    const redisDown = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = new URL(input instanceof Request ? input.url : input.toString())
      if (target.host === 'upstash.test') throw new Error('redis unreachable')
      return working(input, init)
    })
    vi.stubGlobal('fetch', redisDown)

    // No bare 500s and no fail-open telemetry: every Redis-backed verdict
    // answers 503 with the existing misconfigured kind.
    for (const response of [
      await handleAniSourceRequest(request('/api/anisource/challenge')),
      await handleAniSourceRequest(new Request(`${APP_ORIGIN}/api/anisource/session`, {
        method: 'POST',
        headers: { Origin: APP_ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
        body: 'garbage',
      })),
      await handleAniSourceRequest(request('/api/anisource/api/v1/anime/sources')),
      await handleAniSourceRequest(request('/api/anisource/api/v1/anime/sources', cookie)),
      await handleAniSourceRequest(request(ticketPath, cookie)),
    ]) {
      expect(response.status).toBe(503)
      expect(response.headers.get('x-anisource-error-kind')).toBe('misconfigured')
    }
  })

  it('requires a live session for catalog routes, distinguishably', async () => {
    const upstreamFetch = vi.fn()
    vi.stubGlobal('fetch', upstreamFetch)

    const missing = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/sources'))
    expect(missing.status).toBe(401)
    expect(missing.headers.get('x-anisource-error-kind')).toBe('session-required')
    expect(await missing.json()).toEqual({ detail: expect.stringContaining('verification') })
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('issues sessions only for solved, fresh, unspent challenges bound to the network', async () => {
    const upstreamFetch = vi.fn()
    vi.stubGlobal('fetch', upstreamFetch)

    const tamperedSolution = await handleAniSourceRequest(new Request(`${APP_ORIGIN}/api/anisource/session`, {
      method: 'POST',
      headers: { Origin: APP_ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge: 'garbage.challenge', solution: { nonce: 0 } }),
    }))
    expect(tamperedSolution.status).toBe(400)

    const malformed = await handleAniSourceRequest(new Request(`${APP_ORIGIN}/api/anisource/session`, {
      method: 'POST',
      headers: { Origin: APP_ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge: 'x', solution: {} }),
    }))
    expect(malformed.status).toBe(400)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('spends each challenge once when a spent store is configured', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.test')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-secret')
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const mocked = upstashAnswer(input, init)
      if (mocked) return mocked
      throw new Error(`Unexpected upstream fetch: ${input.toString()}`)
    })
    vi.stubGlobal('fetch', upstreamFetch)

    const challengeRes = await handleAniSourceRequest(request('/api/anisource/challenge'))
    const { challenge, difficulty } = z
      .object({ challenge: z.string(), difficulty: z.number(), expiresIn: z.number() })
      .parse(await challengeRes.json())
    const id = challenge.split('.')[0]
    if (!id) throw new Error('Expected the challenge to carry an id.')
    const { nonce } = await solvePowChallenge(id, difficulty, { binding: attestationDigest(CLEAN_ATTESTATION) })
    const exchange = (body: unknown) => handleAniSourceRequest(new Request(`${APP_ORIGIN}/api/anisource/session`, {
      method: 'POST',
      headers: { Origin: APP_ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
      body: JSON.stringify(typeof body === 'object' && body !== null ? { ...body, attestation: CLEAN_ATTESTATION } : body),
    }))
    const first = await exchange({ challenge, solution: { nonce } })
    expect(first.status).toBe(200)
    const replay = await exchange({ challenge, solution: { nonce } })
    expect(replay.status).toBe(400)
    expect(await replay.json()).toEqual({ detail: expect.stringContaining('expired') })
  })

  it('escalates challenge difficulty for networks burning their budget', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.test')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-secret')
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const mocked = upstashAnswer(input, init)
      if (mocked) return mocked
      throw new Error(`Unexpected upstream fetch: ${input.toString()}`)
    })
    vi.stubGlobal('fetch', upstreamFetch)

    const difficulties: number[] = []
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const response = await handleAniSourceRequest(request('/api/anisource/challenge'))
      expect(response.status).toBe(200)
      difficulties.push(z.object({ difficulty: z.number() }).parse(await response.json()).difficulty)
    }
    // Base difficulty is 6 in tests; past 10 budget hits the same network
    // earns +2 bits, past 20 earns +4.
    expect(difficulties[9]).toBe(6)
    expect(difficulties[10]).toBe(8)
    expect(difficulties[24]).toBe(10)
  })

  it('budgets challenge issuance per network', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.test')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-secret')
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const mocked = upstashAnswer(input, init)
      if (mocked) return mocked
      throw new Error(`Unexpected upstream fetch: ${input.toString()}`)
    })
    vi.stubGlobal('fetch', upstreamFetch)

    let throttled = 0
    for (let attempt = 0; attempt < 35; attempt += 1) {
      const response = await handleAniSourceRequest(request('/api/anisource/challenge'))
      if (response.status === 429) throttled += 1
      else expect(response.status).toBe(200)
    }
    expect(throttled).toBeGreaterThan(0)
  })

  it('shortens sessions for automated environments without blocking them', async () => {
    const exchange = await handleAniSourceRequest(new Request(`${APP_ORIGIN}/api/anisource/session`, {
      method: 'POST',
      headers: { Origin: APP_ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
      body: JSON.stringify(await solvedExchangeBody(HEADLESS_ATTESTATION)),
    }))
    expect(exchange.status).toBe(200)
    expect(exchange.headers.get('set-cookie')).toContain('Max-Age=1200')

    const clean = await handleAniSourceRequest(new Request(`${APP_ORIGIN}/api/anisource/session`, {
      method: 'POST',
      headers: { Origin: APP_ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
      body: JSON.stringify(await solvedExchangeBody(CLEAN_ATTESTATION)),
    }))
    expect(clean.status).toBe(200)
    expect(clean.headers.get('set-cookie')).toContain('Max-Age=7200')
  })

  it('bans sessionless floods and honors standing denials', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.test')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-secret')
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const mocked = upstashAnswer(input, init)
      if (mocked) return mocked
      throw new Error(`Unexpected upstream fetch: ${input.toString()}`)
    })
    vi.stubGlobal('fetch', upstreamFetch)

    let denied = 0
    for (let attempt = 0; attempt < 205; attempt += 1) {
      const response = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/sources'))
      if (response.status === 401) continue
      expect(response.status).toBe(429)
      expect(response.headers.get('x-anisource-error-kind')).toBe('rate-limited')
      expect(response.headers.get('Retry-After')).toBe('900')
      denied += 1
    }
    expect(denied).toBeGreaterThan(0)
  })

  it('denies banned sessions before touching upstream', async () => {
    const { createHash } = await import('node:crypto')
    const cookie = await verifiedSession()
    const payload = JSON.parse(Buffer.from(cookie.split('=')[1]!.split('.')[0]!, 'base64url').toString('utf8')) as { sid: string }
    const fingerprint = createHash('sha256').update(`abuse-session-v1:${payload.sid}`).digest('hex')
    upstashKv.set(`abuse:denied:sid:${fingerprint}`, 'velocity')

    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.test')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-secret')
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const mocked = upstashAnswer(input, init)
      if (mocked) return mocked
      throw new Error(`Unexpected upstream fetch: ${input.toString()}`)
    })
    vi.stubGlobal('fetch', upstreamFetch)
    const response = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/sources', cookie))
    expect(response.status).toBe(429)
    expect(response.headers.get('x-anisource-error-kind')).toBe('rate-limited')
    expect(response.headers.get('Retry-After')).toBe('1800')
    for (const [input] of upstreamFetch.mock.calls) {
      expect(new URL(input instanceof Request ? input.url : input.toString()).host).toBe('upstash.test')
    }
  })

  it('rejects exchanges without a well-formed attestation', async () => {
    const body = await solvedExchangeBody(CLEAN_ATTESTATION)
    const missing = await handleAniSourceRequest(new Request(`${APP_ORIGIN}/api/anisource/session`, {
      method: 'POST',
      headers: { Origin: APP_ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge: body.challenge, solution: body.solution }),
    }))
    expect(missing.status).toBe(400)
  })

  it('blocks media resolution for automated sessions in production, nowhere else', async () => {
    const streamsUpstream = (input: RequestInfo | URL, init?: RequestInit) => {
      const mocked = upstashAnswer(input, init)
      if (mocked) return mocked
      return new Response(JSON.stringify([{
        url: `${API_ORIGIN}/api/v1/proxy/hls/master`,
        quality: 'Auto',
        is_hls: true,
        is_audio: false,
      }]), { headers: { 'Content-Type': 'application/json' } })
    }
    const pagesUpstream = (input: RequestInfo | URL, init?: RequestInit) => {
      const mocked = upstashAnswer(input, init)
      if (mocked) return mocked
      return new Response(JSON.stringify([{ index: 0, url: `${API_ORIGIN}/api/v1/manga/page/page-1` }]), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.test')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-secret')

    vi.stubGlobal('fetch', vi.fn(streamsUpstream))
    const automated = await verifiedSession(HEADLESS_ATTESTATION)
    const blockedStreams = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/test/streams/episode?server_id=1', automated))
    expect(blockedStreams.status).toBe(403)
    expect(blockedStreams.headers.get('x-anisource-error-kind')).toBe('automation')
    expect(await blockedStreams.json()).toEqual({ detail: expect.stringContaining('Automated browsing') })

    vi.stubGlobal('fetch', vi.fn(pagesUpstream))
    const blockedPages = await handleAniSourceRequest(request('/api/anisource/api/v1/manga/test/pages/chapter-1', automated))
    expect(blockedPages.status).toBe(403)
    expect(blockedPages.headers.get('x-anisource-error-kind')).toBe('automation')

    // Discovery and metadata keep working: the ban ends playback, not browsing.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const mocked = upstashAnswer(input, init)
      if (mocked) return mocked
      return new Response(JSON.stringify({
        sources: [{ id: 'test', name: 'Test Source', base_url: 'https://source.test' }],
        count: 1,
      }), { headers: { 'Content-Type': 'application/json' } })
    }))
    // Production rate limiting keys off the platform forwarding header,
    // which Vercel always sets; without it the gateway fails closed.
    const forwarded = new Request(`${APP_ORIGIN}/api/anisource/api/v1/anime/sources`, {
      headers: {
        Origin: APP_ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
        Cookie: automated,
        'X-Vercel-Forwarded-For': '203.0.113.7',
      },
    })
    const sources = await handleAniSourceRequest(forwarded)
    expect(sources.status).toBe(200)

    // Development never enforces the ban, so headless e2e keeps covering
    // these flows and attackers gain nothing by reaching non-production.
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubGlobal('fetch', vi.fn(streamsUpstream))
    const devAutomated = await verifiedSession(HEADLESS_ATTESTATION)
    const allowed = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/test/streams/episode?server_id=1', devAutomated))
    expect(allowed.status).toBe(200)
  })

  it('bans forged stacks at media resolution in production', async () => {
    const streamsUpstream = (input: RequestInfo | URL, init?: RequestInit) => {
      const mocked = upstashAnswer(input, init)
      if (mocked) return mocked
      return new Response(JSON.stringify([{
        url: `${API_ORIGIN}/api/v1/proxy/hls/master`,
        quality: 'Auto',
        is_hls: true,
        is_audio: false,
      }]), { headers: { 'Content-Type': 'application/json' } })
    }
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.test')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-secret')
    vi.stubGlobal('fetch', vi.fn(streamsUpstream))

    const forgedRequest = (userAgent: string | null, headers: Record<string, string> = {}) => new Request(
      `${APP_ORIGIN}/api/anisource/api/v1/anime/test/streams/episode?server_id=1`,
      {
        headers: {
          Origin: APP_ORIGIN,
          ...(userAgent === null ? {} : { 'User-Agent': userAgent }),
          'X-Vercel-Forwarded-For': '203.0.113.7',
          ...headers,
        },
      },
    )
    const clean = asProdCookie(await verifiedSession(CLEAN_ATTESTATION, '203.0.113.7'))

    // curl-style automation stack: known UA, no fetch metadata (3 + 2).
    const automation = await handleAniSourceRequest(forgedRequest('curl/8.0', { Cookie: clean }))
    expect(automation.status).toBe(403)
    expect(automation.headers.get('x-anisource-error-kind')).toBe('automation')

    // Forged Chrome without its header set: hints and fetch metadata missing.
    const forged = await handleAniSourceRequest(forgedRequest(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      { Cookie: clean },
    ))
    expect(forged.status).toBe(403)
    expect(forged.headers.get('x-anisource-error-kind')).toBe('automation')

    // Safari omitting fetch metadata scores below the bar: priced, never banned.
    const safari = await handleAniSourceRequest(forgedRequest(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
      { Cookie: clean },
    ))
    expect(safari.status).toBe(200)

    // A real Firefox stack passes outright.
    const firefox = await handleAniSourceRequest(forgedRequest(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
      {
        Cookie: clean,
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
      },
    ))
    expect(firefox.status).toBe(200)
  })

  it('pre-burns the challenge budget after a suspicious exchange', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.test')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-secret')
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const mocked = upstashAnswer(input, init)
      if (mocked) return mocked
      throw new Error(`Unexpected upstream fetch: ${input.toString()}`)
    })
    vi.stubGlobal('fetch', upstreamFetch)

    await handleAniSourceRequest(new Request(`${APP_ORIGIN}/api/anisource/session`, {
      method: 'POST',
      headers: { Origin: APP_ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
      body: JSON.stringify(await solvedExchangeBody(HEADLESS_ATTESTATION)),
    }))
    const escalated = await handleAniSourceRequest(request('/api/anisource/challenge'))
    expect(escalated.status).toBe(200)
    const difficulty = z.object({ difficulty: z.number() }).parse(await escalated.json()).difficulty
    // The suspicious exchange pre-burns 30 issuance hits; the next challenge
    // lands past the +4-bit tier (base 6 in tests).
    expect(difficulty).toBe(10)
  })

  it('exempts health checks from sessions but still binds media tickets to them', async () => {
    const upstreamFetch = vi.fn(async () => new Response(JSON.stringify({
      status: 'ok',
      version: 'test',
      uptime_seconds: 1,
      memory_usage_mb: 1,
      active_sources: 1,
      cache_stats: {},
    }), { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', upstreamFetch)

    const health = await handleAniSourceRequest(request('/api/anisource/health', undefined, APP_ORIGIN))
    expect(health.status).toBe(200)

    const sessionless = await handleAniSourceRequest(request('/api/anisource/asset/garbage', undefined, APP_ORIGIN))
    expect(sessionless.status).toBe(401)
    expect(sessionless.headers.get('x-anisource-error-kind')).toBe('session-required')

    const cookie = await verifiedSession()
    const ticket = await handleAniSourceRequest(request('/api/anisource/asset/garbage', cookie, APP_ORIGIN))
    expect(ticket.status).toBe(403)
  })

  it('does not follow upstream redirects and keeps the initial session on errors', async () => {
    const upstreamFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, {
      status: 302,
      headers: { Location: 'https://attacker.test/collect' },
    }))
    vi.stubGlobal('fetch', upstreamFetch)

    const cookie = await verifiedSession()
    const response = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/sources', cookie))

    expect(response.status).toBe(502)
    // The presented session stays anonymous: no new cookie is minted for it.
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(upstreamFetch).toHaveBeenCalledOnce()
    expect(upstreamFetch.mock.calls[0]![1]?.redirect).toBe('manual')
  })

  it('does not serve an upstream HTML error page from an API endpoint', async () => {
    const upstreamFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(
      '<script>document.body.textContent="injected"</script>',
      { headers: { 'Content-Type': 'text/html' } },
    ))
    vi.stubGlobal('fetch', upstreamFetch)

    const cookie = await verifiedSession()
    const response = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/sources', cookie))

    expect(response.status).toBe(502)
    expect(response.headers.get('x-anisource-error-kind')).toBe('invalid')
    expect(await response.text()).not.toContain('<script>')
  })

  it('propagates client cancellation to the upstream request', async () => {
    const controller = new AbortController()
    const upstreamFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) throw new Error('The gateway must pass an abort signal upstream.')
        if (signal.aborted) {
          reject(signal.reason)
          return
        }
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
    )
    vi.stubGlobal('fetch', upstreamFetch)

    const cookie = await verifiedSession()
    const pending = handleAniSourceRequest(new Request(`${APP_ORIGIN}/api/anisource/api/v1/anime/sources`, {
      headers: {
        Origin: APP_ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
        Cookie: cookie,
      },
      signal: controller.signal,
    }))
    await vi.waitFor(() => expect(upstreamFetch).toHaveBeenCalledOnce())
    controller.abort()
    const response = await pending

    expect(response.status).toBe(499)
    expect(response.headers.get('x-anisource-error-kind')).toBe('cancelled')
    expect(upstreamFetch.mock.calls[0]![1]?.signal?.aborted).toBe(true)
  })

  it('fails closed in production when the shared rate limiter is missing', async () => {
    const cookie = asProdCookie(await verifiedSession())
    vi.stubEnv('NODE_ENV', 'production')
    const upstreamFetch = vi.fn()
    vi.stubGlobal('fetch', upstreamFetch)

    const response = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/sources', cookie))

    expect(response.status).toBe(503)
    expect(response.headers.get('x-anisource-error-kind')).toBe('misconfigured')
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('fails closed instead of sending the Redis token to an insecure limiter URL', async () => {
    const cookie = asProdCookie(await verifiedSession())
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'http://redis.test')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-secret')
    const upstreamFetch = vi.fn()
    vi.stubGlobal('fetch', upstreamFetch)

    const response = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/sources', cookie))

    expect(response.status).toBe(503)
    expect(response.headers.get('x-anisource-error-kind')).toBe('misconfigured')
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('marks gateway rejections with error kinds instead of generic failures', async () => {
    const upstreamFetch = vi.fn()
    vi.stubGlobal('fetch', upstreamFetch)

    const indistinguishable = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/sources', undefined, 'https://evil.test'))
    expect(indistinguishable.status).toBe(404)
    expect(indistinguishable.headers.get('x-anisource-error-kind')).toBe('invalid')
    expect(await indistinguishable.json()).toEqual({ detail: 'AniSource route not found.' })
    expect(upstreamFetch).not.toHaveBeenCalled()

    const cookie = asProdCookie(await verifiedSession())
    vi.stubEnv('NODE_ENV', 'production')
    const misconfigured = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/sources', cookie))
    expect(misconfigured.status).toBe(503)
    expect(misconfigured.headers.get('x-anisource-error-kind')).toBe('misconfigured')
  })

  it('translates an upstream 401 on service-authenticated catalog into a misconfigured outage', async () => {
    const upstreamFetch = vi.fn(async () => new Response(JSON.stringify({ detail: 'Authentication required.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', upstreamFetch)

    const cookie = await verifiedSession()
    const response = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/test/streams/episode?server_id=1', cookie))

    expect(response.status).toBe(503)
    expect(response.headers.get('x-anisource-error-kind')).toBe('misconfigured')
    await expect(response.json()).resolves.toMatchObject({ detail: expect.stringContaining('ANISOURCE_SERVICE_TOKEN') })
  })

  it('serves session-bound media without paying the distributed limiter round trips', async () => {
    const ticketPath = '/api/v1/proxy/hls/master-token'
    let upstashCalls = 0
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = input instanceof Request ? input.url : input.toString()
      if (target.startsWith('https://upstash.test')) {
        // Count only the sliding-window limiter scripts: abuse telemetry
        // (including the asset-ticket standing-denial read) uses plain
        // commands on the same host, which this test does not budget.
        // Media bytes must never pay limiter Lua round trips.
        let limiter = false
        try {
          const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
          const entries = Array.isArray(body) && body.every((entry) => Array.isArray(entry)) ? body : [body]
          limiter = entries.some((entry) => Array.isArray(entry) && typeof entry[0] === 'string' && entry[0].toLowerCase().startsWith('eval'))
        } catch {
          limiter = false
        }
        if (limiter) upstashCalls += 1
        return new Response(JSON.stringify([{ result: [1, 240, 239, 9_999_999_999_999] }]), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (new URL(target).pathname.includes('/streams/')) {
        return new Response(JSON.stringify([{
          url: `${API_ORIGIN}${ticketPath}`,
          quality: 'Auto',
          is_hls: true,
          is_audio: false,
        }]), { headers: { 'Content-Type': 'application/json' } })
      }
      if (new URL(target).pathname.endsWith('/anime/sources')) {
        return new Response(JSON.stringify({
          sources: [{ id: 'test', name: 'Test Source', base_url: 'https://source.test' }],
          count: 1,
        }), { headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('#EXTM3U\n#EXTINF:4,\nsegment', {
        headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
      })
    })
    vi.stubGlobal('fetch', upstreamFetch)

    const cookie = await verifiedSession()
    const catalog = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/test/streams/episode?server_id=1', cookie))
    const ticket = await ticketUrl(catalog)

    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.test')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-secret')

    const media = await handleAniSourceRequest(request(new URL(ticket, APP_ORIGIN).pathname, cookie))
    expect(media.status).toBe(200)
    expect(await media.text()).toContain('segment')
    expect(upstashCalls).toBe(0)

    const catalogAfter = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/sources', cookie))
    expect(catalogAfter.status).toBe(200)
    expect(upstashCalls).toBeGreaterThan(0)
  })

  it('rewrites every HLS URI shape the API emits into session tickets', async () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080',
      `${API_ORIGIN}/api/v1/proxy/hls/variant-1080?sig=a`,
      '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720',
      '/api/v1/proxy/hls/variant-720?sig=b',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360',
      'https://cdn.example/hls/variant-360',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="en",URI="https://api.test/api/v1/proxy/hls/audio-en"',
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="https://api.test/api/v1/proxy/hls/sub-en.vtt"',
      '#EXT-X-SESSION-DATA:DATA-ID="com.example",URI="https://api.test/api/v1/proxy/hls/session-meta"',
      '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="https://api.test/api/v1/proxy/hls/session-key",IV=0x1',
    ].join('\n')
    const variant = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:4',
      '#EXT-X-KEY:METHOD=AES-128,URI="https://api.test/api/v1/proxy/hls/key1",IV=0x9c7db312',
      '#EXT-X-MAP:URI="https://api.test/api/v1/proxy/hls/init?sig=c"',
      '# A comment line is not a URL and must survive untouched',
      '#EXTINF:4,',
      'https://api.test/api/v1/proxy/hls/seg-1?sig=d',
      '#EXTINF:4,',
      'https://api.test/api/v1/proxy/hls/seg-2?sig=e',
      '#EXT-X-ENDLIST',
    ].join('\n')
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL) => {
      const target = new URL(input instanceof Request ? input.url : input.toString())
      if (target.pathname.includes('/streams/')) {
        return new Response(JSON.stringify([{
          url: `${API_ORIGIN}/api/v1/proxy/hls/master`,
          quality: 'Auto',
          is_hls: true,
          is_audio: false,
        }]), { headers: { 'Content-Type': 'application/json' } })
      }
      if (target.pathname.endsWith('/variant-1080')) {
        return new Response(variant, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } })
      }
      if (target.pathname.endsWith('/key1')) {
        return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'Content-Type': 'application/octet-stream' } })
      }
      return new Response(master, { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } })
    })
    vi.stubGlobal('fetch', upstreamFetch)

    const cookie = await verifiedSession()
    const catalog = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/test/streams/episode?server_id=1', cookie))
    const masterTicket = await ticketUrl(catalog)

    const masterResponse = await handleAniSourceRequest(request(new URL(masterTicket, APP_ORIGIN).pathname, cookie))
    const rewrittenMaster = await masterResponse.text()
    expect(masterResponse.status).toBe(200)
    expect(rewrittenMaster).not.toContain(API_ORIGIN)
    expect(rewrittenMaster).toContain('URI="/api/anisource/asset/')
    expect(rewrittenMaster).toContain('\n/api/anisource/asset/')
    expect(rewrittenMaster).toContain('https://cdn.example/hls/variant-360')
    expect(rewrittenMaster).toContain('#EXTM3U')

    const variantTicket = rewrittenMaster.match(/\/api\/anisource\/asset\/[A-Za-z0-9_.-]+/)?.[0]
    if (!variantTicket) throw new Error('Expected the variant playlist to be rewritten to an asset ticket.')
    const variantResponse = await handleAniSourceRequest(request(variantTicket, cookie))
    const rewrittenVariant = await variantResponse.text()
    expect(variantResponse.status).toBe(200)
    expect(rewrittenVariant).not.toContain(API_ORIGIN)
    expect(rewrittenVariant).toContain('URI="/api/anisource/asset/')
    expect(rewrittenVariant).toContain('\n/api/anisource/asset/')
    expect(rewrittenVariant).toContain('# A comment line is not a URL and must survive untouched')
    expect(rewrittenVariant).toContain('#EXT-X-ENDLIST')

    const keyTicket = rewrittenVariant.match(/URI="(\/api\/anisource\/asset\/[A-Za-z0-9_.-]+)"/)?.[1]
    if (!keyTicket) throw new Error('Expected the encryption key URI to be rewritten to an asset ticket.')
    const keyResponse = await handleAniSourceRequest(request(keyTicket, cookie))
    expect(keyResponse.status).toBe(200)
    expect([...new Uint8Array(await keyResponse.arrayBuffer())]).toEqual([1, 2, 3, 4])
  })

  it('rejects fallback selection when no fallback origin is configured', async () => {
    vi.stubEnv('ANISOURCE_FALLBACK_BASE', '')
    const upstreamFetch = vi.fn()
    vi.stubGlobal('fetch', upstreamFetch)

    const response = await handleAniSourceRequest(request('/api/anisource/fallback/api/v1/anime/sources'))

    expect(response.status).toBe(503)
    expect(response.headers.get('x-anisource-error-kind')).toBe('misconfigured')
    await expect(response.json()).resolves.toMatchObject({ detail: expect.stringContaining('fallback') })
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('serves catalog through the fallback origin and binds its tickets to it', async () => {
    const renderOrigin = 'https://render.test'
    vi.stubEnv('ANISOURCE_FALLBACK_BASE', renderOrigin)
    const upstreamHosts: string[] = []
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL) => {
      const target = new URL(input instanceof Request ? input.url : input.toString())
      upstreamHosts.push(target.host)
      if (target.pathname.includes('/streams/')) {
        return new Response(JSON.stringify([{
          url: `https://${target.host}/api/v1/proxy/hls/master`,
          quality: 'Auto',
          is_hls: true,
          is_audio: false,
        }]), { headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(`#EXTM3U\n#EXTINF:4,\nhttps://${target.host}/api/v1/proxy/hls/seg`, {
        headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
      })
    })
    vi.stubGlobal('fetch', upstreamFetch)

    const cookie = await verifiedSession()
    const fallbackCatalog = await handleAniSourceRequest(request('/api/anisource/fallback/api/v1/anime/test/streams/episode?server_id=1', cookie))
    expect(fallbackCatalog.status).toBe(200)
    const fallbackTicket = await ticketUrl(fallbackCatalog)

    const primaryCatalog = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/test/streams/episode?server_id=1', cookie))
    expect(primaryCatalog.status).toBe(200)
    const primaryTicket = await ticketUrl(primaryCatalog)

    expect(upstreamHosts).toContain('render.test')
    expect(upstreamHosts).toContain(new URL(API_ORIGIN).host)

    const fallbackMedia = await handleAniSourceRequest(request(new URL(fallbackTicket, APP_ORIGIN).pathname, cookie))
    const fallbackManifest = await fallbackMedia.text()
    expect(fallbackMedia.status).toBe(200)
    expect(fallbackManifest).not.toContain('render.test')
    expect(fallbackManifest).not.toContain(new URL(API_ORIGIN).host)

    const fallbackSegment = fallbackManifest.match(/\/api\/anisource\/asset\/[A-Za-z0-9_.-]+/)?.[0]
    if (!fallbackSegment) throw new Error('Expected the fallback segment to be rewritten to an asset ticket.')
    const upstreamBefore = upstreamHosts.length
    const segment = await handleAniSourceRequest(request(fallbackSegment, cookie))
    expect(segment.status).toBe(200)
    expect(upstreamHosts.slice(upstreamBefore)).toEqual(['render.test'])

    const primaryMedia = await handleAniSourceRequest(request(new URL(primaryTicket, APP_ORIGIN).pathname, cookie))
    expect(primaryMedia.status).toBe(200)
    expect(upstreamHosts[upstreamHosts.length - 1]).toBe(new URL(API_ORIGIN).host)
  })

  it('refuses internal-pivot server identifiers without contacting upstream', async () => {
    const toBase64Url = (text: string): string => Buffer.from(text, 'utf8').toString('base64url')
    const legitEmbed = toBase64Url(JSON.stringify({ name: 'CatStream', src: 'https://embed.test/play?id=1&type=hls&source=catstream' }))
    const loopbackEmbed = toBase64Url(JSON.stringify({ name: 'CatStream', src: 'http://127.0.0.1:8080/admin' }))
    const metadataEmbed = toBase64Url(JSON.stringify({ name: 'CatStream', src: 'http://169.254.169.254/latest/meta-data/' }))
    const decimalEmbed = toBase64Url(JSON.stringify({ name: 'CatStream', src: 'https://2130706433/cat-player/player' }))
    const shortEmbed = toBase64Url(JSON.stringify({ name: 'CatStream', src: 'https://127.1/cat-player/player' }))
    const v6Embed = toBase64Url(JSON.stringify({ name: 'CatStream', src: 'https://[fd00::1]/cat-player/player' }))
    const cases: Array<{ id: string; allowed: boolean }> = [
      { id: '1', allowed: true },
      { id: 'server-1', allowed: true },
      { id: legitEmbed, allowed: true },
      { id: 'https://93.184.216.34/cat-player/player', allowed: true },
      { id: 'http://127.0.0.1:8080/admin', allowed: false },
      { id: 'http://10.0.0.5/collect', allowed: false },
      // Parser-normalized numerics: decimal, short, and hex IPv4 forms.
      { id: 'https://2130706433/cat-player/player', allowed: false },
      { id: 'https://127.1/cat-player/player', allowed: false },
      { id: 'https://0x7f.0.0.1/cat-player/player', allowed: false },
      { id: 'https://[fd00::1]/cat-player/player', allowed: false },
      { id: 'https://[::1]/cat-player/player', allowed: false },
      { id: 'file:///etc/passwd', allowed: false },
      { id: 'gopher://127.0.0.1:70/x', allowed: false },
      { id: loopbackEmbed, allowed: false },
      { id: metadataEmbed, allowed: false },
      { id: decimalEmbed, allowed: false },
      { id: shortEmbed, allowed: false },
      { id: v6Embed, allowed: false },
      { id: 'has space', allowed: true },
      { id: 'back\\slash', allowed: false },
      { id: 'bell', allowed: false },
    ]
    for (const { id, allowed } of cases) {
      const upstreamFetch = vi.fn(async () => new Response(JSON.stringify([{
        url: `${API_ORIGIN}/api/v1/proxy/hls/master`,
        quality: 'Auto',
        is_hls: true,
        is_audio: false,
      }]), { headers: { 'Content-Type': 'application/json' } }))
      vi.stubGlobal('fetch', upstreamFetch)
      const cookie = await verifiedSession()
      const response = await handleAniSourceRequest(request(
        `/api/anisource/api/v1/anime/test/streams/episode?server_id=${encodeURIComponent(id)}`,
        cookie,
      ))
      if (allowed) {
        expect(response.status, `server_id ${id.slice(0, 24)} should resolve`).toBe(200)
        expect(upstreamFetch).toHaveBeenCalledOnce()
      } else {
        expect(response.status, `server_id ${id.slice(0, 24)} should hide`).toBe(404)
        expect(response.headers.get('x-anisource-error-kind')).toBe('invalid')
        expect(upstreamFetch).not.toHaveBeenCalled()
      }
    }
  })

  it('requires a current attestation version and week at exchange', async () => {
    async function exchangeWith(attestation: PowAttestation): Promise<Response> {
      const challengeRes = await handleAniSourceRequest(request('/api/anisource/challenge'))
      expect(challengeRes.status).toBe(200)
      const { challenge, difficulty } = z
        .object({ challenge: z.string(), difficulty: z.number(), expiresIn: z.number() })
        .parse(await challengeRes.json())
      const id = challenge.split('.')[0]
      if (!id) throw new Error('Expected the challenge to carry an id.')
      const { nonce } = await solvePowChallenge(id, difficulty, { binding: attestationDigest(attestation) })
      return handleAniSourceRequest(new Request(`${APP_ORIGIN}/api/anisource/session`, {
        method: 'POST',
        headers: { Origin: APP_ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge, solution: { nonce }, attestation }),
      }))
    }
    const upstreamFetch = vi.fn()
    vi.stubGlobal('fetch', upstreamFetch)

    // Solved with a matching binding, so proof-of-work passes and freshness
    // is what answers: stale version and stale week reload, missing is malformed.
    const staleVersion = await exchangeWith({ ...CLEAN_ATTESTATION, av: 999 })
    expect(staleVersion.status).toBe(426)
    const staleWeek = await exchangeWith({ ...CLEAN_ATTESTATION, cw: '2020W01' })
    expect(staleWeek.status).toBe(426)
    const missingWeek = await exchangeWith({ ...CLEAN_ATTESTATION, cw: null as unknown as string })
    expect(missingWeek.status).toBe(400)
    const missingVersion = await exchangeWith({ ...CLEAN_ATTESTATION, av: null as unknown as number })
    expect(missingVersion.status).toBe(400)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('binds media resolution to the issuing network while metadata roams', async () => {
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL) => {
      const target = new URL(input instanceof Request ? input.url : input.toString())
      if (target.pathname.includes('/streams/')) {
        return new Response(JSON.stringify([{
          url: `${API_ORIGIN}/api/v1/proxy/hls/master`,
          quality: 'Auto',
          is_hls: true,
          is_audio: false,
        }]), { headers: { 'Content-Type': 'application/json' } })
      }
      if (target.pathname.endsWith('/sources')) {
        return new Response(JSON.stringify({
          sources: [{ id: 'test', name: 'Test Source', base_url: 'https://source.test' }],
          count: 1,
        }), { headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'video/mp4' } })
    })
    vi.stubGlobal('fetch', upstreamFetch)
    const drifted = (path: string, cookie: string): Request => new Request(`${APP_ORIGIN}${path}`, {
      headers: {
        Origin: APP_ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
        Cookie: cookie,
        'X-Forwarded-For': '9.9.9.9',
      },
    })

    const cookie = await verifiedSession()
    const homeStreams = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/test/streams/episode?server_id=1', cookie))
    expect(homeStreams.status).toBe(200)
    const ticket = await ticketUrl(homeStreams)

    // Same session from another network: media re-verifies, metadata roams.
    const awayStreams = await handleAniSourceRequest(drifted('/api/anisource/api/v1/anime/test/streams/episode?server_id=1', cookie))
    expect(awayStreams.status).toBe(401)
    expect(awayStreams.headers.get('x-anisource-error-kind')).toBe('session-required')
    const awayTicket = await handleAniSourceRequest(drifted(new URL(ticket, APP_ORIGIN).pathname, cookie))
    expect(awayTicket.status).toBe(401)
    expect(awayTicket.headers.get('x-anisource-error-kind')).toBe('session-required')
    const awaySources = await handleAniSourceRequest(drifted('/api/anisource/api/v1/anime/sources', cookie))
    expect(awaySources.status).toBe(200)
  })

  it('revokes outstanding media tickets the moment the session is banned', async () => {
    const { createHash } = await import('node:crypto')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.test')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-secret')
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const mocked = upstashAnswer(input, init)
      if (mocked) return mocked
      const target = new URL(input instanceof Request ? input.url : input.toString())
      if (target.pathname.includes('/streams/')) {
        return new Response(JSON.stringify([{
          url: `${API_ORIGIN}/api/v1/proxy/hls/master`,
          quality: 'Auto',
          is_hls: true,
          is_audio: false,
        }]), { headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'video/mp4' } })
    })
    vi.stubGlobal('fetch', upstreamFetch)

    const cookie = await verifiedSession()
    const catalog = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/test/streams/episode?server_id=1', cookie))
    expect(catalog.status).toBe(200)
    const ticket = await ticketUrl(catalog)
    const ticketPath = new URL(ticket, APP_ORIGIN).pathname
    const live = await handleAniSourceRequest(request(ticketPath, cookie))
    expect(live.status).toBe(200)

    const payload = JSON.parse(Buffer.from(cookie.split('=')[1]!.split('.')[0]!, 'base64url').toString('utf8')) as { sid: string }
    const fingerprint = createHash('sha256').update(`abuse-session-v1:${payload.sid}`).digest('hex')
    upstashKv.set(`abuse:denied:sid:${fingerprint}`, 'velocity')
    const upstreamHost = (input: RequestInfo | URL): string =>
      new URL(input instanceof Request ? input.url : input.toString()).host
    const upstreamCalls = upstreamFetch.mock.calls.filter(([input]) => upstreamHost(input) !== 'upstash.test').length

    const bannedCatalog = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/sources', cookie))
    expect(bannedCatalog.status).toBe(429)
    // Previously served until ticket expiry; now denied without touching upstream.
    const bannedTicket = await handleAniSourceRequest(request(ticketPath, cookie))
    expect(bannedTicket.status).toBe(429)
    expect(bannedTicket.headers.get('x-anisource-error-kind')).toBe('rate-limited')
    expect(upstreamFetch.mock.calls.filter(([input]) => upstreamHost(input) !== 'upstash.test').length).toBe(upstreamCalls)
  })

  it('paces media resolution per session: bulk resolves trip, metadata does not', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.test')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-secret')
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const mocked = upstashAnswer(input, init)
      if (mocked) return mocked
      const target = new URL(input instanceof Request ? input.url : input.toString())
      if (target.pathname.includes('/streams/')) {
        return new Response(JSON.stringify([{
          url: `${API_ORIGIN}/api/v1/proxy/hls/master`,
          quality: 'Auto',
          is_hls: true,
          is_audio: false,
        }]), { headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        sources: [{ id: 'test', name: 'Test Source', base_url: 'https://source.test' }],
        count: 1,
      }), { headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', upstreamFetch)

    const cookie = await verifiedSession()
    // One resolve serves a whole Episode: 30 per 10 minutes is already
    // far past human pacing, and the 31st trips the session ban.
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/test/streams/episode?server_id=1', cookie))
      expect(response.status).toBe(200)
    }
    const tripped = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/test/streams/episode?server_id=1', cookie))
    expect(tripped.status).toBe(429)
    expect(tripped.headers.get('x-anisource-error-kind')).toBe('rate-limited')
    expect(tripped.headers.get('Retry-After')).toBe('1800')
  })

  it('ticket-mode asset fetches authenticate upstream and preserve signed queries', async () => {
    const seen: Array<{ url: URL; auth: string | null }> = []
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = new URL(input instanceof Request ? input.url : input.toString())
      seen.push({ url: target, auth: new Headers(init?.headers).get('Authorization') })
      if (target.pathname.includes('/streams/')) {
        return new Response(JSON.stringify([{
          url: `${API_ORIGIN}/api/v1/proxy/hls/master?sig=orig`,
          quality: 'Auto',
          is_hls: true,
          is_audio: false,
        }]), { headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'video/mp4' } })
    })
    vi.stubGlobal('fetch', upstreamFetch)

    const cookie = await verifiedSession()
    const catalog = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/test/streams/episode?server_id=1', cookie))
    expect(catalog.status).toBe(200)
    const ticket = await ticketUrl(catalog)
    // Tickets carry no browser-redeemable grant: decoding one must yield the
    // upstream path and original query only, never an API capability.
    const ticketPayload = JSON.parse(
      Buffer.from(ticket.split('/').at(-1)!.split('.')[0]!, 'base64url').toString('utf8'),
    ) as { q: string }
    expect(ticketPayload.q).toBe('?sig=orig')
    expect(ticketPayload.q).not.toContain('cap=')
    const media = await handleAniSourceRequest(request(new URL(ticket, APP_ORIGIN).pathname, cookie))
    expect(media.status).toBe(200)

    const mediaUpstream = seen.find(({ url }) => url.pathname.includes('/proxy/hls/master'))
    if (!mediaUpstream) throw new Error('Expected the asset ticket to fetch upstream media.')
    // The capability is minted server-side at fetch time: the preserved
    // upstream signature survives, the fresh session capability joins it,
    // and the service credential authenticates the server call.
    expect(mediaUpstream.url.searchParams.get('sig')).toBe('orig')
    expect(mediaUpstream.url.searchParams.get('cap')).toMatch(/^v1\./)
    expect(mediaUpstream.auth).toBe(`Bearer ${SERVICE_TOKEN}`)
  })
})
