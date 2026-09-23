import { z } from 'zod'
import { anilistClient, AniListError } from './client'
import type { AniListMedia, AniListDetail, AniListHome, AniListScheduleItem } from './types'
import { mediaShape, detailShape, homeShape, genreCollectionShape, schedulePageShape, pageInfoShape } from './schema'
import type { BrowseCountry, BrowseFormat, BrowseSeason, BrowseSort, BrowseStatus } from '../../lib/browse'
import type { CatalogMode } from '../../lib/catalog'

/**
 * Returns the current season based on date (WINTER/SPRING/SUMMER/FALL).
 */
export function currentSeason(date: Date = new Date()): { season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL'; year: number } {
  const m = date.getMonth() + 1
  const y = date.getFullYear()
  if (m <= 2) return { season: 'WINTER', year: y }
  if (m <= 5) return { season: 'SPRING', year: y }
  if (m <= 8) return { season: 'SUMMER', year: y }
  return { season: 'FALL', year: y }
}

/**
 * Returns the next season after the given date.
 */
export function nextSeasonOf(date: Date = new Date()): { season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL'; year: number } {
  const cur = currentSeason(date)
  const order = ['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const
  const idx = order.indexOf(cur.season)
  if (idx === 3) return { season: 'WINTER', year: cur.year + 1 }
  const next = order[idx + 1]
  if (!next) return { season: 'WINTER', year: cur.year + 1 }
  return { season: next, year: cur.year }
}

/**
 * Media fragment shared by all queries.
 */
export const HOME_TRENDING_PAGE_SIZE = 12
export const HOME_SEASON_PAGE_SIZE = 12
export const HOME_TOP_RATED_PAGE_SIZE = 12
export const HOME_COMPACT_PAGE_SIZE = 3

export const MEDIA_FRAGMENT = `
  fragment media on Media {
    id
    type
    siteUrl
    title { romaji english native }
    coverImage { extraLarge large medium color }
    bannerImage
    averageScore
    meanScore
    popularity
    favourites
    trending
    format
    status
    episodes
    chapters
    volumes
    updatedAt
    startDate { year month day }
    season
    seasonYear
    genres
    countryOfOrigin
    isAdult
    nextAiringEpisode { episode airingAt timeUntilAiring }
  }
`

/** Home cards use a deliberately narrow fragment to keep the SSR payload small. */
const HOME_MEDIA_FRAGMENT = `
  fragment homeMedia on Media {
    id
    type
    siteUrl
    title { romaji english native }
    coverImage { extraLarge large color }
    bannerImage
    averageScore
    meanScore
    popularity
    favourites
    format
    status
    episodes
    chapters
    volumes
    updatedAt
    startDate { year month day }
    seasonYear
    genres
    countryOfOrigin
    nextAiringEpisode { episode airingAt timeUntilAiring }
  }
`

/**
 * Parses a validated AniList payload. A schema mismatch means AniList
 * returned a shape we don't understand — that surfaces as the same typed,
 * SSR-serializable `AniListError` as every other failure mode, never as a raw
 * `ZodError` (which cannot cross the dehydration boundary and crashes SSR).
 */
function parsePayload<T>(schema: { parse(raw: unknown): T }, raw: unknown, what: string): T {
  try {
    return schema.parse(raw)
  } catch {
    throw new AniListError(`AniList returned unexpected data for ${what}.`, { isGraphQL: false })
  }
}

/**
 * Home page query: returns 5 rails (trending, season, allTime, topRated, upcoming) using GraphQL aliases.
 * Mirrors alHome() from prototype exactly.
 */
export async function alHome(mode: CatalogMode = 'ANIME', signal?: AbortSignal): Promise<AniListHome> {
  const s = currentSeason()
  const n = nextSeasonOf()
  const declarations = mode === 'ANIME'
    ? 'query($season:MediaSeason,$year:Int,$nseason:MediaSeason,$nyear:Int)'
    : 'query'
  const seasonRail = mode === 'ANIME'
    ? `season: Page(perPage:${HOME_SEASON_PAGE_SIZE}){ media(sort:POPULARITY_DESC, type:ANIME, isAdult:false, season:$season, seasonYear:$year){ ...homeMedia } }`
    : `season: Page(perPage:${HOME_SEASON_PAGE_SIZE}){ media(sort:UPDATED_AT_DESC, type:MANGA, isAdult:false){ ...homeMedia } }`
  const upcomingRail = mode === 'ANIME'
    ? `upcoming: Page(perPage:${HOME_COMPACT_PAGE_SIZE}){ media(sort:POPULARITY_DESC, type:ANIME, isAdult:false, status:NOT_YET_RELEASED, season:$nseason, seasonYear:$nyear){ ...homeMedia } }`
    : `upcoming: Page(perPage:${HOME_COMPACT_PAGE_SIZE}){ media(sort:START_DATE_DESC, type:MANGA, isAdult:false, status:NOT_YET_RELEASED){ ...homeMedia } }`
  const query = `
    ${declarations}{
      trending: Page(perPage:${HOME_TRENDING_PAGE_SIZE}){ media(sort:TRENDING_DESC, type:${mode}, isAdult:false){ ...homeMedia } }
      ${seasonRail}
      allTime: Page(perPage:${HOME_COMPACT_PAGE_SIZE}){ media(sort:POPULARITY_DESC, type:${mode}, isAdult:false){ ...homeMedia } }
      topRated: Page(perPage:${HOME_TOP_RATED_PAGE_SIZE}){ media(sort:SCORE_DESC, type:${mode}, isAdult:false){ ...homeMedia } }
      ${upcomingRail}
    }
    ${HOME_MEDIA_FRAGMENT}
  `
  const variables = mode === 'ANIME'
    ? { season: s.season, year: s.year, nseason: n.season, nyear: n.year }
    : {}
  const raw = await anilistClient.request(query, variables, signal)
  return parsePayload(homeShape, raw, `the ${mode.toLowerCase()} home rails`)
}

/** Returns full Media with extended fields for an anime or manga detail page. */
export async function alDetail(id: number, mode: CatalogMode = 'ANIME', signal?: AbortSignal): Promise<AniListDetail> {
  const query = `
    query($id:Int){
      Media(id:$id, type:${mode}){
        ...media
        description(asHtml:false)
        duration
        startDate{ year month day }
        endDate{ year month day }
        source
        synonyms
        studios(isMain:true){ nodes{ id name isAnimationStudio siteUrl } }
        trailer{ id site thumbnail }
        externalLinks{ id site type language color icon url isDisabled }
        rankings { id rank type format year season allTime context }
        tags { id name description category rank isGeneralSpoiler isMediaSpoiler isAdult }
        staff(sort:[RELEVANCE], perPage:12){
          edges{
            role
            node{ id name{ full native } image{ medium } primaryOccupations siteUrl }
          }
        }
        characters(sort:[ROLE,RELEVANCE], perPage:12){
          edges{
            role
            node{ id siteUrl name{ full } image{ medium } }
            voiceActors(language:JAPANESE){ id name{ full native } image{ medium } languageV2 primaryOccupations siteUrl }
          }
        }
        relations{
          edges{ relationType(version:2) node{ ...media } }
        }
        recommendations(sort:RATING_DESC, perPage:12){
          nodes{ mediaRecommendation{ ...media } }
        }
      }
    }
    ${MEDIA_FRAGMENT}
  `
  const variables = { id }
  const raw = await anilistClient.request(query, variables, signal)
  const noun = mode === 'MANGA' ? 'manga' : 'anime'
  const parsed = parsePayload(z.object({ Media: detailShape.nullable() }), raw, `${noun} ${id}`)
  if (parsed.Media === null) throw new AniListError(`AniList could not find ${noun} ${id}.`)
  return parsed.Media
}

/**
 * Returns genre list.
 * Mirrors alGenres() from prototype exactly.
 */
export async function alGenres(signal?: AbortSignal): Promise<string[]> {
  const query = `query{ GenreCollection }`
  const raw = await anilistClient.request(query, {}, signal)
  return parsePayload(z.object({ GenreCollection: genreCollectionShape }), raw, 'the genre collection').GenreCollection
}

/**
 * Schedule query: returns airing schedules in a time window.
 * Mirrors alSchedule() from prototype exactly.
 */
export async function alSchedule(start: number, end: number, signal?: AbortSignal): Promise<AniListScheduleItem[]> {
  const query = `
    query($start:Int,$end:Int,$page:Int){
      Page(page:$page,perPage:50){
        pageInfo{ currentPage lastPage hasNextPage total }
        airingSchedules(airingAt_greater:$start, airingAt_lesser:$end, sort:TIME){
          episode airingAt
          media{ id title{ romaji english } coverImage{ large } format status genres }
        }
      }
    }
  `
  const fetchPage = async (page: number) => {
    const raw = await anilistClient.request(query, { start, end, page }, signal)
    return parsePayload(schedulePageShape, raw, 'the airing schedule')
  }
  const first = await fetchPage(1)
  const items: AniListScheduleItem[] = [...first.Page.airingSchedules]
  const firstInfo = first.Page.pageInfo
  if (!firstInfo?.hasNextPage) return items
  // The first page reports the total, so the remainder can run concurrently
  // instead of one RTT per page.
  const lastPage = firstInfo.lastPage ?? null
  if (lastPage && lastPage > 1) {
    const rest = await Promise.all(
      Array.from({ length: lastPage - 1 }, (_, index) => fetchPage(index + 2)),
    )
    for (const page of rest) items.push(...page.Page.airingSchedules)
    return items
  }
  let page = 2
  // Unknown page count: keep the serial fallback bounded so a malformed
  // hasNextPage can never spin forever.
  for (let guard = 0; guard < 20; guard += 1) {
    const parsed = await fetchPage(page)
    items.push(...parsed.Page.airingSchedules)
    if (!parsed.Page.pageInfo?.hasNextPage) return items
    page += 1
  }
  return items
}

/**
 * Batch query by IDs: returns media for multiple IDs.
 * Mirrors alByIds() from prototype exactly.
 */
export async function alByIds(ids: number[], mode: CatalogMode = 'ANIME', signal?: AbortSignal): Promise<AniListMedia[]> {
  const uniqueIds = [...new Set(ids)]
  if (!uniqueIds.length) return []

  const batches = Array.from(
    { length: Math.ceil(uniqueIds.length / 50) },
    (_, index) => uniqueIds.slice(index * 50, (index + 1) * 50),
  )
  const declarations = batches.map((_, index) => `$ids${index}:[Int]`).join(',')
  const pages = batches.map((_, index) => `batch${index}: Page(perPage:50){ media(id_in:$ids${index}, type:${mode}){ ...media } }`).join('\n')
  const query = `query(${declarations}){ ${pages} } ${MEDIA_FRAGMENT}`
  const variables = Object.fromEntries(batches.map((batch, index) => [`ids${index}`, batch]))
  const shape = z.object(Object.fromEntries(batches.map((_, index) => [
    `batch${index}`,
    z.object({ media: z.array(mediaShape) }),
  ])))
  const parsed = parsePayload(shape, await anilistClient.request(query, variables, signal), 'the id batches')
  return batches.flatMap((_, index) => parsed[`batch${index}`]?.media ?? [])
}

/**
 * Browse/search query: generic paginated search with filters.
 *
 * Unset filters are omitted from the query entirely rather than sent as
 * explicit nulls: AniList reads `status: null` as "media whose status is
 * null", which matches nothing, so a null-padded query silently returns an
 * empty page instead of the unfiltered results the caller asked for.
 */
export async function alBrowse(opts: {
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
}, mode: CatalogMode = 'ANIME', signal?: AbortSignal) {
  const filters: { arg: string; type: string; value: unknown }[] = [
    { arg: 'genre', type: 'String', value: opts.genre },
    { arg: 'format', type: 'MediaFormat', value: opts.format },
    { arg: 'status', type: 'MediaStatus', value: opts.status },
    { arg: 'countryOfOrigin', type: 'CountryCode', value: opts.countryOfOrigin },
    { arg: 'season', type: 'MediaSeason', value: opts.season },
    { arg: 'seasonYear', type: 'Int', value: opts.seasonYear },
    { arg: 'search', type: 'String', value: opts.search },
  ].filter((filter) => filter.value !== null && filter.value !== undefined && filter.value !== '')

  const declarations = ['$page:Int', '$perPage:Int', '$sort:[MediaSort]', ...filters.map((filter) => `$${filter.arg}:${filter.type}`)]
  const mediaArgs = ['sort:$sort', `type:${mode}`, 'isAdult:false', ...filters.map((filter) => `${filter.arg}:$${filter.arg}`)]

  const query = `
    query(${declarations.join(',')}){
      Page(page:$page, perPage:$perPage){
        pageInfo{ currentPage lastPage hasNextPage total }
        media(${mediaArgs.join(', ')}){ ...media }
      }
    }
    ${MEDIA_FRAGMENT}
  `
  const variables: Record<string, unknown> = {
    page: opts.page ?? 1,
    perPage: opts.perPage ?? 24,
    sort: opts.sort
      ? Array.isArray(opts.sort)
        ? opts.sort
        : [opts.sort]
      : ['TRENDING_DESC'],
  }
  for (const filter of filters) variables[filter.arg] = filter.value
  const raw = await anilistClient.request(query, variables, signal)
  return parsePayload(z.object({ Page: z.object({ pageInfo: pageInfoShape, media: z.array(mediaShape) }) }), raw, 'the browse page').Page
}

/**
 * Search suggestions: returns first 6 results for search query.
 * Keep this query narrow so optional browse filters cannot interfere with
 * AniList's title search behavior.
 */
export async function alSuggest(query: string, mode: CatalogMode = 'ANIME', signal?: AbortSignal): Promise<AniListMedia[]> {
  const search = query.trim()
  if (!search) return []
  const gql = `
    query($search:String,$sort:[MediaSort]){
      Page(page:1, perPage:6){
        media(search:$search, sort:$sort, type:${mode}, isAdult:false){ ...media }
      }
    }
    ${MEDIA_FRAGMENT}
  `
  const raw = await anilistClient.request(gql, { search, sort: ['POPULARITY_DESC'] }, signal)
  return parsePayload(z.object({ Page: z.object({ media: z.array(mediaShape) }) }), raw, `${mode.toLowerCase()} search suggestions`).Page.media
}

export type MediaSort = BrowseSort
  | 'SCORE_DESC'
  | 'SCORE_ASC'
  | 'TRENDING_DESC'
  | 'TRENDING_ASC'
  | 'POPULARITY_DESC'
  | 'POPULARITY_ASC'
  | 'START_DATE_DESC'
  | 'START_DATE_ASC'
  | 'END_DATE_DESC'
  | 'END_DATE_ASC'
  | 'UPDATED_AT_DESC'
  | 'UPDATE_ASC'
