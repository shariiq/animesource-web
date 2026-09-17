import { describe, expect, it } from 'vitest'
import type { AniListMedia } from '../app/data/anilist/types'
import { groupSuggestions, intentForQuery, intentForSuggestion, normalizeSearchQuery } from '../app/lib/search'

function media(id: number, titles: AniListMedia['title']): AniListMedia {
  return {
    id,
    type: 'ANIME',
    siteUrl: null,
    title: titles,
    coverImage: null,
    bannerImage: null,
    averageScore: null,
    meanScore: null,
    popularity: null,
    favourites: null,
    trending: null,
    format: null,
    status: null,
    episodes: null,
    season: null,
    seasonYear: null,
    genres: null,
    countryOfOrigin: null,
    isAdult: false,
    nextAiringEpisode: null,
  }
}

describe('search intent', () => {
  it('normalizes committed queries and keeps typed search distinct from selected anime', () => {
    expect(normalizeSearchQuery('  Fullmetal Alchemist  ')).toBe('Fullmetal Alchemist')
    expect(normalizeSearchQuery('   ')).toBeNull()
    expect(intentForQuery('  Cowboy Bebop ')).toEqual({ kind: 'query', query: 'Cowboy Bebop' })
    expect(intentForSuggestion(media(9, { english: 'Cowboy Bebop', romaji: null, native: null }))).toEqual({ kind: 'suggestion', animeId: 9 })
  })

  it('promotes real exact title matches and removes duplicate media IDs', () => {
    const items = [
      media(1, { english: 'Frieren', romaji: 'Sousou no Frieren', native: '葬送のフリーレン' }),
      media(2, { english: 'Frieren: Beyond Journey’s End', romaji: null, native: null }),
      media(1, { english: 'Frieren', romaji: 'Sousou no Frieren', native: '葬送のフリーレン' }),
    ]

    expect(groupSuggestions(items, ' sousou no frieren ')).toEqual([
      { label: 'Exact title match', items: [items[0]] },
      { label: 'More AniList matches', items: [items[1]] },
    ])
  })
})
