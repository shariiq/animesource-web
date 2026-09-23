import { describe, expect, it, vi } from 'vitest'
import { AniSourceError, ANISOURCE_PROXY_BASE, createAniSourceClient, loadSubtitle, normalizeSubtitleText, resolveUrl } from '../app/data/anisource/client'

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const transport = (fetch: (input: string, init?: RequestInit) => Promise<Response>) => ({
  fetch,
  setTimeout: vi.fn(() => 1 as unknown as ReturnType<typeof setTimeout>),
  clearTimeout: vi.fn(),
})

describe('AniSource client', () => {
  it('keeps the AniSource endpoint out of browser configuration', () => {
    expect(ANISOURCE_PROXY_BASE).toBe('/api/anisource')
  })

  it('uses the same-origin AniSource route when no client override is configured', async () => {
    const fetch = vi.fn(async () => response({ sources: [], count: 0 }))
    const client = createAniSourceClient({ transport: transport(fetch) })

    await expect(client.sources()).resolves.toEqual({ sources: [], count: 0 })
    expect(fetch).toHaveBeenCalledWith('/api/anisource/api/v1/anime/sources', expect.any(Object))
  })

  it('routes relative media assets through the same-origin gateway', () => {
    expect(resolveUrl('/api/v1/proxy/hls/token')).toBe('/api/anisource/api/v1/proxy/hls/token')
    expect(resolveUrl('/api/anisource/asset/ticket')).toBe('/api/anisource/asset/ticket')
  })

  it('preserves timeout classification returned by the server proxy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Upstream timed out.' }), {
      status: 504,
      headers: { 'content-type': 'application/json', 'x-anisource-error-kind': 'timeout' },
    })))
    const client = createAniSourceClient()

    await expect(client.sources()).rejects.toMatchObject({ kind: 'timeout', isColdStart: true, status: 504 })
    vi.unstubAllGlobals()
  })

  it('validates the deployed health response contract', async () => {
    const health = {
      status: 'ok',
      version: '0.2.0',
      uptime_seconds: 46.77,
      memory_usage_mb: 75.23,
      active_sources: 2,
      cache_stats: {
        item_count: 0,
        max_items: 1_000,
        hits: 0,
        misses: 0,
        hit_rate_percent: 0,
        inflight_requests: 0,
      },
    }
    const fetch = vi.fn(async () => response(health))
    const client = createAniSourceClient({ baseUrl: 'https://api.test', transport: transport(fetch) })

    await expect(client.health()).resolves.toEqual(health)
    expect(fetch).toHaveBeenCalledWith('https://api.test/health', expect.any(Object))
  })

  it('validates and returns source data', async () => {
    const fetch = vi.fn(async () => response({ sources: [{ id: 'source id', name: 'Source', base_url: 'https://source.test' }], count: 1 }))
    const client = createAniSourceClient({ baseUrl: 'https://api.test/', transport: transport(fetch) })
    await expect(client.sources()).resolves.toEqual({ sources: [{ id: 'source id', name: 'Source', base_url: 'https://source.test' }], count: 1 })
    expect(fetch).toHaveBeenCalledWith('https://api.test/api/v1/anime/sources', expect.any(Object))
  })

  it('uses the manga source, search, chapters, details, and pages routes', async () => {
    const manga = {
      id: 'manga-1',
      title: 'Test Manga',
      url: 'https://source.test/manga-1',
      thumbnail: '',
      description: '',
      genres: [],
      authors: [],
      artists: [],
      alternative_titles: [],
      status: 'ongoing',
    }
    const chapter = {
      id: 'chapter-1',
      title: 'Chapter 1',
      url: 'https://source.test/chapter-1',
      number: 1,
      volume: null,
      scanlator: '',
      language: 'en',
      released_at: null,
    }
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/api/v1/manga/sources')) return response({ sources: [{ id: 'source/id', name: 'Source', base_url: 'https://source.test' }], count: 1 })
      if (url.includes('/search?')) return response({ items: [manga], page: 1, has_next: false, total_returned: 1 })
      if (url.includes('/api/v1/manga/source%2Fid/manga/')) return response(manga)
      if (url.includes('/api/v1/manga/source%2Fid/chapters/')) return response([chapter])
      return response([{ index: 0, url: 'https://source.test/page-1', page_url: '' }])
    })
    const client = createAniSourceClient({ baseUrl: 'https://api.test', transport: transport(fetch) })

    await client.mangaSources()
    await client.mangaSearch('source/id', 'Test Manga', 2)
    await client.mangaDetails('source/id', 'manga/id')
    await client.mangaChapters('source/id', 'manga/id')
    await client.mangaPages('source/id', 'chapter/id')

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://api.test/api/v1/manga/sources',
      'https://api.test/api/v1/manga/source%2Fid/search?q=Test%20Manga&page=2',
      'https://api.test/api/v1/manga/source%2Fid/manga/manga%2Fid',
      'https://api.test/api/v1/manga/source%2Fid/chapters/manga%2Fid',
      'https://api.test/api/v1/manga/source%2Fid/pages/chapter%2Fid',
    ])
  })

  it('resolves relative page, stream, and subtitle assets against the configured client base', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('/pages/')) return response([{ index: 0, url: '/proxy/page-1', page_url: '/proxy/page-1' }])
      return response([{
        url: '/proxy/hls/master.m3u8',
        quality: 'Auto',
        headers: {},
        subtitles: [{ url: '/proxy/subtitles/en.vtt', label: 'English', language: 'en' }],
        is_hls: true,
        is_audio: false,
      }])
    })
    const client = createAniSourceClient({ baseUrl: 'https://api.test', transport: transport(fetch) })

    await expect(client.mangaPages('source', 'chapter')).resolves.toMatchObject([{
      url: 'https://api.test/proxy/page-1',
      page_url: 'https://api.test/proxy/page-1',
    }])
    await expect(client.streams('source', 'episode', 'server')).resolves.toMatchObject([{
      url: 'https://api.test/proxy/hls/master.m3u8',
      subtitles: [{ url: 'https://api.test/proxy/subtitles/en.vtt' }],
    }])
  })
  it('encodes source and query parameters', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response({ items: [], page: 1, has_next: false, total_returned: 0 }))
    const client = createAniSourceClient({ baseUrl: 'https://api.test', transport: transport(fetch) })
    await client.search('source/id', 'A title & more', 2)
    expect(fetch.mock.calls).toHaveLength(1)
    expect(fetch.mock.calls[0]![0]).toBe('https://api.test/api/v1/anime/source%2Fid/search?q=A%20title%20%26%20more&page=2')
  })
  it('encodes opaque episode IDs when requesting servers and streams', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response([{ id: 'server-1', name: 'Primary', type: 'SUB' }]))
    const client = createAniSourceClient({ baseUrl: 'https://api.test', transport: transport(fetch) })
    const opaqueEpisodeId = '80163&eps=1&epurl=/watch/cowboy-bebop-100'

    await client.servers('aniwaves', opaqueEpisodeId)
    expect(fetch.mock.calls[0]![0]).toBe(
      'https://api.test/api/v1/anime/aniwaves/servers/80163%26eps%3D1%26epurl%3D%2Fwatch%2Fcowboy-bebop-100',
    )

    fetch.mockResolvedValueOnce(response([{ url: '/api/v1/proxy/hls/token', quality: '720p', is_hls: true }]))
    await client.streams('aniwaves', opaqueEpisodeId, 'server & one')
    expect(fetch.mock.calls[1]![0]).toBe(
      'https://api.test/api/v1/anime/aniwaves/streams/80163%26eps%3D1%26epurl%3D%2Fwatch%2Fcowboy-bebop-100?server_id=server%20%26%20one',
    )
  })

  it('surfaces HTTP errors with backend detail', async () => {
    const client = createAniSourceClient({ baseUrl: 'https://api.test', transport: transport(async () => response({ detail: 'Source unavailable' }, 503)) })
    await expect(client.sources()).rejects.toMatchObject({ name: 'AniSourceError', kind: 'http', status: 503, message: 'Source unavailable' })
  })
  it('surfaces a timeout as a cold-start-aware error', async () => {
    const client = createAniSourceClient({ baseUrl: 'https://api.test', transport: transport(async () => { const error = new Error('aborted'); error.name = 'AbortError'; throw error }) })
    await expect(client.sources()).rejects.toMatchObject({ name: 'AniSourceError', kind: 'timeout' })
  })
  it('calls the slow callback while a request is pending', async () => {
    let release: ((response: Response) => void) | undefined
    const client = createAniSourceClient({
      baseUrl: 'https://api.test',
      transport: {
        ...transport(() => new Promise<Response>((resolve) => { release = resolve })),
        setTimeout: vi.fn((callback) => { callback(); return 1 as unknown as ReturnType<typeof setTimeout> }),
      },
    })
    const slow = vi.fn()
    const pending = client.sources(slow)
    expect(slow).toHaveBeenCalled()
    release?.(response({ sources: [], count: 0 }))
    await expect(pending).resolves.toEqual({ sources: [], count: 0 })
  })
  it('rejects malformed JSON and invalid schema payloads', async () => {
    const malformed = { ok: true, status: 200, json: async () => { throw new SyntaxError('bad') } } as unknown as Response
    const malformedClient = createAniSourceClient({ baseUrl: 'https://api.test', transport: transport(async () => malformed) })
    await expect(malformedClient.sources()).rejects.toMatchObject({ kind: 'invalid', message: expect.stringContaining('malformed JSON') })

    const invalidClient = createAniSourceClient({ baseUrl: 'https://api.test', transport: transport(async () => response({ nope: true })) })
    await expect(invalidClient.sources()).rejects.toMatchObject({ kind: 'invalid' })
  })
  it('turns network failures into AniSourceError', async () => {
    const client = createAniSourceClient({ baseUrl: 'https://api.test', transport: transport(async () => { throw new TypeError('offline') }) })
    await expect(client.sources()).rejects.toBeInstanceOf(AniSourceError)
    await expect(client.sources()).rejects.toMatchObject({ kind: 'network' })
  })
  it('normalizes WebVTT and SRT captions while rejecting error pages', () => {
    expect(normalizeSubtitleText('﻿WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nHello')).toBe(
      'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello',
    )
    expect(normalizeSubtitleText('1\r\n00:00:01,250 --> 00:00:02,500\r\nHello')).toBe(
      'WEBVTT\n\n1\n00:00:01.250 --> 00:00:02.500\nHello',
    )
    expect(normalizeSubtitleText('1\n00:00:01,250 --> 00:00:02,500\nHello, world')).toContain('Hello, world')
    expect(() => normalizeSubtitleText('<html>Access denied</html>')).toThrow(AniSourceError)
  })

  it('loads subtitles through the same-origin media ticket, without an arbitrary URL relay', async () => {
    const url = '/api/anisource/asset/signed-ticket'
    const browserFetch = vi.fn(async () => new Response('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nRelayed caption'))
    vi.stubGlobal('fetch', browserFetch)

    await expect(loadSubtitle(url)).resolves.toContain('Relayed caption')

    expect(browserFetch).toHaveBeenCalledWith(url, {
      headers: { Accept: 'text/vtt, text/plain;q=0.9, */*;q=0.1' },
    })
    vi.unstubAllGlobals()
  })
})
