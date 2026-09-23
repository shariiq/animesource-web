// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { handleAniSourceRequest } from '../app/data/anisource/proxy.server'

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

function sessionCookie(response: Response): string {
  const cookie = response.headers.get('set-cookie')
  if (!cookie) throw new Error('Expected the gateway to create a session cookie.')
  return cookie.split(';', 1)[0]!
}

function ticketUrl(response: Response): Promise<string> {
  return response.json().then((body: unknown) =>
    z.array(z.object({ url: z.string() })).parse(body)[0]!.url,
  )
}

describe('AniSource server boundary', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('ANISOURCE_BASE', API_ORIGIN)
    vi.stubEnv('ANISOURCE_SERVICE_TOKEN', SERVICE_TOKEN)
    vi.stubEnv('ANISOURCE_SESSION_SECRET', 'session-secret-'.padEnd(48, 's'))
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
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

    const catalog = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/test/streams/episode?server_id=1'))
    const cookie = sessionCookie(catalog)
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
    expect(new Headers(upstreamFetch.mock.calls[1]![1]?.headers).has('Authorization')).toBe(false)

    const foreignSession = await handleAniSourceRequest(request(new URL(streamUrl, APP_ORIGIN).pathname))
    expect(foreignSession.status).toBe(403)
    expect(upstreamFetch).toHaveBeenCalledTimes(2)
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

    const pages = await handleAniSourceRequest(request('/api/anisource/api/v1/manga/test/pages/chapter'))
    const cookie = sessionCookie(pages)
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
    expect(new Headers(upstreamFetch.mock.calls[1]![1]?.headers).has('Authorization')).toBe(false)
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

    const response = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/source%2Fid/search?q=title&page=1'))
    const malformedRoute = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/test/streams/episode'))

    expect(response.status).toBe(502)
    expect(response.headers.get('x-anisource-error-kind')).toBe('invalid')
    expect(new URL(upstreamFetch.mock.calls[0]![0].toString()).pathname).toContain('/source%2Fid/search')
    expect(malformedRoute.status).toBe(404)
    expect(upstreamFetch).toHaveBeenCalledOnce()
  })

  it('rejects cross-origin and non-allowlisted requests before contacting AniSource', async () => {
    const upstreamFetch = vi.fn()
    vi.stubGlobal('fetch', upstreamFetch)

    const crossOrigin = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/sources', undefined, 'https://evil.test'))
    const arbitraryPath = await handleAniSourceRequest(request('/api/anisource/https://evil.test/secret'))

    expect(crossOrigin.status).toBe(403)
    expect(arbitraryPath.status).toBe(404)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('does not follow upstream redirects and keeps the initial session on errors', async () => {
    const upstreamFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, {
      status: 302,
      headers: { Location: 'https://attacker.test/collect' },
    }))
    vi.stubGlobal('fetch', upstreamFetch)

    const response = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/sources'))

    expect(response.status).toBe(502)
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(upstreamFetch).toHaveBeenCalledOnce()
    expect(upstreamFetch.mock.calls[0]![1]?.redirect).toBe('manual')
  })

  it('does not serve an upstream HTML error page from an API endpoint', async () => {
    const upstreamFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(
      '<script>document.body.textContent="injected"</script>',
      { headers: { 'Content-Type': 'text/html' } },
    ))
    vi.stubGlobal('fetch', upstreamFetch)

    const response = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/sources'))

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

    const pending = handleAniSourceRequest(new Request(`${APP_ORIGIN}/api/anisource/api/v1/anime/sources`, {
      headers: { Origin: APP_ORIGIN, 'Sec-Fetch-Site': 'same-origin' },
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
    vi.stubEnv('NODE_ENV', 'production')
    const upstreamFetch = vi.fn()
    vi.stubGlobal('fetch', upstreamFetch)

    const response = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/sources'))

    expect(response.status).toBe(503)
    expect(response.headers.get('set-cookie')).toContain('Secure')
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('fails closed instead of sending the Redis token to an insecure limiter URL', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'http://redis.test')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-secret')
    const upstreamFetch = vi.fn()
    vi.stubGlobal('fetch', upstreamFetch)

    const response = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/sources'))

    expect(response.status).toBe(503)
    expect(response.headers.get('set-cookie')).toContain('Secure')
    expect(upstreamFetch).not.toHaveBeenCalled()
  })
})
