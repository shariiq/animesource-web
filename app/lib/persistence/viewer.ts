import { indexedDbStore } from './indexedDb'
import { browserSearchHistory } from './searchHistory'
import { mergeViewerSnapshots } from './snapshot'
import {
  continueDoc,
  favoritesDoc,
  matchDoc,
  prefSourceDoc,
  timestampDoc,
  type ContinueItem,
  type FavoriteItem,
  type FavoriteStatus,
  type MatchItem,
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

export type { ContinueItem, FavoriteItem, FavoriteStatus, MatchItem, PlaybackRecord, PlaybackPreferenceValues }
export type { ViewerExport, ViewerPreferences, ViewerProfile }

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
  subtitleLanguage: null,
  subtitleLabel: null,
}

const DEFAULT_VIEWER_PROFILE: ViewerProfile = {
  displayName: '',
  updatedAt: 0,
}

const DEFAULT_VIEWER_PREFERENCES: ViewerPreferences = {
  adultContent: false,
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
  if (isAdded) await clearTombstone('favorites', String(media.id))
  else await rememberTombstone('favorites', String(media.id))
  return isAdded
}

async function updateFavoriteStatus(id: number, status: FavoriteStatus): Promise<void> {
  await indexedDbStore.update(FAVORITES, 1, favoritesDoc, (current) => {
    const list = current ? [...current] : []
    const item = list.find((entry) => entry.id === id)
    if (!item) return list
    item.status = status
    item.ts = Date.now()
    return list
  })
}

async function removeFavorite(id: number): Promise<void> {
  await indexedDbStore.update(FAVORITES, 1, favoritesDoc, (current) => {
    return (current ?? []).filter((item) => item.id !== id).slice(0, 300)
  })
  await rememberTombstone('favorites', String(id))
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
    const match = await indexedDbStore.read(key, matchDoc)
    if (!Number.isInteger(anilistId) || anilistId <= 0 || !match) return null
    return { anilistId, match, updatedAt: 0 }
  }))
  return matches.filter((entry): entry is ViewerExport['matches'][number] => entry !== null)
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
  await indexedDbStore.write(FAVORITES, 1, snapshot.favorites, favoritesDoc)
  await indexedDbStore.write(CONTINUE, 1, snapshot.continue, continueDoc)
  await indexedDbStore.write(PLAYBACK_PREFS, 1, snapshot.playbackPreferences, playbackPrefsDoc)
  await indexedDbStore.write(VIEWER_PROFILE, 1, snapshot.profile, viewerProfileDoc)
  await indexedDbStore.write(VIEWER_PREFERENCES, 1, snapshot.preferences, viewerPreferencesDoc)
  await indexedDbStore.write(VIEWER_TOMBSTONES, 1, snapshot.tombstones, viewerTombstonesDoc)
  if (snapshot.preferredSource) await indexedDbStore.write(PREF_SOURCE, 1, snapshot.preferredSource, prefSourceDoc)
  else await indexedDbStore.remove(PREF_SOURCE)
  if (snapshot.preferredSourceUpdatedAt > 0) await indexedDbStore.write(PREF_SOURCE_UPDATED_AT, 1, snapshot.preferredSourceUpdatedAt, timestampDoc)
  else await indexedDbStore.remove(PREF_SOURCE_UPDATED_AT)

  const existingPlaybackKeys = await indexedDbStore.keys(PLAYBACK_PREFIX)
  await Promise.all(existingPlaybackKeys.map((key) => indexedDbStore.remove(key)))
  await Promise.all(snapshot.playback.map((record) => indexedDbStore.write(
    playbackKey(record.id, record.episodeId),
    1,
    record,
    playbackDoc,
  )))

  const existingMatchKeys = await indexedDbStore.keys(MATCH_PREFIX)
  await Promise.all(existingMatchKeys.map((key) => indexedDbStore.remove(key)))
  await Promise.all(snapshot.matches.map((entry) => indexedDbStore.write(
    MATCH_PREFIX + entry.anilistId,
    1,
    entry.match,
    matchDoc,
  )))

  await browserSearchHistory.replace(snapshot.searchHistory)
}

async function importViewerData(snapshot: unknown, mode: 'merge' | 'replace' = 'merge'): Promise<void> {
  const parsed = viewerExportSchema.safeParse(snapshot)
  if (!parsed.success) throw new Error('The viewer data file is invalid or from an unsupported version.')
  const next = mode === 'merge'
    ? mergeViewerSnapshots(await getViewerExport(), parsed.data)
    : parsed.data
  if (mode === 'replace') await clearViewerData()
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
  getSavedMatch: (anilistId) => indexedDbStore.read(MATCH_PREFIX + anilistId, matchDoc),
  saveMatch: async (anilistId, match) => {
    await indexedDbStore.write(MATCH_PREFIX + anilistId, 1, match, matchDoc)
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
