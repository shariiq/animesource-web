import { beforeEach, describe, expect, it } from 'vitest'
import { closeDb } from '../app/lib/persistence/indexedDb'
import { browserSearchHistory } from '../app/lib/persistence/searchHistory'
import { browserViewerData } from '../app/lib/persistence/viewer'

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
    const items = Array.from({ length: 320 }, (_, i) => ({ id: i, title: `Anime ${i}`, cover: '', format: null, averageScore: null, ts: Date.now() }))
    await browserViewerData.setFavorites(items)
    const stored = await browserViewerData.getFavorites()
    expect(stored).toHaveLength(300)
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
    ts: Date.now(),
  }
}
