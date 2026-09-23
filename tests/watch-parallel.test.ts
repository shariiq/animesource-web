import { describe, expect, it, vi } from 'vitest'
import { detailShape } from '../app/data/anilist/schema'
import { createWatchSession } from '../app/components/anime/watch/createWatchSession'

const anime = detailShape.parse({
  id: 7,
  siteUrl: null,
  title: { english: 'Signal', romaji: 'Signal', native: null },
  coverImage: { extraLarge: null, large: 'https://img.test/poster.jpg', medium: null, color: null },
  bannerImage: null,
  averageScore: 80,
  meanScore: 80,
  popularity: 10,
  favourites: null,
  trending: null,
  format: 'TV',
  status: 'FINISHED',
  episodes: 1,
  season: null,
  seasonYear: null,
  genres: [],
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

describe('Watch session persistence parallelism', () => {
  it('issues playback and continue writes together before reading back progress', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const gate = async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      try {
        await new Promise((resolve) => setTimeout(resolve, 15))
      } finally {
        inFlight -= 1
      }
    }
    const recordPlayback = vi.fn(async () => {
      await gate()
    })
    const recordContinue = vi.fn(async () => {
      await gate()
    })
    const session = createWatchSession({
      anime,
      routeEpisodeId: () => 'next',
      sourceSearchParam: () => undefined,
      navigateToEpisode: vi.fn(async () => undefined),
      api: {
        sources: vi.fn(async () => ({
          sources: [{ id: 'source-a', name: 'Source A', base_url: 'https://source.test' }],
          count: 1,
        })),
        search: vi.fn(async () => ({
          items: [
            {
              id: 'signal-7',
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
            },
          ],
          page: 1,
          has_next: false,
          total_returned: 1,
        })),
        episodes: vi.fn(async () => [
          { id: 'ep-1', number: 1, title: 'Pilot', is_filler: false, has_sub: true, has_dub: false, scanlator: '', released_at: null },
        ]),
        servers: vi.fn(async () => [{ id: 'server-a', name: 'Primary', type: 'SUB' }]),
        streams: vi.fn(async () => [
          { url: 'https://stream.test/720p', quality: '720p', headers: {}, subtitles: [], is_hls: false, is_audio: false },
        ]),
      },
      persistence: {
        getPreferredSource: vi.fn(async () => null),
        setPreferredSource: vi.fn(async () => undefined),
        getSavedMatch: vi.fn(async () => null),
        saveMatch: vi.fn(async () => undefined),
        clearSavedMatch: vi.fn(async () => undefined),
        getContinue: vi.fn(async () => []),
        recordContinue,
        recordPlayback,
        getPlaybackRecord: vi.fn(async () => null),
        updateProgress: vi.fn(async () => undefined),
        markEpisodeComplete: vi.fn(async () => undefined),
      },
    })

    await session.initialize()
    await session.chooseServer('server-a')

    expect(recordPlayback).toHaveBeenCalledOnce()
    expect(recordContinue).toHaveBeenCalledOnce()
    expect(maxInFlight).toBeGreaterThanOrEqual(2)
    expect(session.playbackIdentity()).not.toBeNull()
  })
})
