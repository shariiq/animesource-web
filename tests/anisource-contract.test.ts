// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAniSourceClient } from '../app/data/anisource/client'
import { handleAniSourceRequest } from '../app/data/anisource/proxy.server'
import { REQUEST_NONCE_HEADER, issueRequestNonce } from '../app/lib/requestNonce'

const APP_ORIGIN = 'https://app.test'
const API_ORIGIN = 'https://api.test'
const SERVICE_TOKEN = 'test-service-token-'.padEnd(48, 'x')

/**
 * Every path the browser client can build must be served (not 404) by the
 * same-origin gateway, with media URLs rewritten to session tickets. This
 * pins the client/gateway route contract so adding a client method without
 * gateway allowlist support fails here, not in a watch or reader session.
 */
describe('AniSource client/gateway route contract', () => {
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

  it('serves every client-built catalog path and tickets every media URL it returns', async () => {
    const ok = (body: unknown) => new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json' },
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const target = new URL(input instanceof Request ? input.url : input.toString())
      if (target.pathname === '/health') {
        return ok({
          status: 'ok',
          version: 'test',
          uptime_seconds: 1,
          memory_usage_mb: 1,
          active_sources: 0,
          cache_stats: {},
        })
      }
      if (target.pathname.endsWith('/sources')) {
        return ok({
          sources: [{ id: 'test', name: 'Test Source', base_url: 'https://source.test' }],
          count: 1,
        })
      }
      if (target.pathname.includes('/search')) {
        return ok({
          items: [{ id: 'found-1', title: 'Found', url: 'https://source.test/found-1' }],
          page: 1,
          has_next: false,
          total_returned: 1,
        })
      }
      if (target.pathname.includes('/manga/test/manga/')) {
        return ok({ id: 'manga-1', title: 'Found', url: 'https://source.test/manga-1' })
      }
      if (target.pathname.includes('/chapters/')) {
        return ok([{ id: 'chapter-1', title: 'First', url: 'https://source.test/chapter-1', number: 1 }])
      }
      if (target.pathname.includes('/pages/')) {
        return ok([{ index: 0, url: `${API_ORIGIN}/api/v1/manga/page/page-1`, page_url: 'https://source.test/p1' }])
      }
      if (target.pathname.includes('/episodes/')) {
        return ok([{ id: 'episode-1', number: 1, title: 'Pilot' }])
      }
      if (target.pathname.includes('/servers/')) {
        return ok([{ id: 'server-1', name: 'Primary', type: 'SUB' }])
      }
      if (target.pathname.includes('/streams/')) {
        return ok([{
          url: `${API_ORIGIN}/api/v1/proxy/hls/master`,
          quality: 'Auto',
          is_hls: true,
          is_audio: false,
          subtitles: [{ url: `${API_ORIGIN}/api/v1/proxy/hls/sub-en.vtt`, label: 'English', language: 'en' }],
        }])
      }
      return new Response(JSON.stringify({ detail: 'Not found' }), { status: 404 })
    }))

    const requestedPaths: string[] = []
    // The transport shim plays the browser: it attaches the cookie-derived
    // request nonce exactly as client request encoding does.
    const nonce = issueRequestNonce('session-secret-'.padEnd(48, 's'), Math.floor(Date.now() / 1000))
    const client = createAniSourceClient({
      transport: {
        fetch: async (input: string) => {
          requestedPaths.push(input)
          // The browser only ever talks to the same-origin gateway.
          return handleAniSourceRequest(new Request(`${APP_ORIGIN}${input}`, {
            headers: {
              Origin: APP_ORIGIN,
              'Sec-Fetch-Site': 'same-origin',
              Accept: 'application/json',
              [REQUEST_NONCE_HEADER]: nonce,
            },
          }))
        },
        setTimeout: (callback: () => void) => setTimeout(callback, 0),
        clearTimeout: (timeout: ReturnType<typeof setTimeout>) => clearTimeout(timeout),
      },
    })

    const noop = () => undefined
    // Each call below throws unless the gateway serves the built path with a
    // schema-valid payload, so reaching the assertions proves the contract.
    const health = await client.health(noop)
    const sources = await client.sources(noop)
    const mangaSources = await client.mangaSources(noop)
    const search = await client.search('test', 'Found', 1, noop)
    const mangaSearch = await client.mangaSearch('test', 'Found', 1, noop)
    const manga = await client.mangaDetails('test', 'manga-1', noop)
    const chapters = await client.mangaChapters('test', 'manga-1', noop)
    const pages = await client.mangaPages('test', 'chapter-1', noop)
    const episodes = await client.episodes('test', 'anime-1', noop)
    const servers = await client.servers('test', 'episode-1', noop)
    const streams = await client.streams('test', 'episode-1', 'server-1', noop)

    expect(requestedPaths).toHaveLength(11)
    expect(health.status).toBe('ok')
    expect(sources.count).toBe(1)
    expect(mangaSources.count).toBe(1)
    expect(search.items[0]!.id).toBe('found-1')
    expect(mangaSearch.items[0]!.id).toBe('found-1')
    expect(manga.id).toBe('manga-1')
    expect(chapters).toHaveLength(1)
    expect(episodes).toHaveLength(1)
    expect(servers).toHaveLength(1)

    for (const page of pages) {
      expect(page.url, 'manga page URL must be a gateway ticket').toMatch(/^\/api\/anisource\/asset\//)
    }
    expect(streams[0]!.url, 'stream URL must be a gateway ticket').toMatch(/^\/api\/anisource\/asset\//)
    expect(streams[0]!.subtitles[0]!.url, 'subtitle URL must be a gateway ticket').toMatch(/^\/api\/anisource\/asset\//)
  })
})
