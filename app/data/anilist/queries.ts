import { z } from 'zod'
import { anilistClient, AniListError } from './client'
import type { AniListMedia, AniListDetail, AniListHome, AniListScheduleItem } from './types'
import { mediaShape, detailShape, homeShape, genreCollectionShape, scheduleShape, pageInfoShape } from './schema'
import type { BrowseFormat, BrowseSeason, BrowseSort, BrowseStatus } from '../../lib/browse'

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
    season
    seasonYear
    genres
    countryOfOrigin
    isAdult
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
export async function alHome(): Promise<AniListHome> {
  const s = currentSeason()
  const n = nextSeasonOf()
  const query = `
    query($season:MediaSeason,$year:Int,$nseason:MediaSeason,$nyear:Int){
      trending: Page(perPage:14){ media(sort:TRENDING_DESC, type:ANIME, isAdult:false){ ...media } }
      season: Page(perPage:14){ media(sort:POPULARITY_DESC, type:ANIME, isAdult:false, season:$season, seasonYear:$year){ ...media } }
      allTime: Page(perPage:14){ media(sort:POPULARITY_DESC, type:ANIME, isAdult:false){ ...media } }
      topRated: Page(perPage:14){ media(sort:SCORE_DESC, type:ANIME, isAdult:false){ ...media } }
      upcoming: Page(perPage:14){ media(sort:POPULARITY_DESC, type:ANIME, isAdult:false, status:NOT_YET_RELEASED, season:$nseason, seasonYear:$nyear){ ...media } }
    }
    ${MEDIA_FRAGMENT}
  `
  const variables = { season: s.season, year: s.year, nseason: n.season, nyear: n.year }
  const raw = await anilistClient.request(query, variables)
  return parsePayload(homeShape, raw, 'the home rails')
}

/**
 * Detail page query: returns full Media with extended fields for anime detail page.
 * Mirrors alDetail() from prototype exactly.
 */
export async function alDetail(id: number): Promise<AniListDetail> {
  const query = `
    query($id:Int){
      Media(id:$id, type:ANIME){
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
  const raw = await anilistClient.request(query, variables)
  const parsed = parsePayload(z.object({ Media: detailShape.nullable() }), raw, `anime ${id}`)
  if (parsed.Media === null) throw new AniListError(`AniList could not find anime ${id}.`)
  return parsed.Media
}

/**
 * Returns genre list.
 * Mirrors alGenres() from prototype exactly.
 */
export async function alGenres(): Promise<string[]> {
  const query = `query{ GenreCollection }`
  const raw = await anilistClient.request(query)
  return parsePayload(z.object({ GenreCollection: genreCollectionShape }), raw, 'the genre collection').GenreCollection
}

/**
 * Schedule query: returns airing schedules in a time window.
 * Mirrors alSchedule() from prototype exactly.
 */
export async function alSchedule(start: number, end: number): Promise<AniListScheduleItem[]> {
  const query = `
    query($start:Int,$end:Int){
      Page(perPage:50){
        airingSchedules(airingAt_greater:$start, airingAt_lesser:$end, sort:TIME){
          episode airingAt
          media{ id title{ romaji english } coverImage{ large } format }
        }
      }
    }
  `
  const variables = { start, end }
  const raw = await anilistClient.request(query, variables)
  return parsePayload(scheduleShape, raw, 'the airing schedule')
}

/**
 * Batch query by IDs: returns media for multiple IDs.
 * Mirrors alByIds() from prototype exactly.
 */
export async function alByIds(ids: number[]): Promise<AniListMedia[]> {
  if (!ids.length) return []
  const query = `query($ids:[Int]){ Page(perPage:50){ media(id_in:$ids, type:ANIME){ ...media } } } ${MEDIA_FRAGMENT}`
  const variables = { ids }
  const raw = await anilistClient.request(query, variables)
  return parsePayload(z.object({ Page: z.object({ media: z.array(mediaShape) }) }), raw, 'the id batch').Page.media
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
  season?: BrowseSeason | null
  seasonYear?: number | null
  search?: string | null
}) {
  const filters: { arg: string; type: string; value: unknown }[] = [
    { arg: 'genre', type: 'String', value: opts.genre },
    { arg: 'format', type: 'MediaFormat', value: opts.format },
    { arg: 'status', type: 'MediaStatus', value: opts.status },
    { arg: 'season', type: 'MediaSeason', value: opts.season },
    { arg: 'seasonYear', type: 'Int', value: opts.seasonYear },
    { arg: 'search', type: 'String', value: opts.search },
  ].filter((filter) => filter.value !== null && filter.value !== undefined && filter.value !== '')

  const declarations = ['$page:Int', '$perPage:Int', '$sort:[MediaSort]', ...filters.map((filter) => `$${filter.arg}:${filter.type}`)]
  const mediaArgs = ['sort:$sort', 'type:ANIME', 'isAdult:false', ...filters.map((filter) => `${filter.arg}:$${filter.arg}`)]

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
  const raw = await anilistClient.request(query, variables)
  return parsePayload(z.object({ Page: z.object({ pageInfo: pageInfoShape, media: z.array(mediaShape) }) }), raw, 'the browse page').Page
}

/**
 * Search suggestions: returns first 6 results for search query.
 * Keep this query narrow so optional browse filters cannot interfere with
 * AniList's title search behavior.
 */
export async function alSuggest(query: string): Promise<AniListMedia[]> {
  const search = query.trim()
  if (!search) return []
  const gql = `
    query($search:String,$sort:[MediaSort]){
      Page(page:1, perPage:6){
        media(search:$search, sort:$sort, type:ANIME, isAdult:false){ ...media }
      }
    }
    ${MEDIA_FRAGMENT}
  `
  const raw = await anilistClient.request(gql, { search, sort: ['POPULARITY_DESC'] })
  return parsePayload(z.object({ Page: z.object({ media: z.array(mediaShape) }) }), raw, 'search suggestions').Page.media
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
  | 'UPDATE_DESC'
  | 'UPDATE_ASC'
