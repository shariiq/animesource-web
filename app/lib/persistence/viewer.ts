import { indexedDbStore } from './indexedDb'
import {
  continueDoc,
  favoritesDoc,
  matchDoc,
  prefSourceDoc,
  type ContinueItem,
  type FavoriteItem,
  type MatchItem,
} from './schema'

const FAVORITES = 'favorites'
const CONTINUE = 'continue'
const PREF_SOURCE = 'prefSource'
const MATCH_PREFIX = 'match:'

export type { ContinueItem, FavoriteItem, MatchItem }

export interface FavoriteDraft {
  id: number
  title: string
  cover: string
  format: string | null
  averageScore: number | null
}

export interface ViewerLibrary {
  getFavorites(): Promise<FavoriteItem[]>
  setFavorites(items: FavoriteItem[]): Promise<void>
  toggleFavorite(media: FavoriteDraft): Promise<boolean>
  getContinue(): Promise<ContinueItem[]>
  recordContinue(item: ContinueItem): Promise<void>
}

export interface PlaybackPreferences {
  getPreferredSource(): Promise<string | null>
  setPreferredSource(sourceId: string): Promise<void>
  getSavedMatch(anilistId: number): Promise<MatchItem | null>
  saveMatch(anilistId: number, match: MatchItem): Promise<void>
  clearSavedMatch(anilistId: number): Promise<void>
}

export interface ViewerData extends ViewerLibrary, PlaybackPreferences {}

async function getFavorites(): Promise<FavoriteItem[]> {
  return (await indexedDbStore.read(FAVORITES, favoritesDoc)) ?? []
}

async function setFavorites(items: FavoriteItem[]): Promise<void> {
  await indexedDbStore.write(FAVORITES, 1, items.slice(0, 300), favoritesDoc)
}

async function toggleFavorite(media: FavoriteDraft): Promise<boolean> {
  const list = await getFavorites()
  const index = list.findIndex((item) => item.id === media.id)
  if (index >= 0) {
    list.splice(index, 1)
    await setFavorites(list)
    return false
  }
  list.unshift({ ...media, ts: Date.now() })
  await setFavorites(list)
  return true
}

async function getContinue(): Promise<ContinueItem[]> {
  return (await indexedDbStore.read(CONTINUE, continueDoc)) ?? []
}

async function recordContinue(item: ContinueItem): Promise<void> {
  const list = (await getContinue()).filter((entry) => entry.id !== item.id)
  list.unshift({ ...item, ts: Date.now() })
  await indexedDbStore.write(CONTINUE, 1, list.slice(0, 20), continueDoc)
}

export const browserViewerData: ViewerData = {
  getFavorites,
  setFavorites,
  toggleFavorite,
  getContinue,
  recordContinue,
  getPreferredSource: () => indexedDbStore.read(PREF_SOURCE, prefSourceDoc),
  setPreferredSource: (sourceId) => indexedDbStore.write(PREF_SOURCE, 1, sourceId, prefSourceDoc),
  getSavedMatch: (anilistId) => indexedDbStore.read(MATCH_PREFIX + anilistId, matchDoc),
  saveMatch: (anilistId, match) => indexedDbStore.write(MATCH_PREFIX + anilistId, 1, match, matchDoc),
  clearSavedMatch: (anilistId) => indexedDbStore.remove(MATCH_PREFIX + anilistId),
}
