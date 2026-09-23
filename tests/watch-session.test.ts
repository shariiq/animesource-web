import { describe, expect, it, vi } from 'vitest'
import { detailShape } from '../app/data/anilist/schema'
import { AniSourceError } from '../app/data/anisource/client'
import {
  createWatchSession,
  derivePlayerStage,
  episodeRouteToken,
  MAX_EXPIRED_STREAM_REFRESHES,
  orderStreams,
  resolveEpisodeId,
  type WatchPersistence,
  type WatchSourceClient,
} from '../app/components/anime/watch/createWatchSession'
import { selectDefaultEpisode, selectDefaultEpisodeWithReason } from '../app/components/anime/watch/episodeNavigation'
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
const stream = (quality: string, is_audio = false): Stream => ({
  url: `https://stream.test/${quality}`,
  quality,
  headers: {},
  subtitles: [],
  is_hls: false,
  is_audio,
})

function persistence(over: Partial<WatchPersistence> = {}): WatchPersistence {
  return {
    getPreferredSource: vi.fn(async () => null),
    setPreferredSource: vi.fn(async () => undefined),
    getSavedMatch: vi.fn(async () => null),
    saveMatch: vi.fn(async () => undefined),
    clearSavedMatch: vi.fn(async () => undefined),
    getContinue: vi.fn(async () => []),
    recordContinue: vi.fn(async () => undefined),
    updateProgress: vi.fn(async () => undefined),
    markEpisodeComplete: vi.fn(async () => undefined),
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
  fallbackApi?: Partial<WatchSourceClient>
} = {}) {
  let routeEpisodeId = over.episodeId ?? 'next'
  const navigateToEpisode = vi.fn(async (token: string) => {
    routeEpisodeId = token
  })
  const sourceApi = api(over.api)
  const saved = persistence(over.persistence)
  const fallback = over.fallbackApi ? api(over.fallbackApi) : undefined
  const session = createWatchSession({
    anime,
    routeEpisodeId: () => routeEpisodeId,
    sourceSearchParam: () => over.source,
    navigateToEpisode,
    api: sourceApi,
    persistence: saved,
    ...(fallback ? { fallbackApi: fallback } : {}),
  })
  return { session, api: sourceApi, persistence: saved, navigateToEpisode, fallbackApi: fallback }
}

describe('Watch session', () => {
  it('initializes, auto-matches, loads the next episode, and navigates with a route token', async () => {
    const { session, api, persistence, navigateToEpisode } = sessionParts()

    await session.initialize()

    expect(api.sources).toHaveBeenCalledOnce()
    expect(api.search).toHaveBeenCalledWith('source-a', 'Signal', 1, expect.any(Function), expect.any(AbortSignal))
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

  it('short-circuits remaining synonym searches when the primary title finds a confident auto-match', async () => {
    const multiTitleAnime = detailShape.parse({
      ...anime,
      synonyms: ['Synonym 1', 'Synonym 2', 'Synonym 3'],
    })
    const searchMock = vi.fn(async () => ({
      items: [candidate()],
      page: 1,
      has_next: false,
      total_returned: 1,
    }))
    const sourceApi = api({ search: searchMock })
    const session = createWatchSession({
      anime: multiTitleAnime,
      routeEpisodeId: () => 'next',
      sourceSearchParam: () => undefined,
      navigateToEpisode: vi.fn(),
      api: sourceApi,
      persistence: persistence(),
    })

    await session.initialize()

    // It should have only searched once for the primary title "Signal" and short-circuited
    expect(searchMock).toHaveBeenCalledTimes(1)
    expect(searchMock).toHaveBeenCalledWith('source-a', 'Signal', 1, expect.any(Function), expect.any(AbortSignal))
    expect(session.match()?.kind).toBe('auto')
  })

  it('searches remaining title variants in parallel if the primary title is not an auto-match', async () => {
    const multiTitleAnime = detailShape.parse({
      ...anime,
      title: { english: 'Unknown Primary', romaji: null, native: null },
      synonyms: ['Real Match'],
    })
    const searchMock = vi.fn(async (_source: string, query: string) => {
      if (query === 'Unknown Primary') {
        return { items: [], page: 1, has_next: false, total_returned: 0 }
      }
      return { items: [candidate({ id: 'real-1', title: 'Real Match' })], page: 1, has_next: false, total_returned: 1 }
    })
    const sourceApi = api({ search: searchMock })
    const session = createWatchSession({
      anime: multiTitleAnime,
      routeEpisodeId: () => 'next',
      sourceSearchParam: () => undefined,
      navigateToEpisode: vi.fn(),
      api: sourceApi,
      persistence: persistence(),
    })

    await session.initialize()

    expect(searchMock).toHaveBeenCalledTimes(2)
    expect(session.matchedAnime()?.id).toBe('real-1')
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
    expect(api.episodes).toHaveBeenCalledWith('source-a', 'saved-42', expect.any(Function), expect.any(AbortSignal))
    expect(persistence.saveMatch).not.toHaveBeenCalled()
  })

  it('tries the next source when every title variant is empty', async () => {
    const search = vi.fn(async (sourceId: string) => ({
      items: sourceId === 'source-b' ? [candidate()] : [],
      page: 1,
      has_next: false,
      total_returned: sourceId === 'source-b' ? 1 : 0,
    }))
    const { session } = sessionParts({
      api: {
        sources: vi.fn(async () => ({
          sources: [
            { id: 'source-a', name: 'Source A', base_url: '' },
            { id: 'source-b', name: 'Source B', base_url: '' },
          ],
          count: 2,
        })),
        search,
      },
    })

    await session.initialize()

    expect(search).toHaveBeenCalledWith('source-a', 'Signal', 1, expect.any(Function), expect.any(AbortSignal))
    expect(search).toHaveBeenCalledWith('source-b', 'Signal', 1, expect.any(Function), expect.any(AbortSignal))
    expect(session.selectedSource()).toBe('source-b')
    expect(session.matchedAnime()?.id).toBe('signal-42')
  })

  it('opens the manual match picker only after every source is empty', async () => {
    const { session, api } = sessionParts({
      api: {
        sources: vi.fn(async () => ({
          sources: [
            { id: 'source-a', name: 'Source A', base_url: '' },
            { id: 'source-b', name: 'Source B', base_url: '' },
          ],
          count: 2,
        })),
        search: vi.fn(async () => ({ items: [], page: 1, has_next: false, total_returned: 0 })),
      },
    })

    await session.initialize()

    expect(api.search).toHaveBeenCalledTimes(4)
    expect(session.selectedSource()).toBe('source-b')
    expect(session.match()).toEqual({ kind: 'empty', ranked: [] })
    expect(session.error()).toBeNull()
    expect(session.pickerCandidates()).toEqual([])
  })

  it('drops a stale saved Match when its source is no longer available and continues mapping normally', async () => {
    const { session, api, persistence } = sessionParts({
      persistence: {
        getSavedMatch: vi.fn(async () => ({ sourceId: 'source-removed', animeId: 'saved-42', title: 'Saved Signal' })),
      },
      api: {
        // Only source-a is available
        sources: vi.fn(async () => ({ sources: [{ id: 'source-a', name: 'Source A', base_url: '' }], count: 1 })),
      },
    })

    await session.initialize()

    // The stale match logic clears the bad savedMatch and falls back to normal matching
    expect(persistence.clearSavedMatch).toHaveBeenCalledWith(42)
    expect(api.search).toHaveBeenCalledWith('source-a', 'Signal', 1, expect.any(Function), expect.any(AbortSignal))
    expect(persistence.saveMatch).toHaveBeenCalledWith(42, expect.objectContaining({ sourceId: 'source-a' }))
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

  it('exposes the stored resume position only once the episode is actually playable', async () => {
    const stored = {
      id: 42,
      title: 'Signal',
      cover: '',
      sourceId: 'source-a',
      sourceName: 'Source A',
      animeId: 'signal-42',
      episodeId: 'episode-1&eps=1',
      episodeNumber: 1,
      position: 610,
      duration: 1440,
      completed: false,
      ts: Date.now(),
    }
    const { session } = sessionParts({
      persistence: { getContinue: vi.fn(async () => [stored]) },
    })

    await session.initialize()
    // The episode is selected, but no stream is playing yet.
    expect(session.resumeAt()).toBe(0)

    await session.chooseServer('server-a')
    expect(session.resumeAt()).toBe(610)
  })

  it('does not resume an episode that was already watched to completion', async () => {
    const stored = {
      id: 42,
      title: 'Signal',
      cover: '',
      sourceId: 'source-a',
      sourceName: 'Source A',
      animeId: 'signal-42',
      episodeId: 'episode-1&eps=1',
      episodeNumber: 1,
      position: 1400,
      duration: 1440,
      completed: true,
      ts: Date.now(),
    }
    const { session } = sessionParts({
      persistence: { getContinue: vi.fn(async () => [stored]) },
    })

    await session.initialize()
    await session.chooseServer('server-a')
    expect(session.resumeAt()).toBe(0)
  })

  it('attributes playback progress and completion to the playing episode only', async () => {
    const { session, persistence } = sessionParts()

    await session.initialize()
    // Nothing is playing yet, so a stray progress tick must not be persisted.
    await session.updatePlaybackProgress(30, 1440)
    await session.markPlaybackComplete()
    expect(persistence.updateProgress).not.toHaveBeenCalled()
    expect(persistence.markEpisodeComplete).not.toHaveBeenCalled()

    await session.chooseServer('server-a')
    await session.updatePlaybackProgress(300, 1440)
    await session.markPlaybackComplete()

    expect(persistence.updateProgress).toHaveBeenCalledWith({
      id: 42,
      episodeId: 'episode-1&eps=1',
      position: 300,
      duration: 1440,
    })
    expect(persistence.markEpisodeComplete).toHaveBeenCalledWith(42, 'episode-1&eps=1')
  })

  it('keeps the player unmounted and the episode unplayable when a server returns no streams', async () => {
    const { session, persistence } = sessionParts({
      api: { streams: vi.fn(async () => []) },
    })

    await session.initialize()
    await session.chooseServer('server-a')

    expect(session.playerStage()).toBe('streams-empty')
    expect(persistence.recordContinue).not.toHaveBeenCalled()
    await session.updatePlaybackProgress(120, 1440)
    expect(persistence.updateProgress).not.toHaveBeenCalled()
  })

  it('bounds repeated stream retries and exposes an observed alternate source', async () => {
    const streams = vi.fn(async () => {
      throw new Error('server unavailable')
    })
    const { session, api } = sessionParts({
      api: {
        sources: vi.fn(async () => ({
          sources: [
            { id: 'source-a', name: 'Source A', base_url: 'https://source-a.test' },
            { id: 'source-b', name: 'Source B', base_url: 'https://source-b.test' },
          ],
          count: 2,
        })),
        streams,
      },
    })

    await session.initialize()
    await session.chooseServer('server-a')
    expect(session.playbackIdentity()).toBeNull()
    expect(session.fallbackSource()?.id).toBe('source-b')

    await session.retryStreams()
    await session.retryStreams()
    await session.retryStreams()

    expect(streams).toHaveBeenCalledTimes(3)
    expect(session.watchError()?.retryable).toBe(false)
    expect(api.sources).toHaveBeenCalledOnce()
  })

  it('recovers silently from expired links up to a bound, then surfaces a retryable failure', async () => {
    const streams = vi.fn(async () => [stream('720p')])
    const { session } = sessionParts({ api: { streams } })

    await session.initialize()
    await session.chooseServer('server-a')

    for (let round = 0; round < MAX_EXPIRED_STREAM_REFRESHES; round += 1) {
      const current = session.playbackIdentity()
      if (!current) throw new Error('Expected the selected server to have a playback identity.')
      session.reportMediaFailure(current, 'This stream link has expired.', true)
      await vi.waitFor(() => {
        expect(session.playbackIdentity()).not.toBeNull()
        expect(session.playbackIdentity()?.key).not.toBe(current.key)
      })
    }

    expect(streams).toHaveBeenCalledTimes(1 + MAX_EXPIRED_STREAM_REFRESHES)
    expect(session.watchError()).toBeNull()

    const exhausted = session.playbackIdentity()
    if (!exhausted) throw new Error('Expected refreshed stream links to have a playback identity.')
    session.reportMediaFailure(exhausted, 'This stream link has expired again.', true)

    expect(streams).toHaveBeenCalledTimes(1 + MAX_EXPIRED_STREAM_REFRESHES)
    expect(session.watchError()?.kind).toBe('expired-stream')
  })

  it('recovers from repeated expiries within the silent-refresh budget', async () => {
    const streams = vi.fn(async () => [stream('720p')])
    const { session, api } = sessionParts({ api: { streams } })

    await session.initialize()
    await session.chooseServer('server-a')
    const first = session.playbackIdentity()
    if (!first) throw new Error('Expected the selected server to have a playback identity.')

    session.reportMediaFailure(first, 'This stream link has expired.', true)
    await vi.waitFor(() => {
      expect(session.playbackIdentity()).not.toBeNull()
      expect(session.playbackIdentity()?.key).not.toBe(first.key)
    })
    const second = session.playbackIdentity()
    if (!second) throw new Error('Expected refreshed stream links to have a playback identity.')

    // The independent upstream capability behind the new links can expire too;
    // because the refresh succeeded, one more silent recovery is available.
    session.reportMediaFailure(second, 'This stream link has expired again.', true)
    await vi.waitFor(() => {
      expect(session.playbackIdentity()).not.toBeNull()
      expect(session.playbackIdentity()?.key).not.toBe(second.key)
    })

    expect(api.streams).toHaveBeenCalledTimes(3)
    expect(session.watchError()).toBeNull()
  })

  it('re-resolves the current server with a fresh attempt for in-player retry', async () => {
    const streams = vi.fn(async () => [stream('720p')])
    const { session } = sessionParts({ api: { streams } })

    await session.initialize()
    await session.chooseServer('server-a')
    const first = session.playbackIdentity()
    if (!first) throw new Error('Expected the selected server to have a playback identity.')

    await session.retryCurrentServer()

    expect(streams).toHaveBeenCalledTimes(2)
    const retried = session.playbackIdentity()
    expect(retried).not.toBeNull()
    expect(retried?.key).not.toBe(first.key)
    expect(session.watchError()).toBeNull()
  })

  it('warms the fallback origin on the first expired link', async () => {
    const health = vi.fn(async () => ({
      status: 'ok',
      version: 'test',
      uptime_seconds: 1,
      memory_usage_mb: 1,
      active_sources: 1,
      cache_stats: {},
    }))
    const fallbackStreams = vi.fn(async () => [stream('720p')])
    const { session, api } = sessionParts({
      api: { streams: vi.fn(async () => [stream('720p')]) },
      fallbackApi: { health, streams: fallbackStreams },
    })

    await session.initialize()
    await session.chooseServer('server-a')
    const first = session.playbackIdentity()
    if (!first) throw new Error('Expected the selected server to have a playback identity.')

    session.reportMediaFailure(first, 'This stream link has expired.', true)
    await vi.waitFor(() => {
      expect(session.playbackIdentity()).not.toBeNull()
      expect(session.playbackIdentity()?.key).not.toBe(first.key)
    })

    // The primary budget handles recovery; the fallback only gets a wake-up ping.
    expect(api.streams).toHaveBeenCalledTimes(2)
    expect(health).toHaveBeenCalledTimes(1)
    expect(fallbackStreams).not.toHaveBeenCalled()

    const second = session.playbackIdentity()
    if (!second) throw new Error('Expected refreshed stream links to have a playback identity.')
    session.reportMediaFailure(second, 'This stream link has expired.', true)
    await vi.waitFor(() => {
      expect(session.playbackIdentity()?.key).not.toBe(second.key)
    })
    expect(health).toHaveBeenCalledTimes(1)
  })

  it('resolves streams from the fallback origin after the primary budget is exhausted', async () => {
    const primaryStreams = vi.fn(async () => [stream('720p')])
    const fallbackStreams = vi.fn(async () => [stream('fallback-1080p')])
    const { session, fallbackApi } = sessionParts({
      api: { streams: primaryStreams },
      fallbackApi: { streams: fallbackStreams },
    })

    await session.initialize()
    await session.chooseServer('server-a')

    for (let round = 0; round < MAX_EXPIRED_STREAM_REFRESHES; round += 1) {
      const current = session.playbackIdentity()
      if (!current) throw new Error('Expected the selected server to have a playback identity.')
      session.reportMediaFailure(current, 'This stream link has expired.', true)
      await vi.waitFor(() => {
        expect(session.playbackIdentity()).not.toBeNull()
        expect(session.playbackIdentity()?.key).not.toBe(current.key)
      })
    }

    const exhausted = session.playbackIdentity()
    if (!exhausted) throw new Error('Expected refreshed stream links to have a playback identity.')
    session.reportMediaFailure(exhausted, 'This stream link has expired.', true)
    await vi.waitFor(() => {
      expect(session.streams().map((item) => item.quality)).toEqual(['fallback-1080p'])
    })

    expect(primaryStreams).toHaveBeenCalledTimes(1 + MAX_EXPIRED_STREAM_REFRESHES)
    expect(fallbackStreams).toHaveBeenCalledTimes(1)
    expect(fallbackApi?.streams).toHaveBeenCalledTimes(1)
    expect(session.watchError()).toBeNull()

    const served = session.playbackIdentity()
    if (!served) throw new Error('Expected the fallback streams to have a playback identity.')
    session.reportMediaFailure(served, 'This stream link has expired.', true)

    expect(fallbackStreams).toHaveBeenCalledTimes(1)
    expect(session.watchError()?.kind).toBe('expired-stream')
  })

  it('surfaces the original expiry when the fallback origin is not configured', async () => {
    const fallbackStreams = vi.fn(async () => {
      throw new AniSourceError('AniSource fallback access is not configured.', 'misconfigured', 503)
    })
    const { session } = sessionParts({
      api: { streams: vi.fn(async () => [stream('720p')]) },
      fallbackApi: { streams: fallbackStreams },
    })

    await session.initialize()
    await session.chooseServer('server-a')

    for (let round = 0; round <= MAX_EXPIRED_STREAM_REFRESHES; round += 1) {
      const current = session.playbackIdentity()
      if (!current) throw new Error('Expected the selected server to have a playback identity.')
      session.reportMediaFailure(current, 'This stream link has expired.', true)
      if (round < MAX_EXPIRED_STREAM_REFRESHES) {
        await vi.waitFor(() => {
          expect(session.playbackIdentity()).not.toBeNull()
          expect(session.playbackIdentity()?.key).not.toBe(current.key)
        })
      }
    }

    expect(fallbackStreams).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => {
      expect(session.watchError()?.kind).toBe('expired-stream')
    })
  })

  it('surfaces the original expiry when the fallback server returns no streams', async () => {
    const { session } = sessionParts({
      api: { streams: vi.fn(async () => [stream('720p')]) },
      fallbackApi: { streams: vi.fn(async () => []) },
    })

    await session.initialize()
    await session.chooseServer('server-a')

    for (let round = 0; round <= MAX_EXPIRED_STREAM_REFRESHES; round += 1) {
      const current = session.playbackIdentity()
      if (!current) throw new Error('Expected the selected server to have a playback identity.')
      session.reportMediaFailure(current, 'This stream link has expired.', true)
      if (round < MAX_EXPIRED_STREAM_REFRESHES) {
        await vi.waitFor(() => {
          expect(session.playbackIdentity()).not.toBeNull()
          expect(session.playbackIdentity()?.key).not.toBe(current.key)
        })
      }
    }

    await vi.waitFor(() => {
      expect(session.watchError()?.kind).toBe('expired-stream')
    })
  })

  it('ignores a stale stream response after the viewer changes server', async () => {
    let releaseStale: ((streams: Stream[]) => void) | undefined
    const streams = vi.fn((_source: string, _episode: string, serverId: string) => {
      if (serverId === 'server-a') {
        return new Promise<Stream[]>((resolve) => {
          releaseStale = resolve
        })
      }
      return Promise.resolve([stream('1080p')])
    })
    const { session } = sessionParts({
      api: {
        servers: vi.fn(async () => [server('server-a', 'Primary'), server('server-b', 'Backup')]),
        streams,
      },
    })

    await session.initialize()
    const staleSelection = session.chooseServer('server-a')
    await Promise.resolve()
    await session.chooseServer('server-b')
    releaseStale?.([stream('360p')])
    await staleSelection

    expect(session.selectedServer()).toBe('server-b')
    expect(session.streams().map((item) => item.quality)).toEqual(['1080p'])
  })
})

describe('Watch session helpers', () => {
  const continueItem = (episodeId: string, episodeNumber: number, completed = false) => ({ id: 42, title: 'Signal', cover: '', sourceId: 'source-a', sourceName: 'Source A', animeId: 'signal-42', episodeId, episodeNumber, position: 20, duration: 100, completed, ts: 1 })

  it('selects the first episode for a new generic next route even when airing metadata points later', () => {
    const episodes = [episode({ id: 'episode-3&eps=3', number: 3 }), episode({ id: 'episode-1&eps=1', number: 1 })]
    expect(selectDefaultEpisode(episodes, { requested: 'next', scheduleEpisode: 3 })?.id).toBe('episode-1&eps=1')
  })

  it('resumes the unfinished episode or advances after a completed episode', () => {
    const episodes = [episode(), episode({ id: 'episode-2&eps=2', number: 2 }), episode({ id: 'episode-3&eps=3', number: 3 })]
    const unfinished = continueItem('episode-2&eps=2', 2)
    const completed = continueItem('episode-2&eps=2', 2, true)
    expect(selectDefaultEpisode(episodes, { requested: 'next', latest: unfinished })?.number).toBe(2)
    expect(selectDefaultEpisode(episodes, { requested: 'next', latest: completed })?.number).toBe(3)
    expect(selectDefaultEpisode(episodes, { requested: 'next', latest: continueItem('episode-3&eps=3', 3, true) })?.number).toBe(3)
  })

  it('prioritizes schedule intent over playback history for next airing episode', () => {
    const episodes = [episode(), episode({ id: 'episode-2&eps=2', number: 2 }), episode({ id: 'episode-3&eps=3', number: 3 })]
    const latest = continueItem('episode-1&eps=1', 1)
    expect(selectDefaultEpisode(episodes, { requested: 'next', latest, fromSchedule: true, scheduleEpisode: 3 })?.number).toBe(3)
    expect(selectDefaultEpisodeWithReason(episodes, { requested: 'next', latest, fromSchedule: true, scheduleEpisode: 4 }).reason).toBe('schedule-source-lag')
    expect(selectDefaultEpisodeWithReason(episodes, { requested: 'next', latest, fromSchedule: true, scheduleEpisode: 4 }).episode?.number).toBe(3)
  })

  it('preserves explicit episode routes over playback history', () => {
    const episodes = [episode(), episode({ id: 'episode-2&eps=2', number: 2 })]
    const latest = continueItem('episode-2&eps=2', 2)
    expect(selectDefaultEpisode(episodes, { requested: 'episode-1', latest })?.number).toBe(1)
  })
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
    expect(orderStreams([stream('Japanese audio', true), stream('1080p')]).map((item) => item.quality)).toEqual([
      '1080p',
      'Japanese audio',
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
