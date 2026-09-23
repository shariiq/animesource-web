// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import apiUrls from '../config/api-urls.json'
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
    vi.stubEnv('ANISOURCE_FALLBACK_BASE', '')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
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

  it('rewrites protocol-relative HLS URLs to session-bound same-origin tickets', async () => {
    const protocolRelativeUrl = `//${new URL(API_ORIGIN).host}/api/v1/proxy/hls/master-token`
    const upstreamFetch = vi.fn(async () => new Response(JSON.stringify([{
      url: protocolRelativeUrl,
      quality: 'Auto',
      is_hls: true,
      is_audio: false,
    }]), { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', upstreamFetch)

    const response = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/test/streams/episode?server_id=1'))
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

    const streams = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/test/streams/episode?server_id=1'))
    const cookie = sessionCookie(streams)
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

    const response = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/kickassanime/search?q=Return&page=1'))

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

    const response = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/kickassanime/search?q=Return&page=1'))

    expect(response.status).toBe(502)
    expect(response.headers.get('x-anisource-error-kind')).toBe('invalid')
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

  it('marks gateway rejections with error kinds instead of generic failures', async () => {
    const upstreamFetch = vi.fn()
    vi.stubGlobal('fetch', upstreamFetch)

    const forbidden = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/sources', undefined, 'https://evil.test'))
    expect(forbidden.status).toBe(403)
    expect(forbidden.headers.get('x-anisource-error-kind')).toBe('forbidden')
    expect(upstreamFetch).not.toHaveBeenCalled()

    vi.stubEnv('NODE_ENV', 'production')
    const misconfigured = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/sources'))
    expect(misconfigured.status).toBe(503)
    expect(misconfigured.headers.get('x-anisource-error-kind')).toBe('misconfigured')
  })

  it('translates an upstream 401 on service-authenticated catalog into a misconfigured outage', async () => {
    const upstreamFetch = vi.fn(async () => new Response(JSON.stringify({ detail: 'Authentication required.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', upstreamFetch)

    const response = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/test/streams/episode?server_id=1'))

    expect(response.status).toBe(503)
    expect(response.headers.get('x-anisource-error-kind')).toBe('misconfigured')
    await expect(response.json()).resolves.toMatchObject({ detail: expect.stringContaining('ANISOURCE_SERVICE_TOKEN') })
  })

  it('serves session-bound media without paying the distributed limiter round trips', async () => {
    const ticketPath = '/api/v1/proxy/hls/master-token'
    let upstashCalls = 0
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL) => {
      const target = input instanceof Request ? input.url : input.toString()
      if (target.startsWith('https://upstash.test')) {
        // A well-formed allow response keeps the limiter on its success path;
        // the assertion below is that media never calls it at all.
        upstashCalls += 1
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

    const catalog = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/test/streams/episode?server_id=1'))
    const cookie = sessionCookie(catalog)
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

    const catalog = await handleAniSourceRequest(request('/api/anisource/api/v1/anime/test/streams/episode?server_id=1'))
    const cookie = sessionCookie(catalog)
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

    const fallbackCatalog = await handleAniSourceRequest(request('/api/anisource/fallback/api/v1/anime/test/streams/episode?server_id=1'))
    expect(fallbackCatalog.status).toBe(200)
    const cookie = sessionCookie(fallbackCatalog)
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
})
