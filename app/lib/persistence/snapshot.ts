import type {
  ContinueItem,
  FavoriteItem,
  PlaybackRecord,
  ViewerExport,
  ViewerMatchExport,
  ViewerTombstone,
} from './schema'
import { favoriteStorageKey } from './schema'

type Syncable = { ts: number }

function mergeRecords<T extends Syncable>(
  local: T[],
  remote: T[],
  key: (record: T) => string,
): T[] {
  const merged = new Map<string, T>()
  for (const record of remote) merged.set(key(record), record)
  for (const record of local) {
    const existing = merged.get(key(record))
    if (!existing || record.ts >= existing.ts) merged.set(key(record), record)
  }
  return [...merged.values()].sort((left, right) => right.ts - left.ts)
}

function mergeMatches(local: ViewerMatchExport[], remote: ViewerMatchExport[]): ViewerMatchExport[] {
  const merged = new Map<number, ViewerMatchExport>()
  for (const record of remote) merged.set(record.anilistId, record)
  for (const record of local) {
    const existing = merged.get(record.anilistId)
    if (!existing || record.updatedAt >= existing.updatedAt) merged.set(record.anilistId, record)
  }
  return [...merged.values()].sort((left, right) => right.updatedAt - left.updatedAt)
}

function mergeSearchHistory(local: ViewerExport['searchHistory'], remote: ViewerExport['searchHistory']) {
  const merged = new Map<string, ViewerExport['searchHistory'][number]>()
  for (const item of remote) merged.set(item.query.toLocaleLowerCase(), item)
  for (const item of local) {
    const key = item.query.toLocaleLowerCase()
    const existing = merged.get(key)
    if (!existing || item.ts >= existing.ts) merged.set(key, item)
  }
  return [...merged.values()].sort((left, right) => right.ts - left.ts).slice(0, 8)
}

function mergeTombstones(local: ViewerTombstone[], remote: ViewerTombstone[]): ViewerTombstone[] {
  const merged = new Map<string, ViewerTombstone>()
  for (const tombstone of remote) merged.set(`${tombstone.collection}:${tombstone.key}`, tombstone)
  for (const tombstone of local) {
    const key = `${tombstone.collection}:${tombstone.key}`
    const existing = merged.get(key)
    if (!existing || tombstone.ts >= existing.ts) merged.set(key, tombstone)
  }
  return [...merged.values()].sort((left, right) => right.ts - left.ts).slice(0, 2_000)
}

function withoutDeleted<T>(items: T[], tombstones: ViewerTombstone[], collection: ViewerTombstone['collection'], key: (item: T) => string, updatedAt: (item: T) => number): T[] {
  return items.filter((item) => {
    const tombstone = tombstones.find((entry) => entry.collection === collection && entry.key === key(item))
    return !tombstone || updatedAt(item) > tombstone.ts
  })
}

function newest<T>(local: T, remote: T, updatedAt: (value: T) => number): T {
  return updatedAt(local) >= updatedAt(remote) ? local : remote
}

/**
 * Merges two viewer snapshots with record-level last-write-wins semantics.
 * Local data wins an exact timestamp tie, while tombstones win over records
 * at the same timestamp so offline deletions cannot silently reappear.
 */
export function mergeViewerSnapshots(local: ViewerExport, remote: ViewerExport): ViewerExport {
  const tombstones = mergeTombstones(local.tombstones, remote.tombstones)
  const favorites = withoutDeleted(
    mergeRecords<FavoriteItem>(local.favorites, remote.favorites, (item) => favoriteStorageKey(item.id, item.catalogMode)),
    tombstones,
    'favorites',
    (item) => favoriteStorageKey(item.id, item.catalogMode),
    (item) => item.ts,
  )
  const continued = withoutDeleted(
    mergeRecords<ContinueItem>(local.continue, remote.continue, (item) => String(item.id)),
    tombstones,
    'continue',
    (item) => String(item.id),
    (item) => item.ts,
  )
  const playback = withoutDeleted(
    mergeRecords<PlaybackRecord>(local.playback, remote.playback, (item) => `${item.id}:${item.episodeId}`),
    tombstones,
    'playback',
    (item) => `${item.id}:${item.episodeId}`,
    (item) => item.ts,
  )
  const matches = withoutDeleted(
    mergeMatches(local.matches, remote.matches),
    tombstones,
    'matches',
    (item) => String(item.anilistId),
    (item) => item.updatedAt,
  )

  return {
    source: 'animesource-viewer',
    version: 1,
    exportedAt: Math.max(local.exportedAt, remote.exportedAt),
    profile: newest(local.profile, remote.profile, (value) => value.updatedAt),
    preferences: newest(local.preferences, remote.preferences, (value) => value.updatedAt),
    favorites,
    continue: continued,
    playback,
    playbackPreferences: newest(
      local.playbackPreferences,
      remote.playbackPreferences,
      (value) => value.updatedAt ?? 0,
    ),
    preferredSource: local.preferredSourceUpdatedAt >= remote.preferredSourceUpdatedAt ? local.preferredSource : remote.preferredSource,
    preferredSourceUpdatedAt: Math.max(local.preferredSourceUpdatedAt, remote.preferredSourceUpdatedAt),
    matches,
    searchHistory: mergeSearchHistory(local.searchHistory, remote.searchHistory),
    tombstones,
  }
}
