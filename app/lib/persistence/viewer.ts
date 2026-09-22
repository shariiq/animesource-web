import { indexedDbStore } from './indexedDb'
import { browserSearchHistory, SEARCH_HISTORY_KEY } from './searchHistory'
import { notifySearchHistoryChanged } from '../search'
import { mergeViewerSnapshots } from './snapshot'
import type { CatalogMode } from '../catalog'
import {
  continueDoc,
  favoriteStorageKey,
  favoritesDoc,
  matchDoc,
  matchRecordDoc,
  prefSourceDoc,
  searchHistoryDoc,
  timestampDoc,
  type ContinueItem,
  type FavoriteItem,
  type FavoriteStatus,
  type MatchItem,
  type MatchRecord,
  playbackDoc,
  playbackPrefsDoc,
  viewerExportSchema,
  viewerPreferencesDoc,
  viewerProfileDoc,
  viewerTombstonesDoc,
  type PlaybackPreferences as PlaybackPreferenceValues,
  type PlaybackRecord,
  type ViewerExport,
  type ViewerPreferences,
  type ViewerProfile,
  type ViewerTombstone,
} from './schema'

const FAVORITES = 'favorites'
const CONTINUE = 'continue'
const PLAYBACK_PREFIX = 'playback:'
const PLAYBACK_PREFS = 'playbackPrefs'
const PREF_SOURCE = 'prefSource'
const PREF_SOURCE_UPDATED_AT = 'prefSourceUpdatedAt'
const MATCH_PREFIX = 'match:'
const VIEWER_PROFILE = 'viewerProfile'
const VIEWER_PREFERENCES = 'viewerPreferences'
const VIEWER_TOMBSTONES = 'viewerTombstones'

const VIEWER_SINGLETON_KEYS = [
  FAVORITES,
  CONTINUE,
  PLAYBACK_PREFS,
  PREF_SOURCE,
  PREF_SOURCE_UPDATED_AT,
  VIEWER_PROFILE,
  VIEWER_PREFERENCES,
  VIEWER_TOMBSTONES,
  SEARCH_HISTORY_KEY,
] as const

export type { ContinueItem, FavoriteItem, FavoriteStatus, MatchItem, PlaybackRecord, PlaybackPreferenceValues }
export type { ViewerExport, ViewerPreferences, ViewerProfile }

export interface FavoriteDraft {
  id: number
  catalogMode?: CatalogMode
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
  updateFavoriteStatus(id: number, status: FavoriteStatus, catalogMode?: CatalogMode): Promise<void>
  removeFavorite(id: number, catalogMode?: CatalogMode): Promise<void>
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

export interface ViewerData extends ViewerLibrary, SourcePreferences {
  getViewerProfile(): Promise<ViewerProfile>
  setViewerProfile(profile: Pick<ViewerProfile, 'displayName'>): Promise<void>
  getViewerPreferences(): Promise<ViewerPreferences>
  setViewerPreferences(preferences: Omit<ViewerPreferences, 'updatedAt'>): Promise<void>
  exportViewerData(): Promise<ViewerExport>
  importViewerData(snapshot: unknown, mode?: 'merge' | 'replace'): Promise<void>
  clearViewerData(): Promise<void>
}

const DEFAULT_PLAYBACK_PREFERENCES: PlaybackPreferenceValues = {
  quality: null,
  audioLanguage: null,
  audioLabel: null,
  subtitleLanguage: null,
  subtitleLabel: null,
}

const DEFAULT_VIEWER_PROFILE: ViewerProfile = {
  displayName: '',
  updatedAt: 0,
}

const DEFAULT_VIEWER_PREFERENCES: ViewerPreferences = {
  adultContent: false,
  catalogMode: 'ANIME',
  language: 'en',
  timezone: 'UTC',
  notifications: false,
  updatedAt: 0,
}

async function rememberTombstone(collection: ViewerTombstone['collection'], key: string): Promise<void> {
  await indexedDbStore.update(VIEWER_TOMBSTONES, 1, viewerTombstonesDoc, (current) => {
    const next = [
      { collection, key, ts: Date.now() },
      ...(current ?? []).filter((entry) => !(entry.collection === collection && entry.key === key)),
    ]
    return next.slice(0, 2_000)
  })
}

async function clearTombstone(collection: ViewerTombstone['collection'], key: string): Promise<void> {
  await indexedDbStore.update(VIEWER_TOMBSTONES, 1, viewerTombstonesDoc, (current) => (
    (current ?? []).filter((entry) => !(entry.collection === collection && entry.key === key))
  ))
}

async function getFavorites(): Promise<FavoriteItem[]> {
  return (await indexedDbStore.read(FAVORITES, favoritesDoc)) ?? []
}

async function setFavorites(items: FavoriteItem[]): Promise<void> {
  await indexedDbStore.write(FAVORITES, 1, items.slice(0, 300), favoritesDoc)
}

async function toggleFavorite(media: FavoriteDraft): Promise<boolean> {
  let isAdded = false
  const catalogMode = media.catalogMode ?? 'ANIME'
  await indexedDbStore.update(FAVORITES, 1, favoritesDoc, (current) => {
    const list = current ? [...current] : []
    const index = list.findIndex((item) => item.id === media.id && (item.catalogMode ?? 'ANIME') === catalogMode)
    if (index >= 0) {
      list.splice(index, 1)
      isAdded = false
      return list
    }
    list.unshift({ ...media, catalogMode, status: media.status ?? 'PLANNING', ts: Date.now() })
    isAdded = true
    return list.slice(0, 300)
  })
  const key = favoriteStorageKey(media.id, catalogMode)
  if (isAdded) await clearTombstone('favorites', key)
  else await rememberTombstone('favorites', key)
  return isAdded
}

async function updateFavoriteStatus(id: number, status: FavoriteStatus, catalogMode: CatalogMode = 'ANIME'): Promise<void> {
  await indexedDbStore.update(FAVORITES, 1, favoritesDoc, (current) => {
    const list = current ? [...current] : []
    const item = list.find((entry) => entry.id === id && (entry.catalogMode ?? 'ANIME') === catalogMode)
    if (!item) return list
    item.status = status
    item.ts = Date.now()
    return list
  })
}

async function removeFavorite(id: number, catalogMode: CatalogMode = 'ANIME'): Promise<void> {
  await indexedDbStore.update(FAVORITES, 1, favoritesDoc, (current) => {
    return (current ?? []).filter((item) => !(item.id === id && (item.catalogMode ?? 'ANIME') === catalogMode)).slice(0, 300)
  })
  await rememberTombstone('favorites', favoriteStorageKey(id, catalogMode))
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
  await clearTombstone('continue', String(draft.id))
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
  await clearTombstone('playback', `${item.id}:${item.episodeId}`)
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
  await clearTombstone('playback', `${progress.id}:${progress.episodeId}`)
  await clearTombstone('continue', String(progress.id))
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
  await clearTombstone('playback', `${id}:${episodeId}`)
  await clearTombstone('continue', String(id))
}

async function getPlaybackPreferences(): Promise<PlaybackPreferenceValues> {
  return (await indexedDbStore.read(PLAYBACK_PREFS, playbackPrefsDoc)) ?? DEFAULT_PLAYBACK_PREFERENCES
}

async function setPlaybackPreferences(preferences: PlaybackPreferenceValues): Promise<void> {
  await indexedDbStore.write(PLAYBACK_PREFS, 1, { ...preferences, updatedAt: Date.now() }, playbackPrefsDoc)
}

async function removeContinue(id: number): Promise<void> {
  await indexedDbStore.update(CONTINUE, 1, continueDoc, (current) => {
    return (current ?? []).filter((entry) => entry.id !== id).slice(0, 20)
  })
  await rememberTombstone('continue', String(id))
}

async function clearContinue(): Promise<void> {
  const current = await getContinue()
  await indexedDbStore.write(CONTINUE, 1, [], continueDoc)
  await Promise.all(current.map((entry) => rememberTombstone('continue', String(entry.id))))
}

async function getPlaybackRecords(): Promise<PlaybackRecord[]> {
  const keys = await indexedDbStore.keys(PLAYBACK_PREFIX)
  const records = await Promise.all(keys.map((key) => indexedDbStore.read(key, playbackDoc)))
  return records.filter((record): record is PlaybackRecord => record !== null).sort((left, right) => right.ts - left.ts)
}

async function getViewerMatches(): Promise<ViewerExport['matches']> {
  const keys = await indexedDbStore.keys(MATCH_PREFIX)
  const matches = await Promise.all(keys.map(async (key) => {
    const anilistId = Number(key.slice(MATCH_PREFIX.length))
    const stored = await readStoredMatch(key)
    if (!Number.isInteger(anilistId) || anilistId <= 0 || !stored) return null
    return { anilistId, match: stored.match, updatedAt: stored.updatedAt }
  }))
  return matches.filter((entry): entry is ViewerExport['matches'][number] => entry !== null)
}

async function readStoredMatch(key: string): Promise<MatchRecord | null> {
  const current = await indexedDbStore.read(key, matchRecordDoc)
  if (current) return current
  const legacy = await indexedDbStore.read(key, matchDoc)
  return legacy ? { match: legacy, updatedAt: 0 } : null
}

async function getViewerProfile(): Promise<ViewerProfile> {
  return (await indexedDbStore.read(VIEWER_PROFILE, viewerProfileDoc)) ?? DEFAULT_VIEWER_PROFILE
}

async function setViewerProfile(profile: Pick<ViewerProfile, 'displayName'>): Promise<void> {
  await indexedDbStore.write(VIEWER_PROFILE, 1, {
    displayName: profile.displayName.trim().slice(0, 80),
    updatedAt: Date.now(),
  }, viewerProfileDoc)
}

async function getViewerPreferences(): Promise<ViewerPreferences> {
  return (await indexedDbStore.read(VIEWER_PREFERENCES, viewerPreferencesDoc)) ?? DEFAULT_VIEWER_PREFERENCES
}

async function setViewerPreferences(preferences: Omit<ViewerPreferences, 'updatedAt'>): Promise<void> {
  await indexedDbStore.write(VIEWER_PREFERENCES, 1, {
    ...preferences,
    catalogMode: preferences.catalogMode,
    language: preferences.language.trim().slice(0, 20),
    timezone: preferences.timezone.trim().slice(0, 100),
    updatedAt: Date.now(),
  }, viewerPreferencesDoc)
}

async function getViewerExport(): Promise<ViewerExport> {
  const tombstones = (await indexedDbStore.read(VIEWER_TOMBSTONES, viewerTombstonesDoc)) ?? []
  return viewerExportSchema.parse({
    source: 'animesource-viewer',
    version: 1,
    exportedAt: Date.now(),
    profile: await getViewerProfile(),
    preferences: await getViewerPreferences(),
    favorites: await getFavorites(),
    continue: await getContinue(),
    playback: await getPlaybackRecords(),
    playbackPreferences: await getPlaybackPreferences(),
    preferredSource: await indexedDbStore.read(PREF_SOURCE, prefSourceDoc),
    preferredSourceUpdatedAt: (await indexedDbStore.read(PREF_SOURCE_UPDATED_AT, timestampDoc)) ?? 0,
    matches: await getViewerMatches(),
    searchHistory: await browserSearchHistory.get(),
    tombstones,
  })
}

async function writeViewerExport(snapshot: ViewerExport): Promise<void> {
  const writes = [
    { key: FAVORITES, version: 1, value: snapshot.favorites, schema: favoritesDoc },
    { key: CONTINUE, version: 1, value: snapshot.continue, schema: continueDoc },
    { key: PLAYBACK_PREFS, version: 1, value: snapshot.playbackPreferences, schema: playbackPrefsDoc },
    { key: VIEWER_PROFILE, version: 1, value: snapshot.profile, schema: viewerProfileDoc },
    { key: VIEWER_PREFERENCES, version: 1, value: snapshot.preferences, schema: viewerPreferencesDoc },
    { key: VIEWER_TOMBSTONES, version: 1, value: snapshot.tombstones, schema: viewerTombstonesDoc },
    { key: SEARCH_HISTORY_KEY, version: 1, value: snapshot.searchHistory, schema: searchHistoryDoc },
    ...(
      snapshot.preferredSource !== null
        ? [{ key: PREF_SOURCE, version: 1, value: snapshot.preferredSource, schema: prefSourceDoc }]
        : []
    ),
    ...(
      snapshot.preferredSourceUpdatedAt > 0
        ? [{ key: PREF_SOURCE_UPDATED_AT, version: 1, value: snapshot.preferredSourceUpdatedAt, schema: timestampDoc }]
        : []
    ),
    ...snapshot.playback.map((record) => ({
      key: playbackKey(record.id, record.episodeId),
      version: 1,
      value: record,
      schema: playbackDoc,
    })),
    ...snapshot.matches.map((entry) => ({
      key: MATCH_PREFIX + entry.anilistId,
      version: 2,
      value: { match: entry.match, updatedAt: entry.updatedAt },
      schema: matchRecordDoc,
    })),
  ]

  await indexedDbStore.replace({
    deleteKeys: VIEWER_SINGLETON_KEYS,
    deletePrefixes: [PLAYBACK_PREFIX, MATCH_PREFIX],
    writes,
  })
  notifySearchHistoryChanged()
}

async function importViewerData(snapshot: unknown, mode: 'merge' | 'replace' = 'merge'): Promise<void> {
  const parsed = viewerExportSchema.safeParse(snapshot)
  if (!parsed.success) throw new Error('The viewer data file is invalid or from an unsupported version.')
  const next = mode === 'merge'
    ? mergeViewerSnapshots(await getViewerExport(), parsed.data)
    : parsed.data
  await writeViewerExport(next)
}

async function clearViewerData(): Promise<void> {
  const keys = await indexedDbStore.keys()
  await Promise.all(keys.map((key) => indexedDbStore.remove(key)))
  await browserSearchHistory.clear()
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
  setPreferredSource: async (sourceId) => {
    await indexedDbStore.write(PREF_SOURCE, 1, sourceId, prefSourceDoc)
    await indexedDbStore.write(PREF_SOURCE_UPDATED_AT, 1, Date.now(), timestampDoc)
  },
  getSavedMatch: async (anilistId) => (await readStoredMatch(MATCH_PREFIX + anilistId))?.match ?? null,
  saveMatch: async (anilistId, match) => {
    await indexedDbStore.write(MATCH_PREFIX + anilistId, 2, { match, updatedAt: Date.now() }, matchRecordDoc)
    await clearTombstone('matches', String(anilistId))
  },
  clearSavedMatch: async (anilistId) => {
    await indexedDbStore.remove(MATCH_PREFIX + anilistId)
    await rememberTombstone('matches', String(anilistId))
  },
  getViewerProfile,
  setViewerProfile,
  getViewerPreferences,
  setViewerPreferences,
  exportViewerData: getViewerExport,
  importViewerData,
  clearViewerData,
}
