import type { AniListMedia } from '../data/anilist/types'
import { titleOf } from './format'

export const SEARCH_QUERY_MAX_LENGTH = 100
export const SEARCH_HISTORY_CHANGED_EVENT = 'animesource:search-history-changed'

/** Notifies mounted search surfaces after a client-side history mutation. */
export function notifySearchHistoryChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SEARCH_HISTORY_CHANGED_EVENT))
}

export type SearchIntent =
  | { kind: 'suggestion'; animeId: number }
  | { kind: 'query'; query: string }

export interface SearchSuggestionGroup {
  label: string
  items: AniListMedia[]
}

/** Normalizes user input using the same bounded query rules as Explore. */
export function normalizeSearchQuery(value: string | null | undefined): string | null {
  const query = value?.trim() ?? ''
  if (!query || query.length > SEARCH_QUERY_MAX_LENGTH) return null
  return query
}

function titleValues(anime: AniListMedia): string[] {
  return [anime.title?.english, anime.title?.romaji, anime.title?.native]
    .filter((value): value is string => Boolean(value?.trim()))
}

function matchesExactTitle(anime: AniListMedia, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase()
  return titleValues(anime).some((value) => value.trim().toLocaleLowerCase() === normalized)
}

/**
 * Groups real AniList suggestions without inventing unsupported metadata.
 * Exact title matches are promoted while the API's order is retained within
 * each group and duplicate media IDs are shown only once.
 */
export function groupSuggestions(items: AniListMedia[], query: string): SearchSuggestionGroup[] {
  const seen = new Set<number>()
  const exact: AniListMedia[] = []
  const matches: AniListMedia[] = []

  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    if (matchesExactTitle(item, query)) exact.push(item)
    else matches.push(item)
  }

  return [
    exact.length ? { label: 'Exact title match', items: exact } : null,
    matches.length ? { label: exact.length ? 'More AniList matches' : 'AniList matches', items: matches } : null,
  ].filter((group): group is SearchSuggestionGroup => group !== null)
}

export function intentForSuggestion(anime: AniListMedia): Extract<SearchIntent, { kind: 'suggestion' }> {
  return { kind: 'suggestion', animeId: anime.id }
}

export function intentForQuery(value: string | null | undefined): Extract<SearchIntent, { kind: 'query' }> | null {
  const query = normalizeSearchQuery(value)
  return query ? { kind: 'query', query } : null
}

export function suggestionLabel(anime: AniListMedia): string {
  return titleOf(anime)
}
