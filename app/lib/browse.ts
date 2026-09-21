import { z } from 'zod'
import type { CatalogMode } from './catalog'

export const BROWSE_ANIME_FORMATS = ['TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC'] as const
export const BROWSE_MANGA_FORMATS = ['MANGA', 'NOVEL', 'ONE_SHOT'] as const
export const BROWSE_FORMATS = [...BROWSE_ANIME_FORMATS, ...BROWSE_MANGA_FORMATS] as const
export const BROWSE_STATUSES = ['FINISHED', 'RELEASING', 'NOT_YET_RELEASED', 'CANCELLED', 'HIATUS'] as const
export const BROWSE_SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const
export const BROWSE_SORTS = ['TRENDING_DESC', 'POPULARITY_DESC', 'SCORE_DESC', 'START_DATE_DESC', 'UPDATED_AT_DESC'] as const
export const BROWSE_COUNTRY_CODES = ['JP', 'CN', 'KR', 'TW', 'US', 'GB', 'FR', 'DE', 'IT', 'ES', 'RU', 'CA', 'AU', 'IN', 'BR', 'TH', 'PH', 'VN', 'ID', 'SG', 'MY', 'MX', 'AR', 'PL', 'UA', 'TR', 'SE', 'NO', 'FI', 'DK', 'NL', 'BE', 'AT', 'CH', 'IE', 'NZ', 'ZA'] as const
export const BROWSE_COUNTRIES: ReadonlyArray<readonly [BrowseCountry, string]> = [
  ['JP', 'Japan'], ['CN', 'China'], ['KR', 'South Korea'], ['TW', 'Taiwan'],
  ['US', 'United States'], ['GB', 'United Kingdom'], ['FR', 'France'], ['DE', 'Germany'],
  ['IT', 'Italy'], ['ES', 'Spain'], ['RU', 'Russia'], ['CA', 'Canada'],
  ['AU', 'Australia'], ['IN', 'India'], ['BR', 'Brazil'], ['TH', 'Thailand'],
  ['PH', 'Philippines'], ['VN', 'Vietnam'], ['ID', 'Indonesia'], ['SG', 'Singapore'],
  ['MY', 'Malaysia'], ['MX', 'Mexico'], ['AR', 'Argentina'], ['PL', 'Poland'],
  ['UA', 'Ukraine'], ['TR', 'Türkiye'], ['SE', 'Sweden'], ['NO', 'Norway'],
  ['FI', 'Finland'], ['DK', 'Denmark'], ['NL', 'Netherlands'], ['BE', 'Belgium'],
  ['AT', 'Austria'], ['CH', 'Switzerland'], ['IE', 'Ireland'], ['NZ', 'New Zealand'],
  ['ZA', 'South Africa'],
]

export type BrowseFormat = (typeof BROWSE_FORMATS)[number]
export type BrowseStatus = (typeof BROWSE_STATUSES)[number]
export type BrowseSeason = (typeof BROWSE_SEASONS)[number]
export type BrowseSort = (typeof BROWSE_SORTS)[number]
export type BrowseCountry = (typeof BROWSE_COUNTRY_CODES)[number]

export function browseFormats(mode: CatalogMode): readonly BrowseFormat[] {
  return mode === 'MANGA' ? BROWSE_MANGA_FORMATS : BROWSE_ANIME_FORMATS
}

export const BROWSE_PER_PAGE = 24
// AniList rejects Browse pages beyond its documented 100-page request window.
export const BROWSE_MAX_PAGE = 100

const optionalText = z.string().trim().max(100).optional().transform((value) => value || undefined)
const optionalYear = z.preprocess(
  (value) => value === '' || value === undefined ? undefined : value,
  z.coerce.number().int().min(1960).max(2100).optional(),
)
const optionalPage = z.preprocess(
  (value) => {
    if (value === '' || value === undefined) return undefined
    const page = Number(value)
    return Number.isFinite(page) ? clampPage(page) : value
  },
  z.coerce.number().int().min(1).max(BROWSE_MAX_PAGE).optional(),
)

export const browseSearchSchema = z.object({
  query: optionalText,
  genre: optionalText,
  format: z.preprocess((value) => value === '' ? undefined : value, z.enum(BROWSE_FORMATS).optional()),
  status: z.preprocess((value) => value === '' ? undefined : value, z.enum(BROWSE_STATUSES).optional()),
  countryOfOrigin: z.preprocess((value) => value === '' ? undefined : value, z.enum(BROWSE_COUNTRY_CODES).optional()),
  season: z.preprocess((value) => value === '' ? undefined : value, z.enum(BROWSE_SEASONS).optional()),
  year: optionalYear,
  sort: z.preprocess((value) => value === '' ? undefined : value, z.enum(BROWSE_SORTS).optional()),
  page: optionalPage,
}).transform((search) => ({ ...search, page: search.page ?? 1, sort: search.sort ?? 'TRENDING_DESC' as BrowseSort }))

export type BrowseSearch = z.output<typeof browseSearchSchema>

export function makeBrowseSearch(overrides: Partial<BrowseSearch> = {}): BrowseSearch {
  return {
    query: undefined,
    genre: undefined,
    format: undefined,
    status: undefined,
    countryOfOrigin: undefined,
    season: undefined,
    year: undefined,
    sort: 'TRENDING_DESC',
    page: 1,
    ...overrides,
  }
}

export function toBrowseParams(search: BrowseSearch, mode: CatalogMode = 'ANIME') {
  return {
    search: search.query,
    genre: search.genre,
    format: search.format,
    status: search.status,
    countryOfOrigin: search.countryOfOrigin,
    season: mode === 'ANIME' ? search.season : undefined,
    seasonYear: search.year,
    sort: search.sort,
    page: search.page,
  }
}

export function searchWithoutPage(search: BrowseSearch): Omit<BrowseSearch, 'page'> {
  return {
    query: search.query,
    genre: search.genre,
    format: search.format,
    status: search.status,
    countryOfOrigin: search.countryOfOrigin,
    season: search.season,
    year: search.year,
    sort: search.sort,
  }
}

/** Filter keys a user can clear individually from the Explore surface. */
export const BROWSE_FILTER_KEYS = ['query', 'genre', 'format', 'status', 'countryOfOrigin', 'season', 'year'] as const
export type BrowseFilterKey = (typeof BROWSE_FILTER_KEYS)[number]

/** Search state for a given page, with every active filter preserved. */
export function searchAtPage(search: BrowseSearch, page: number): BrowseSearch {
  return { ...searchWithoutPage(search), page: clampPage(page) }
}

/** Clearing a filter always returns to page 1 — later pages may not exist. */
export function searchWithoutFilter(search: BrowseSearch, key: BrowseFilterKey): BrowseSearch {
  return { ...searchWithoutPage(search), [key]: undefined, page: 1 }
}

export function clampPage(page: number): number {
  if (!Number.isFinite(page)) return 1
  return Math.min(Math.max(Math.trunc(page), 1), BROWSE_MAX_PAGE)
}

/**
 * A short window of page numbers centred on the current page. AniList only
 * reports `lastPage` for bounded result sets, so an unknown last page yields a
 * forward-looking window instead of a fabricated total.
 */
export function pageWindow(current: number, lastPage: number | null, span = 2): number[] {
  const safeCurrent = clampPage(current)
  const upperBound = lastPage && lastPage > 0 ? Math.min(lastPage, BROWSE_MAX_PAGE) : BROWSE_MAX_PAGE
  const start = Math.max(1, Math.min(safeCurrent - span, upperBound - span * 2))
  const end = Math.min(upperBound, start + span * 2)
  const pages: number[] = []
  for (let page = start; page <= end; page += 1) pages.push(page)
  return pages
}
