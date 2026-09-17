import { queryOptions } from '@tanstack/solid-query'
import { queryKeys } from '../lib/queryKeys'
import { alHome, alDetail, alByIds, alBrowse, alSuggest, alGenres, alSchedule } from './anilist/queries'
import type { MediaSort } from './anilist/queries'
import type { BrowseFormat, BrowseSeason, BrowseStatus } from '../lib/browse'

// AniList queries: discovery metadata is public, slowly-changing, and cheap
// to serve from cache. staleTime of 10 minutes keeps the tab responsive
// without hammering the rate-limited API on back-navigation.

export const homeQuery = () =>
  queryOptions({
    queryKey: queryKeys.home,
    queryFn: alHome,
    staleTime: 1000 * 60 * 10,
  })

export const detailQuery = (id: number) =>
  queryOptions({
    queryKey: queryKeys.detail(id),
    queryFn: () => alDetail(id),
    staleTime: 1000 * 60 * 10,
  })

export const byIdsQuery = (ids: readonly number[]) =>
  queryOptions({
    queryKey: queryKeys.byIds(ids),
    queryFn: () => alByIds([...ids]),
    enabled: ids.length > 0,
    staleTime: 1000 * 60 * 10,
  })

export const browseQuery = (params: {
  page?: number
  perPage?: number
  sort?: MediaSort | MediaSort[]
  genre?: string | null
  format?: BrowseFormat | null
  status?: BrowseStatus | null
  season?: BrowseSeason | null
  seasonYear?: number | null
  search?: string | null
}) =>
  queryOptions({
    queryKey: queryKeys.browse(params as Record<string, unknown>),
    queryFn: () => alBrowse(params),
    staleTime: 1000 * 60 * 5,
  })

export const suggestQuery = (query: string) =>
  queryOptions({
    queryKey: queryKeys.suggest(query),
    queryFn: () => alSuggest(query),
    enabled: query.trim().length > 1,
    staleTime: 1000 * 60 * 10,
  })

export const genresQuery = () =>
  queryOptions({
    queryKey: queryKeys.genres,
    queryFn: alGenres,
    staleTime: 1000 * 60 * 60 * 24,
  })

export const scheduleQuery = (start: number, end: number) =>
  queryOptions({
    queryKey: queryKeys.schedule(start, end),
    queryFn: () => alSchedule(start, end),
    staleTime: 1000 * 60 * 10,
  })