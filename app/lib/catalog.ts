import type { AniListMedia } from '../data/anilist/types'
import { formatEnum, formatStatus } from './format'

export const CATALOG_MODES = ['ANIME', 'MANGA'] as const
export type CatalogMode = (typeof CATALOG_MODES)[number]

export const catalogCopy = {
  ANIME: {
    singular: 'anime',
    plural: 'anime',
    heroPrimary: 'Stream next episode',
    heroSecondary: 'View details',
    featuredTitle: 'Featured Anime',
    collectionTitle: 'Trending Anime',
    collectionItemsLabel: 'anime',
    activeFilter: 'Airing',
    freshRailTitle: 'New this season',
    seasonalTitle: 'Seasonal Anime',
    columnTrending: 'Trending now',
    columnSecond: 'Popular this season',
    columnThird: 'All-time favorites',
    columnFourth: 'Coming next season',
    genreLabel: 'Browse by Genre',
    loading: 'Loading anime discovery…',
    heroFactsLabel: 'Anime details',
    countFactLabel: 'Episodes',
  },
  MANGA: {
    singular: 'manga',
    plural: 'manga',
    heroPrimary: 'Start reading',
    heroSecondary: 'View details',
    featuredTitle: 'Featured Manga',
    collectionTitle: 'Trending Manga',
    collectionItemsLabel: 'titles',
    activeFilter: 'Publishing',
    freshRailTitle: 'Recently updated',
    seasonalTitle: 'Manga to explore',
    columnTrending: 'Trending now',
    columnSecond: 'Recently updated',
    columnThird: 'All-time favorites',
    columnFourth: 'Recently announced',
    genreLabel: 'Browse by Genre',
    loading: 'Loading manga discovery…',
    heroFactsLabel: 'Manga details',
    countFactLabel: 'Chapters & volumes',
  },
} as const satisfies Record<CatalogMode, Record<string, string>>

export function catalogStatus(mode: CatalogMode, status: string | null | undefined): string {
  if (mode === 'MANGA' && status === 'RELEASING') return 'Publishing'
  return formatStatus(status)
}

export function catalogLibraryStatus(mode: CatalogMode, status: string | null | undefined): string {
  if (mode === 'MANGA' && status === 'WATCHING') return 'Reading'
  return formatEnum(status)
}

export function catalogCountLabel(mode: CatalogMode, media: AniListMedia | null | undefined): string {
  if (!media) return ''
  if (mode === 'MANGA') {
    const counts = [
      media.chapters ? `${media.chapters} chapters` : null,
      media.volumes ? `${media.volumes} volumes` : null,
    ].filter(Boolean)
    return counts.join(' · ')
  }
  return media.episodes ? `${media.episodes} episodes` : ''
}

export function catalogFormat(mode: CatalogMode, media: AniListMedia | null | undefined): string {
  if (!media) return ''
  return [
    media.format ? formatEnum(media.format) : null,
    mode === 'ANIME' ? media.seasonYear : media.startDate?.year,
  ].filter(Boolean).join(' · ')
}

export function catalogExternalLabel(mode: CatalogMode): string {
  return mode === 'MANGA' ? 'Open AniList record ↗' : 'View details'
}
