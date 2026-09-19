import { indexedDbStore } from './indexedDb'
import {
  continueDoc,
  favoritesDoc,
  matchDoc,
  prefSourceDoc,
  type ContinueItem,
  type FavoriteItem,
  type FavoriteStatus,
  type MatchItem,
  playbackDoc,
  playbackPrefsDoc,
  type PlaybackPreferences as PlaybackPreferenceValues,
  type PlaybackRecord,
} from './schema'

const FAVORITES = 'favorites'
const CONTINUE = 'continue'
const PLAYBACK_PREFIX = 'playback:'
const PLAYBACK_PREFS = 'playbackPrefs'
const PREF_SOURCE = 'prefSource'
const MATCH_PREFIX = 'match:'

export type { ContinueItem, FavoriteItem, FavoriteStatus, MatchItem, PlaybackRecord, PlaybackPreferenceValues }

export interface FavoriteDraft {
  id: number
  title: string
  cover: string
  format: string | null
  averageScore: number | null
  status?: FavoriteStatus
}

export interface ContinueDraft {
  id: number
  title: string
  cover: string
  sourceId: string
  sourceName: string
  animeId: string
  episodeId: string
  episodeNumber: number
}

export interface PlaybackProgress {
  id: number
  episodeId: string
  position: number
  duration: number
}

export interface PlaybackDraft extends PlaybackProgress {
  title: string
  cover: string
  sourceId: string
  sourceName: string
  animeId: string
  episodeNumber: number
}

export function isPlaybackComplete(position: number, duration: number): boolean {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position) || position <= 0) {
    return false
  }
  const ratioComplete = position / duration >= 0.88
  const tailComplete = duration > 90 && position >= duration - 90
  return ratioComplete || tailComplete
}

export interface ViewerLibrary {
  getFavorites(): Promise<FavoriteItem[]>
  setFavorites(items: FavoriteItem[]): Promise<void>
  toggleFavorite(media: FavoriteDraft): Promise<boolean>
  updateFavoriteStatus(id: number, status: FavoriteStatus): Promise<void>
  removeFavorite(id: number): Promise<void>
  getContinue(): Promise<ContinueItem[]>
  recordContinue(item: ContinueDraft): Promise<void>
  getPlaybackRecord(id: number, episodeId: string): Promise<PlaybackRecord | null>
  recordPlayback(item: PlaybackDraft): Promise<void>
  updateProgress(progress: PlaybackProgress): Promise<void>
  markEpisodeComplete(id: number, episodeId: string): Promise<void>
  removeContinue(id: number): Promise<void>
  getPlaybackPreferences(): Promise<PlaybackPreferenceValues>
  setPlaybackPreferences(preferences: PlaybackPreferenceValues): Promise<void>
  clearContinue(): Promise<void>
}

export interface SourcePreferences {
  getPreferredSource(): Promise<string | null>
  setPreferredSource(sourceId: string): Promise<void>
  getSavedMatch(anilistId: number): Promise<MatchItem | null>
  saveMatch(anilistId: number, match: MatchItem): Promise<void>
  clearSavedMatch(anilistId: number): Promise<void>
}

export interface ViewerData extends ViewerLibrary, SourcePreferences {}

async function getFavorites(): Promise<FavoriteItem[]> {
  return (await indexedDbStore.read(FAVORITES, favoritesDoc)) ?? []
}

async function setFavorites(items: FavoriteItem[]): Promise<void> {
  await indexedDbStore.write(FAVORITES, 1, items.slice(0, 300), favoritesDoc)
}

async function toggleFavorite(media: FavoriteDraft): Promise<boolean> {
  let isAdded = false
  await indexedDbStore.update(FAVORITES, 1, favoritesDoc, (current) => {
    const list = current ? [...current] : []
    const index = list.findIndex((item) => item.id === media.id)
    if (index >= 0) {
      list.splice(index, 1)
      isAdded = false
      return list
    }
    list.unshift({ ...media, status: media.status ?? 'PLANNING', ts: Date.now() })
    isAdded = true
    return list.slice(0, 300)
  })
  return isAdded
}

async function updateFavoriteStatus(id: number, status: FavoriteStatus): Promise<void> {
  await indexedDbStore.update(FAVORITES, 1, favoritesDoc, (current) => {
    const list = current ? [...current] : []
    const item = list.find((entry) => entry.id === id)
    if (!item) return list
    item.status = status
    return list
  })
}

async function removeFavorite(id: number): Promise<void> {
  await indexedDbStore.update(FAVORITES, 1, favoritesDoc, (current) => {
    return (current ?? []).filter((item) => item.id !== id).slice(0, 300)
  })
}

async function getContinue(): Promise<ContinueItem[]> {
  return (await indexedDbStore.read(CONTINUE, continueDoc)) ?? []
}

async function recordContinue(draft: ContinueDraft): Promise<void> {
  await indexedDbStore.update(CONTINUE, 1, continueDoc, (current) => {
    const existing = (current ?? []).find((entry) => entry.id === draft.id)
    const sameEpisode = existing?.episodeId === draft.episodeId
    const next: ContinueItem = {
      ...draft,
      position: sameEpisode ? (existing?.position ?? 0) : 0,
      duration: sameEpisode ? (existing?.duration ?? 0) : 0,
      completed: sameEpisode ? (existing?.completed ?? false) : false,
      ts: Date.now(),
    }
    return [next, ...(current ?? []).filter((entry) => entry.id !== draft.id)].slice(0, 20)
  })
}

function playbackKey(id: number, episodeId: string): string {
  return `${PLAYBACK_PREFIX}${id}:${episodeId}`
}

async function getPlaybackRecord(id: number, episodeId: string): Promise<PlaybackRecord | null> {
  const stored = await indexedDbStore.read(playbackKey(id, episodeId), playbackDoc)
  if (stored) return stored
  const current = await getContinue()
  const legacy = current.find((entry) => entry.id === id && entry.episodeId === episodeId)
  if (!legacy) return null
  return {
    ...legacy,
    completedAt: legacy.completed ? legacy.ts : null,
  }
}

async function recordPlayback(item: PlaybackDraft): Promise<void> {
  const now = Date.now()
  await indexedDbStore.update(playbackKey(item.id, item.episodeId), 1, playbackDoc, (current) => ({
    id: item.id,
    title: item.title,
    cover: item.cover,
    sourceId: item.sourceId,
    sourceName: item.sourceName,
    animeId: item.animeId,
    episodeId: item.episodeId,
    episodeNumber: item.episodeNumber,
    position: current?.position ?? 0,
    duration: current?.duration ?? 0,
    completed: current?.completed ?? false,
    completedAt: current?.completedAt ?? null,
    ts: now,
  }))
}

async function updateProgress(progress: PlaybackProgress): Promise<void> {
  const currentRecord = await getPlaybackRecord(progress.id, progress.episodeId)
  if (currentRecord) {
    const safeDuration = Number.isFinite(progress.duration) && progress.duration > 0 ? progress.duration : currentRecord.duration
    const safePosition = Number.isFinite(progress.position) && progress.position >= 0 ? progress.position : currentRecord.position
    const completed = currentRecord.completed || isPlaybackComplete(safePosition, safeDuration)
    await indexedDbStore.write(playbackKey(progress.id, progress.episodeId), 1, {
      ...currentRecord,
      position: safePosition,
      duration: safeDuration,
      completed,
      completedAt: completed ? (currentRecord.completedAt ?? Date.now()) : null,
      ts: Date.now(),
    }, playbackDoc)
  }

  await indexedDbStore.update(CONTINUE, 1, continueDoc, (current) => {
    const list = current ?? []
    const index = list.findIndex((entry) => entry.id === progress.id && entry.episodeId === progress.episodeId)
    if (index < 0) return list

    const existing = list[index]!
    const safeDuration = Number.isFinite(progress.duration) && progress.duration > 0 ? progress.duration : existing.duration
    const safePosition = Number.isFinite(progress.position) && progress.position >= 0 ? progress.position : existing.position
    const completed = existing.completed || isPlaybackComplete(safePosition, safeDuration)
    const updated: ContinueItem = { ...existing, position: safePosition, duration: safeDuration, completed, ts: Date.now() }
    return [updated, ...list.filter((_, i) => i !== index)].slice(0, 20)
  })
}

async function markEpisodeComplete(id: number, episodeId: string): Promise<void> {
  const currentRecord = await getPlaybackRecord(id, episodeId)
  if (currentRecord) {
    await indexedDbStore.write(playbackKey(id, episodeId), 1, {
      ...currentRecord,
      completed: true,
      completedAt: currentRecord.completedAt ?? Date.now(),
      ts: Date.now(),
    }, playbackDoc)
  }
  await indexedDbStore.update(CONTINUE, 1, continueDoc, (current) => {
    const list = current ?? []
    const index = list.findIndex((entry) => entry.id === id && entry.episodeId === episodeId)
    if (index < 0) return list
    const updated: ContinueItem = { ...list[index]!, completed: true, ts: Date.now() }
    return [updated, ...list.filter((_, i) => i !== index)].slice(0, 20)
  })
}

async function getPlaybackPreferences(): Promise<PlaybackPreferenceValues> {
  return (await indexedDbStore.read(PLAYBACK_PREFS, playbackPrefsDoc)) ?? {
    quality: null,
    subtitleLanguage: null,
    subtitleLabel: null,
  }
}

async function setPlaybackPreferences(preferences: PlaybackPreferenceValues): Promise<void> {
  await indexedDbStore.write(PLAYBACK_PREFS, 1, preferences, playbackPrefsDoc)
}

async function removeContinue(id: number): Promise<void> {
  await indexedDbStore.update(CONTINUE, 1, continueDoc, (current) => {
    return (current ?? []).filter((entry) => entry.id !== id).slice(0, 20)
  })
}

async function clearContinue(): Promise<void> {
  await indexedDbStore.write(CONTINUE, 1, [], continueDoc)
}

export const browserViewerData: ViewerData = {
  getFavorites,
  setFavorites,
  toggleFavorite,
  updateFavoriteStatus,
  removeFavorite,
  getContinue,
  recordContinue,
  getPlaybackRecord,
  recordPlayback,
  updateProgress,
  markEpisodeComplete,
  removeContinue,
  clearContinue,
  getPlaybackPreferences,
  setPlaybackPreferences,
  getPreferredSource: () => indexedDbStore.read(PREF_SOURCE, prefSourceDoc),
  setPreferredSource: (sourceId) => indexedDbStore.write(PREF_SOURCE, 1, sourceId, prefSourceDoc),
  getSavedMatch: (anilistId) => indexedDbStore.read(MATCH_PREFIX + anilistId, matchDoc),
  saveMatch: (anilistId, match) => indexedDbStore.write(MATCH_PREFIX + anilistId, 1, match, matchDoc),
  clearSavedMatch: (anilistId) => indexedDbStore.remove(MATCH_PREFIX + anilistId),
}
