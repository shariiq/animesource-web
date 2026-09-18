import { describe, expect, it } from 'vitest'
import type { AniListMedia } from '../app/data/anilist/types'
import {
  filterAndSortLibrary,
  formatLastWatched,
  formatPlaybackTime,
  isEntryUnavailable,
  libraryFormats,
  playbackPercent,
  type LibraryEntry,
} from '../app/lib/library'
import type { ContinueItem, FavoriteItem } from '../app/lib/persistence/schema'

function favorite(id: number, status: FavoriteItem['status'], ts: number): FavoriteItem {
  return { id, title: `Stored ${id}`, cover: '', format: id === 3 ? 'MOVIE' : 'TV', averageScore: 60 + id, status, ts }
}

function media(id: number, title: string, score: number): AniListMedia {
  return {
    id,
    type: 'ANIME',
    siteUrl: null,
    title: { english: title, romaji: title, native: null },
    coverImage: null,
    bannerImage: null,
    averageScore: score,
    meanScore: score,
    popularity: null,
    favourites: null,
    trending: null,
    format: id === 3 ? 'MOVIE' : 'TV',
    status: 'FINISHED',
    episodes: 12,
    season: null,
    seasonYear: null,
    genres: [],
    countryOfOrigin: null,
    isAdult: false,
    nextAiringEpisode: null,
  }
}

const entries: LibraryEntry[] = [
  { favorite: favorite(1, 'WATCHING', 100), media: media(1, 'Zulu', 80), lastWatchedAt: 900 },
  { favorite: favorite(2, 'COMPLETED', 300), media: media(2, 'Alpha', 95), lastWatchedAt: 100 },
  { favorite: favorite(3, 'PLANNING', 200), media: media(3, 'Movie', 70) },
]

describe('library helpers', () => {
  it('filters status tabs and treats legacy entries as planning', () => {
    expect(filterAndSortLibrary(entries, { tab: 'watching', format: '', sort: 'recent-added' }).map((entry) => entry.favorite.id)).toEqual([1])
    expect(filterAndSortLibrary(entries, { tab: 'completed', format: '', sort: 'recent-added' }).map((entry) => entry.favorite.id)).toEqual([2])
    expect(filterAndSortLibrary(entries, { tab: 'planning', format: '', sort: 'recent-added' }).map((entry) => entry.favorite.id)).toEqual([3])
    expect(filterAndSortLibrary(entries, { tab: 'paused', format: '', sort: 'recent-added' })).toEqual([])
    expect(filterAndSortLibrary(entries, { tab: 'dropped', format: '', sort: 'recent-added' })).toEqual([])
  })

  it('filters by hydrated format and supports every sort order', () => {
    expect(filterAndSortLibrary(entries, { tab: 'all', format: 'MOVIE', sort: 'recent-added' }).map((entry) => entry.favorite.id)).toEqual([3])
    expect(filterAndSortLibrary(entries, { tab: 'all', format: '', sort: 'recent-added' }).map((entry) => entry.favorite.id)).toEqual([2, 3, 1])
    expect(filterAndSortLibrary(entries, { tab: 'all', format: '', sort: 'recent-watched' }).map((entry) => entry.favorite.id)).toEqual([1, 2, 3])
    expect(filterAndSortLibrary(entries, { tab: 'all', format: '', sort: 'title' }).map((entry) => entry.favorite.id)).toEqual([2, 3, 1])
    expect(filterAndSortLibrary(entries, { tab: 'all', format: '', sort: 'score' }).map((entry) => entry.favorite.id)).toEqual([2, 1, 3])
    expect(libraryFormats(entries)).toEqual(['MOVIE', 'TV'])
  })

  it('formats and clamps continue-watching progress', () => {
    const item = { position: 90, duration: 120 } as ContinueItem
    expect(playbackPercent(item)).toBe(75)
    expect(playbackPercent({ ...item, position: 200 })).toBe(100)
    expect(playbackPercent({ ...item, duration: 0 })).toBe(0)
    expect(formatPlaybackTime(90)).toBe('1:30')
    expect(formatPlaybackTime(3_661)).toBe('1:01:01')
  })

  it('distinguishes unavailable titles only after metadata loads successfully', () => {
    const entry = { favorite: favorite(10, 'PLANNING', 100) }
    expect(isEntryUnavailable(entry, false)).toBe(false)
    expect(isEntryUnavailable(entry, true)).toBe(true)
    expect(isEntryUnavailable({ ...entry, media: media(10, 'Available', 80) }, true)).toBe(false)
  })

  it('formats recent and older last-watched timestamps', () => {
    const now = new Date(2026, 8, 18, 12).getTime()
    expect(formatLastWatched(now - 30_000, now)).toBe('Just now')
    expect(formatLastWatched(now - 2 * 60 * 60_000, now)).toBe('2 hours ago')
    expect(formatLastWatched(now - 25 * 60 * 60_000, now)).toBe('Yesterday')
    expect(formatLastWatched(now - 3 * 24 * 60 * 60_000, now)).toBe('3 days ago')
  })
})
