import { describe, expect, it, vi } from 'vitest'
import { detailShape } from '../app/data/anilist/schema'
import {
  createWatchSession,
  derivePlayerStage,
  episodeRouteToken,
  orderStreams,
  resolveEpisodeId,
  type WatchPersistence,
  type WatchSourceClient,
} from '../app/components/anime/watch/createWatchSession'
import type {
  AniSourceAnime,
  Episode,
  Server,
  Stream,
} from '../app/data/anisource/schema'

const anime = detailShape.parse({
  id: 42,
  siteUrl: null,
  title: { english: 'Signal', romaji: 'Signal', native: 'シグナル' },
  coverImage: { extraLarge: null, large: 'https://img.test/poster.jpg', medium: null, color: null },
  bannerImage: null,
  averageScore: 84,
  meanScore: 84,
  popularity: 100,
  favourites: null,
  trending: null,
  format: 'TV',
  status: 'FINISHED',
  episodes: 12,
  season: 'FALL',
  seasonYear: 2025,
  genres: ['Drama'],
  countryOfOrigin: 'JP',
  isAdult: false,
  nextAiringEpisode: null,
  description: null,
  duration: 24,
  startDate: null,
  endDate: null,
  source: 'ORIGINAL',
  synonyms: [],
  studios: null,
  trailer: null,
  externalLinks: null,
  rankings: null,
  tags: null,
  staff: null,
  characters: null,
  relations: null,
  recommendations: null,
})

const candidate = (over: Partial<AniSourceAnime> = {}): AniSourceAnime => ({
  id: 'signal-42',
  title: 'Signal',
  url: '',
  thumbnail: '',
  description: '',
  genres: [],
  studios: [],
  producers: [],
  alternative_titles: [],
  status: 'unknown',
  score: null,
  tags: [],
  ...over,
})

const episode = (over: Partial<Episode> = {}): Episode => ({
  id: 'episode-1&eps=1',
  number: 1,
  title: 'Pilot',
  is_filler: false,
  has_sub: true,
  has_dub: false,
  scanlator: '',
  released_at: null,
  ...over,
})

const server = (id: string, name = id): Server => ({ id, name, type: 'SUB' })
const stream = (quality: string): Stream => ({
  url: `https://stream.test/${quality}`,
  quality,
  headers: {},
  subtitles: [],
  is_hls: false,
})

function persistence(over: Partial<WatchPersistence> = {}): WatchPersistence {
  return {
    getPreferredSource: vi.fn(async () => null),
    setPreferredSource: vi.fn(async () => undefined),
    getSavedMatch: vi.fn(async () => null),
    saveMatch: vi.fn(async () => undefined),
    clearSavedMatch: vi.fn(async () => undefined),
    recordContinue: vi.fn(async () => undefined),
    ...over,
  }
}

function api(over: Partial<WatchSourceClient> = {}): WatchSourceClient {
  return {
    sources: vi.fn(async () => ({
      sources: [{ id: 'source-a', name: 'Source A', base_url: 'https://source.test' }],
      count: 1,
    })),
    search: vi.fn(async () => ({
      items: [candidate()],
      page: 1,
      has_next: false,
      total_returned: 1,
    })),
    episodes: vi.fn(async () => [episode()]),
    servers: vi.fn(async () => [server('server-a', 'Primary')]),
    streams: vi.fn(async () => [stream('720p'), stream('1080p')]),
    ...over,
  }
}

function sessionParts(over: {
  api?: Partial<WatchSourceClient>
  persistence?: Partial<WatchPersistence>
  episodeId?: string
  source?: string
} = {}) {
  let routeEpisodeId = over.episodeId ?? 'next'
  const navigateToEpisode = vi.fn(async (token: string) => {
    routeEpisodeId = token
  })
  const sourceApi = api(over.api)
  const saved = persistence(over.persistence)
  const session = createWatchSession({
    anime,
    routeEpisodeId: () => routeEpisodeId,
    sourceSearchParam: () => over.source,
    navigateToEpisode,
    api: sourceApi,
    persistence: saved,
  })
  return { session, api: sourceApi, persistence: saved, navigateToEpisode }
}

describe('Watch session', () => {
  it('initializes, auto-matches, loads the next episode, and navigates with a route token', async () => {
    const { session, api, persistence, navigateToEpisode } = sessionParts()

    await session.initialize()

    expect(api.sources).toHaveBeenCalledOnce()
    expect(api.search).toHaveBeenCalledWith('source-a', 'Signal', 1, expect.any(Function))
    expect(session.match()?.kind).toBe('auto')
    expect(session.matchedAnime()?.id).toBe('signal-42')
    expect(session.episodes()).toHaveLength(1)
    expect(session.selectedEpisode()).toBe('episode-1&eps=1')
    expect(session.playerStage()).toBe('server')
    expect(navigateToEpisode).toHaveBeenCalledWith('episode-1', undefined)
    expect(persistence.saveMatch).toHaveBeenCalledWith(42, {
      sourceId: 'source-a',
      animeId: 'signal-42',
      title: 'Signal',
    })
  })

  it('reuses a saved Match without searching the source', async () => {
    const { session, api, persistence } = sessionParts({
      persistence: {
        getSavedMatch: vi.fn(async () => ({ sourceId: 'source-a', animeId: 'saved-42', title: 'Saved Signal' })),
      },
    })

    await session.initialize()

    expect(api.search).not.toHaveBeenCalled()
    expect(session.matchedAnime()).toMatchObject({ id: 'saved-42', title: 'Saved Signal' })
    expect(api.episodes).toHaveBeenCalledWith('source-a', 'saved-42', expect.any(Function))
    expect(persistence.saveMatch).not.toHaveBeenCalled()
  })

  it('exposes a manual picker after an ambiguous match and records the chosen candidate', async () => {
    const first = candidate({ id: 'signal-a', title: 'Signal Season 1' })
    const second = candidate({ id: 'signal-b', title: 'Signal Season 2' })
    const { session, persistence } = sessionParts({
      api: {
        search: vi.fn(async () => ({
          items: [first, second],
          page: 1,
          has_next: false,
          total_returned: 2,
        })),
      },
    })

    await session.initialize()
    expect(session.match()?.kind).toBe('picker')
    expect(session.pickerCandidates().map((item) => item.candidate.id)).toEqual(['signal-a', 'signal-b'])

    await session.changeMatch(second)

    expect(session.matchedAnime()?.id).toBe('signal-b')
    expect(persistence.saveMatch).toHaveBeenCalledWith(42, {
      sourceId: 'source-a',
      animeId: 'signal-b',
      title: 'Signal Season 2',
    })
  })

  it('surfaces a failed manual search and debounces input until disposed', async () => {
    vi.useFakeTimers()
    try {
      const search = vi.fn(async () => {
        throw new Error('source unavailable')
      })
      const { session } = sessionParts({ api: { search } })

      await session.initialize()
      session.openMatchPicker()
      session.onManualQueryInput('Signal retry')
      await vi.advanceTimersByTimeAsync(350)
      await Promise.resolve()
      expect(session.error()).toBe('source unavailable')
      expect(search).toHaveBeenCalled()

      search.mockClear()
      session.onManualQueryInput('Disposed query')
      session.dispose()
      await vi.advanceTimersByTimeAsync(350)
      expect(search).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('progresses from episode to server to ordered streams and records Continue Watching', async () => {
    const { session, persistence } = sessionParts()

    await session.initialize()
    await session.chooseServer('server-a')

    expect(session.streams().map((item) => item.quality)).toEqual(['1080p', '720p'])
    expect(session.playerStage()).toBe('player')
    expect(persistence.recordContinue).toHaveBeenCalledWith(expect.objectContaining({
      id: 42,
      sourceId: 'source-a',
      animeId: 'signal-42',
      episodeId: 'episode-1&eps=1',
      episodeNumber: 1,
    }))
  })
})

describe('Watch session helpers', () => {
  it('resolves route tokens and preserves opaque episode IDs', () => {
    const opaque = episode()
    expect(episodeRouteToken(opaque)).toBe('episode-1')
    expect(resolveEpisodeId([opaque], 'next', 1)).toBe('episode-1&eps=1')
    expect(resolveEpisodeId([opaque], 'episode-1', null)).toBe('episode-1&eps=1')
    expect(resolveEpisodeId([opaque], 'episode-1&eps=1', null)).toBe('episode-1&eps=1')
  })

  it('orders streams by numeric quality and derives each player stage', () => {
    expect(orderStreams([stream('480p'), stream('1080p'), stream('720p')]).map((item) => item.quality)).toEqual([
      '1080p',
      '720p',
      '480p',
    ])
    expect(derivePlayerStage({ selectedEpisode: null, loading: '', servers: [], selectedServer: null, streams: [], error: null })).toBe('episode')
    expect(derivePlayerStage({ selectedEpisode: 'episode', loading: 'servers', servers: [], selectedServer: null, streams: [], error: null })).toBe('servers-loading')
    expect(derivePlayerStage({ selectedEpisode: 'episode', loading: '', servers: [], selectedServer: null, streams: [], error: null })).toBe('servers-empty')
    expect(derivePlayerStage({ selectedEpisode: 'episode', loading: '', servers: [server('server-a')], selectedServer: null, streams: [], error: null })).toBe('server')
    expect(derivePlayerStage({ selectedEpisode: 'episode', loading: 'streams', servers: [server('server-a')], selectedServer: 'server-a', streams: [], error: null })).toBe('streams-loading')
    expect(derivePlayerStage({ selectedEpisode: 'episode', loading: '', servers: [server('server-a')], selectedServer: 'server-a', streams: [], error: null })).toBe('streams-empty')
    expect(derivePlayerStage({ selectedEpisode: 'episode', loading: '', servers: [server('server-a')], selectedServer: 'server-a', streams: [], error: 'failed' })).toBe('stream-error')
    expect(derivePlayerStage({ selectedEpisode: 'episode', loading: '', servers: [server('server-a')], selectedServer: 'server-a', streams: [stream('720p')], error: null })).toBe('player')
  })
})
