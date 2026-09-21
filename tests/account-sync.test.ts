import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importAniListPublicList } from '../app/data/anilist/import'
import { closeDb } from '../app/lib/persistence/indexedDb'
import { browserSearchHistory } from '../app/lib/persistence/searchHistory'
import { mergeViewerSnapshots } from '../app/lib/persistence/snapshot'
import { browserViewerData, type ViewerExport } from '../app/lib/persistence/viewer'
import { createViewerSync, getViewerSyncStatus } from '../app/lib/sync/viewerSync'

beforeEach(async () => {
  await closeDb()
  // eslint-disable-next-line no-global-assign -- intentional per-test isolation of the jsdom IndexedDB global
  indexedDB = new IDBFactory()
})

describe('viewer account data', () => {
  it('round-trips profile, preferences, library, progress, matches, and history', async () => {
    await browserViewerData.setViewerProfile({ displayName: 'Mina' })
    await browserViewerData.setViewerPreferences({ adultContent: true, language: 'ja', timezone: 'Asia/Tokyo', notifications: true })
    await browserViewerData.setPlaybackPreferences({ quality: '1080p', audioLanguage: 'ja', audioLabel: '日本語', subtitleLanguage: 'ja', subtitleLabel: '日本語' })
    await browserViewerData.toggleFavorite({ id: 42, title: 'Orbit', cover: 'cover', format: 'TV', averageScore: 91 })
    await browserViewerData.recordContinue({ id: 42, title: 'Orbit', cover: 'cover', sourceId: 'src', sourceName: 'Source', animeId: 'orbit', episodeId: 'ep-1', episodeNumber: 1 })
    await browserViewerData.recordPlayback({ id: 42, title: 'Orbit', cover: 'cover', sourceId: 'src', sourceName: 'Source', animeId: 'orbit', episodeId: 'ep-1', episodeNumber: 1, position: 0, duration: 0 })
    await browserViewerData.updateProgress({ id: 42, episodeId: 'ep-1', position: 120, duration: 1_200 })
    await browserViewerData.saveMatch(42, { sourceId: 'src', animeId: 'orbit', title: 'Orbit' })
    await browserViewerData.setPreferredSource('src')
    await browserSearchHistory.record('Orbit')

    const snapshot = await browserViewerData.exportViewerData()
    await browserViewerData.clearViewerData()
    await browserViewerData.importViewerData(snapshot, 'replace')

    await expect(browserViewerData.getViewerProfile()).resolves.toMatchObject({ displayName: 'Mina' })
    await expect(browserViewerData.getViewerPreferences()).resolves.toMatchObject({ language: 'ja', timezone: 'Asia/Tokyo', adultContent: true })
    await expect(browserViewerData.getFavorites()).resolves.toMatchObject([{ id: 42 }])
    await expect(browserViewerData.getContinue()).resolves.toMatchObject([{ id: 42, episodeId: 'ep-1' }])
    await expect(browserViewerData.getPlaybackRecord(42, 'ep-1')).resolves.toMatchObject({ position: 120 })
    await expect(browserViewerData.getSavedMatch(42)).resolves.toMatchObject({ animeId: 'orbit' })
    await expect(browserViewerData.getPreferredSource()).resolves.toBe('src')
    await expect(browserSearchHistory.get()).resolves.toMatchObject([{ query: 'Orbit' }])
  })

  it('does not resurrect an offline deletion when the remote copy has the same timestamp', () => {
    const local = snapshot({
      favorites: [],
      tombstones: [{ collection: 'favorites', key: '42', ts: 100 }],
    })
    const remote = snapshot({
      favorites: [{ id: 42, title: 'Orbit', cover: '', format: 'TV', averageScore: null, status: 'PLANNING', ts: 100 }],
    })

    expect(mergeViewerSnapshots(local, remote).favorites).toEqual([])
  })
})

describe('viewer synchronization', () => {
  it('surfaces partial remote writes instead of claiming everything was saved', async () => {
    await browserViewerData.toggleFavorite({ id: 7, title: 'Seven', cover: '', format: 'TV', averageScore: null })
    const remote = {
      read: vi.fn(async () => ({ revision: null, snapshot: null })),
      write: vi.fn(async () => ({ revision: 'revision-1', partialFailures: ['preferences'] })),
      delete: vi.fn(async () => undefined),
    }
    const sync = createViewerSync(browserViewerData, remote)

    const result = await sync.sync()

    expect(result.partialFailures).toEqual(['preferences'])
    await expect(getViewerSyncStatus()).resolves.toMatchObject({ state: 'error', pendingChanges: expect.any(Number) })
  })
})

describe('AniList public-list import', () => {
  it('maps public list statuses and chooses a useful title and cover', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      data: {
        MediaListCollection: {
          lists: [{ entries: [
            { status: 'CURRENT', media: { id: 1, title: { romaji: 'Romaji', english: 'English', native: 'Native' }, coverImage: { large: 'large', medium: 'medium' }, format: 'TV', averageScore: 88 } },
            { status: 'DROPPED', media: { id: 2, title: { romaji: 'Dropped', english: null, native: null }, coverImage: { large: null, medium: 'medium-2' }, format: null, averageScore: null } },
          ] }],
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)

    await expect(importAniListPublicList('viewer')).resolves.toEqual([
      { id: 1, title: 'English', cover: 'large', format: 'TV', averageScore: 88, status: 'WATCHING' },
      { id: 2, title: 'Dropped', cover: 'medium-2', format: null, averageScore: null, status: 'DROPPED' },
    ])
    expect(fetch).toHaveBeenCalledOnce()
  })
})

function snapshot(overrides: Partial<ViewerExport> = {}): ViewerExport {
  return {
    source: 'animesource-viewer',
    version: 1,
    exportedAt: 1,
    profile: { displayName: '', updatedAt: 0 },
    preferences: { adultContent: false, language: 'en', timezone: 'UTC', notifications: false, updatedAt: 0 },
    favorites: [],
    continue: [],
    playback: [],
    playbackPreferences: { quality: null, audioLanguage: null, audioLabel: null, subtitleLanguage: null, subtitleLabel: null },
    preferredSource: null,
    preferredSourceUpdatedAt: 0,
    matches: [],
    searchHistory: [],
    tombstones: [],
    ...overrides,
  }
}
