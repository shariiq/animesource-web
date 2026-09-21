import { beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../app/lib/persistence/indexedDb'
import { browserSearchHistory } from '../app/lib/persistence/searchHistory'
import { browserViewerData, isPlaybackComplete } from '../app/lib/persistence/viewer'

beforeEach(async () => {
  // Start each test from a clean database: release any cached connection, then
  // swap in a fresh IDBFactory so stores are empty and isolated per test.
  await closeDb()
  // eslint-disable-next-line no-global-assign -- intentional per-test isolation of the jsdom IndexedDB global
  indexedDB = new IDBFactory()
})

describe('persistence store', () => {
  it('round-trips favorites and toggles them off', async () => {
    const media = { id: 1, title: 'Test Anime', cover: '', format: 'TV', averageScore: 80 }
    await expect(browserViewerData.toggleFavorite(media)).resolves.toBe(true)
    await expect(browserViewerData.getFavorites()).resolves.toHaveLength(1)
    await expect(browserViewerData.toggleFavorite(media)).resolves.toBe(false)
    await expect(browserViewerData.getFavorites()).resolves.toHaveLength(0)
  })
  it('caps favorites at 300 entries', async () => {
    const items = Array.from({ length: 320 }, (_, i) => ({ id: i, title: `Anime ${i}`, cover: '', format: null, averageScore: null, status: 'PLANNING' as const, ts: Date.now() }))
    await browserViewerData.setFavorites(items)
    const stored = await browserViewerData.getFavorites()
    expect(stored).toHaveLength(300)
  })
  it('updates favorite status and removes favorite by id', async () => {
    const media = { id: 10, title: 'Status Test', cover: '', format: 'TV', averageScore: 85 }
    await browserViewerData.toggleFavorite(media)
    await browserViewerData.updateFavoriteStatus(10, 'WATCHING')
    let favorites = await browserViewerData.getFavorites()
    expect(favorites[0]?.status).toBe('WATCHING')

    await browserViewerData.updateFavoriteStatus(10, 'COMPLETED')
    favorites = await browserViewerData.getFavorites()
    expect(favorites[0]?.status).toBe('COMPLETED')

    await browserViewerData.removeFavorite(10)
    favorites = await browserViewerData.getFavorites()
    expect(favorites).toHaveLength(0)
  })
  it('keeps Anime and Manga favorites with the same AniList id separate', async () => {
    await browserViewerData.toggleFavorite({ id: 42, title: 'Anime 42', cover: '', format: 'TV', averageScore: null, catalogMode: 'ANIME' })
    await browserViewerData.toggleFavorite({ id: 42, title: 'Manga 42', cover: '', format: 'MANGA', averageScore: null, catalogMode: 'MANGA' })

    await browserViewerData.updateFavoriteStatus(42, 'WATCHING', 'MANGA')
    expect(await browserViewerData.getFavorites()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 42, title: 'Anime 42', catalogMode: 'ANIME', status: 'PLANNING' }),
      expect.objectContaining({ id: 42, title: 'Manga 42', catalogMode: 'MANGA', status: 'WATCHING' }),
    ]))

    await browserViewerData.removeFavorite(42, 'MANGA')
    await expect(browserViewerData.getFavorites()).resolves.toEqual([
      expect.objectContaining({ id: 42, title: 'Anime 42', catalogMode: 'ANIME' }),
    ])
  })
  it('records continue-watching entries newest-first and dedupes by media id', async () => {
    await browserViewerData.recordContinue(continueItem(1, 'ep-1', 1))
    await browserViewerData.recordContinue(continueItem(2, 'ep-9', 9))
    await browserViewerData.recordContinue(continueItem(1, 'ep-5', 5))
    const list = await browserViewerData.getContinue()
    expect(list.map((entry) => entry.id)).toEqual([1, 2])
    expect(list[0]?.episodeNumber).toBe(5)
  })
  it('caps continue-watching at 20 entries', async () => {
    for (let i = 0; i < 25; i++) await browserViewerData.recordContinue(continueItem(i, `ep-${i}`, i))
    await expect(browserViewerData.getContinue()).resolves.toHaveLength(20)
  })
  it('defaults draft progress, preserves the same episode, and resets a new episode', async () => {
    await browserViewerData.recordContinue(continueItem(1, 'ep-1', 1))
    let stored = await browserViewerData.getContinue()
    expect(stored[0]).toMatchObject({ position: 0, duration: 0, completed: false })

    await browserViewerData.updateProgress({ id: 1, episodeId: 'ep-1', position: 240, duration: 1200 })
    await browserViewerData.recordContinue({
      ...continueItem(1, 'ep-1', 1),
      sourceId: 'server-b',
      sourceName: 'Backup',
    })
    stored = await browserViewerData.getContinue()
    expect(stored[0]).toMatchObject({
      sourceId: 'server-b',
      position: 240,
      duration: 1200,
      completed: false,
    })

    await browserViewerData.recordContinue(continueItem(1, 'ep-2', 2))
    stored = await browserViewerData.getContinue()
    expect(stored[0]).toMatchObject({
      episodeId: 'ep-2',
      position: 0,
      duration: 0,
      completed: false,
    })
  })
  it('serializes overlapping continue-watching updates without dropping records', async () => {
    await Promise.all([
      browserViewerData.recordContinue(continueItem(1, 'ep-1', 1)),
      browserViewerData.recordContinue(continueItem(2, 'ep-2', 2)),
    ])
    const stored = await browserViewerData.getContinue()
    expect(stored.map((entry) => entry.id).sort((a, b) => a - b)).toEqual([1, 2])
  })
  it('updates playback progress and marks completion via completion threshold', async () => {
    await browserViewerData.recordContinue(continueItem(1, 'ep-1', 1))
    await browserViewerData.updateProgress({ id: 1, episodeId: 'ep-1', position: 100, duration: 1000 })
    let list = await browserViewerData.getContinue()
    expect(list[0]?.position).toBe(100)
    expect(list[0]?.duration).toBe(1000)
    expect(list[0]?.completed).toBe(false)

    // Position exceeds 88% ratio threshold
    await browserViewerData.updateProgress({ id: 1, episodeId: 'ep-1', position: 890, duration: 1000 })
    list = await browserViewerData.getContinue()
    expect(list[0]?.completed).toBe(true)

    // Explicit complete mark
    await browserViewerData.recordContinue(continueItem(2, 'ep-2', 2))
    await browserViewerData.markEpisodeComplete(2, 'ep-2')
    list = await browserViewerData.getContinue()
    expect(list.find((e) => e.id === 2)?.completed).toBe(true)

    // Remove single and clear all
    await browserViewerData.removeContinue(1)
    list = await browserViewerData.getContinue()
    expect(list.map((e) => e.id)).toEqual([2])

    await browserViewerData.clearContinue()
    await expect(browserViewerData.getContinue()).resolves.toEqual([])
  })
  it('correctly calculates playback completion thresholds', () => {
    expect(isPlaybackComplete(0, 0)).toBe(false)
    expect(isPlaybackComplete(88, 100)).toBe(true)
    expect(isPlaybackComplete(87, 1000)).toBe(false)
    expect(isPlaybackComplete(410, 500)).toBe(true) // duration - 90s tail threshold
    expect(isPlaybackComplete(400, 500)).toBe(false)
  })
  it('round-trips saved matches and preferred source, and clears matches', async () => {
    await browserViewerData.saveMatch(42, { sourceId: 'src', animeId: 'anime-42', title: 'Matched Title' })
    await expect(browserViewerData.getSavedMatch(42)).resolves.toEqual({ sourceId: 'src', animeId: 'anime-42', title: 'Matched Title' })
    await browserViewerData.clearSavedMatch(42)
    await expect(browserViewerData.getSavedMatch(42)).resolves.toBeNull()
    await browserViewerData.setPreferredSource('preferred')
    await expect(browserViewerData.getPreferredSource()).resolves.toBe('preferred')
  })
  it('stores recent searches newest-first, case-insensitively deduped, and clearable', async () => {
    await browserSearchHistory.record('Frieren')
    await browserSearchHistory.record('Cowboy Bebop')
    await browserSearchHistory.record(' frieren ')
    for (let index = 0; index < 10; index += 1) await browserSearchHistory.record(`Anime ${index}`)

    const history = await browserSearchHistory.get()
    expect(history).toHaveLength(8)
    expect(history[0]?.query).toBe('Anime 9')
    expect(history.some((item) => item.query.toLocaleLowerCase() === 'frieren')).toBe(false)

    await browserSearchHistory.clear()
    await expect(browserSearchHistory.get()).resolves.toEqual([])
  })
  it('rejects corrupted stored payloads by returning null', async () => {
    await browserViewerData.saveMatch(42, { sourceId: 'src', animeId: 'a', title: 't' })
    // Corrupt the stored record underneath the schema.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('anisource-web', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite')
      tx.objectStore('kv').put({ v: 99, data: 'wrong shape' }, 'match:42')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    await expect(browserViewerData.getSavedMatch(42)).resolves.toBeNull()
  })
  it('migrates legacy favorites by defaulting missing status to PLANNING', async () => {
    // Ensure the database and kv store exist first
    await browserViewerData.getFavorites()
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('anisource-web', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite')
      // Write legacy v1 structure without status field
      tx.objectStore('kv').put({
        v: 1,
        data: [{ id: 999, title: 'Legacy Anime', cover: '', format: null, averageScore: null, ts: 100 }],
      }, 'favorites')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })

    const favorites = await browserViewerData.getFavorites()
    expect(favorites).toHaveLength(1)
    expect(favorites[0]?.status).toBe('PLANNING')
  })
})

function continueItem(id: number, episodeId: string, episodeNumber: number) {
  return {
    id,
    title: `Anime ${id}`,
    cover: '',
    sourceId: 'src',
    sourceName: 'Source',
    animeId: `anime-${id}`,
    episodeId,
    episodeNumber,
  }
}
