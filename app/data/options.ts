import { queryOptions } from '@tanstack/solid-query'
import { canonicalIds, queryKeys } from '../lib/queryKeys'
import { alHome, alDetail, alByIds, alBrowse, alSuggest, alGenres } from './anilist/queries'
import type { MediaSort } from './anilist/queries'
import type { BrowseCountry, BrowseFormat, BrowseSeason, BrowseStatus } from '../lib/browse'
import type { CatalogMode } from '../lib/catalog'

// AniList queries: discovery metadata is public, slowly-changing, and cheap
// to serve from cache. staleTime of 10 minutes keeps the tab responsive
// without hammering the rate-limited API on back-navigation.

export const homeQuery = (mode: CatalogMode = 'ANIME') =>
  queryOptions({
    queryKey: queryKeys.home(mode),
    queryFn: ({ signal }) => alHome(mode, signal),
    staleTime: 1000 * 60 * 10,
  })

export const detailQuery = (id: number, mode: CatalogMode = 'ANIME') =>
  queryOptions({
    queryKey: queryKeys.detail(id, mode),
    queryFn: ({ signal }) => alDetail(id, mode, signal),
    staleTime: 1000 * 60 * 10,
  })

export const byIdsQuery = (ids: readonly number[], mode: CatalogMode = 'ANIME') => {
  const normalizedIds = canonicalIds(ids)
  return queryOptions({
    queryKey: queryKeys.byIds(normalizedIds, mode),
    queryFn: ({ signal }) => alByIds(normalizedIds, mode, signal),
    enabled: normalizedIds.length > 0,
    staleTime: 1000 * 60 * 10,
  })
}

export const browseQuery = (params: {
  page?: number
  perPage?: number
  sort?: MediaSort | MediaSort[]
  genre?: string | null
  format?: BrowseFormat | null
  status?: BrowseStatus | null
  countryOfOrigin?: BrowseCountry | null
  season?: BrowseSeason | null
  seasonYear?: number | null
  search?: string | null
  }, mode: CatalogMode = 'ANIME') =>
  queryOptions({
    queryKey: queryKeys.browse(params as Record<string, unknown>, mode),
    queryFn: ({ signal }) => alBrowse(params, mode, signal),
    staleTime: 1000 * 60 * 5,
  })

export const suggestQuery = (query: string, mode: CatalogMode = 'ANIME') =>
  queryOptions({
    queryKey: queryKeys.suggest(query, mode),
    queryFn: ({ signal }) => alSuggest(query, mode, signal),
    enabled: query.trim().length > 1,
    staleTime: 1000 * 60 * 10,
  })

export const genresQuery = () =>
  queryOptions({
    queryKey: queryKeys.genres,
    queryFn: ({ signal }) => alGenres(signal),
    staleTime: 1000 * 60 * 60 * 24,
  })
