import type { AniListMedia } from '../data/anilist/types'
import { formatEnum, formatStatus } from './format'

export const CATALOG_MODES = ['ANIME', 'MANGA'] as const
export type CatalogMode = (typeof CATALOG_MODES)[number]

export const catalogCopy = {
  ANIME: {
    singular: 'anime',
    plural: 'anime',
    heroDescription: 'Trending series, this season’s premieres, and what to watch next.',
    heroPrimary: 'Stream next episode',
    heroSecondary: 'View details',
    featuredTitle: 'Featured Anime',
    featuredDescription: 'Trending series / episode access / title details',
    collectionTitle: 'Trending Anime',
    collectionDescription: 'Popular series / current releases / title details',
    collectionItemsLabel: 'anime',
    collectionPulse: 'Trending this week',
    activeFilter: 'Airing',
    freshRailTitle: 'New this season',
    seasonalTitle: 'Seasonal Anime',
    seasonalDescription: 'This season / all-time favorites / coming next',
    columnTrending: 'Trending now',
    columnSecond: 'Popular this season',
    columnThird: 'All-time favorites',
    columnFourth: 'Coming next season',
    genreDescription: 'Browse anime genres',
    genreLabel: 'Browse by Genre',
    loading: 'Loading anime discovery…',
    unavailable: 'No anime available',
    heroFactsLabel: 'Anime details',
    countFactLabel: 'Episodes',
  },
  MANGA: {
    singular: 'manga',
    plural: 'manga',
    heroDescription: 'Trending titles and recently updated chapters.',
    heroPrimary: 'View details',
    heroSecondary: 'Browse manga',
    featuredTitle: 'Featured Manga',
    featuredDescription: 'Trending titles / chapter counts / title details',
    collectionTitle: 'Trending Manga',
    collectionDescription: 'Popular titles / chapter counts / title details',
    collectionItemsLabel: 'titles',
    collectionPulse: 'Trending now',
    activeFilter: 'Publishing',
    freshRailTitle: 'Recently updated',
    seasonalTitle: 'Manga to explore',
    seasonalDescription: 'Trending titles / recently updated / all-time favorites',
    columnTrending: 'Trending now',
    columnSecond: 'Recently updated',
    columnThird: 'All-time favorites',
    columnFourth: 'Recently announced',
    genreDescription: 'Browse manga genres',
    genreLabel: 'Browse by Genre',
    loading: 'Loading manga discovery…',
    unavailable: 'No manga available',
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
