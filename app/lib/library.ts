import type { AniListMedia } from '../data/anilist/types'
import type { ContinueItem, FavoriteItem, FavoriteStatus } from './persistence/schema'

export const LIBRARY_TABS = ['all', 'watching', 'completed', 'planning', 'paused', 'dropped', 'history'] as const
export type LibraryTab = (typeof LIBRARY_TABS)[number]

export const LIBRARY_SORTS = ['recent-added', 'recent-watched', 'title', 'score'] as const
export type LibrarySort = (typeof LIBRARY_SORTS)[number]

export const FAVORITE_STATUSES: readonly FavoriteStatus[] = [
  'WATCHING',
  'COMPLETED',
  'PLANNING',
  'PAUSED',
  'DROPPED',
]

export interface LibraryEntry {
  favorite: FavoriteItem
  media?: AniListMedia
  lastWatchedAt?: number
  unavailable?: boolean
}

export function isEntryUnavailable(entry: LibraryEntry, metadataLoaded: boolean): boolean {
  return metadataLoaded && entry.media === undefined
}

export function formatLastWatched(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp)
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  if (hours < 48) return 'Yesterday'

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} days ago`
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(timestamp))
}

export function filterAndSortLibrary(
  entries: readonly LibraryEntry[],
  options: { tab: LibraryTab; format: string; sort: LibrarySort },
): LibraryEntry[] {
  const filtered = entries.filter((entry) => {
    if (options.tab === 'history') return false
    const status = entry.favorite.status ?? 'PLANNING'
    if (options.tab === 'watching' && status !== 'WATCHING') return false
    if (options.tab === 'completed' && status !== 'COMPLETED') return false
    if (options.tab === 'planning' && status !== 'PLANNING') return false
    if (options.tab === 'paused' && status !== 'PAUSED') return false
    if (options.tab === 'dropped' && status !== 'DROPPED') return false
    if (options.format && (entry.media?.format ?? entry.favorite.format ?? '') !== options.format) return false
    return true
  })

  return [...filtered].sort((left, right) => {
    if (options.sort === 'recent-added') return right.favorite.ts - left.favorite.ts
    if (options.sort === 'recent-watched') {
      return (right.lastWatchedAt ?? 0) - (left.lastWatchedAt ?? 0) || right.favorite.ts - left.favorite.ts
    }
    if (options.sort === 'score') {
      const leftScore = left.media?.averageScore ?? left.favorite.averageScore ?? -1
      const rightScore = right.media?.averageScore ?? right.favorite.averageScore ?? -1
      return rightScore - leftScore
    }
    return libraryTitle(left).localeCompare(libraryTitle(right), undefined, { sensitivity: 'base' })
  })
}

export function libraryTitle(entry: LibraryEntry): string {
  return entry.media?.title?.english ?? entry.media?.title?.romaji ?? entry.favorite.title
}

export function libraryFormats(entries: readonly LibraryEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.media?.format ?? entry.favorite.format).filter((value): value is string => Boolean(value)))].sort()
}

export function playbackPercent(item: ContinueItem): number {
  if (!Number.isFinite(item.position) || !Number.isFinite(item.duration) || item.duration <= 0) return 0
  return Math.max(0, Math.min(100, (item.position / item.duration) * 100))
}

export function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remaining = String(total % 60).padStart(2, '0')
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${remaining}`
    : `${minutes}:${remaining}`
}
