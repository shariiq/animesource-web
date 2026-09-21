import { z } from 'zod'

// ---- AniList GraphQL response wrappers ----

export const anilistErrorShape = z.object({
  message: z.string(),
  locations: z.array(z.object({ line: z.number(), column: z.number() })).optional(),
  path: z.array(z.string()).optional(),
})

export const graphQLResponseShape = z.object({
  data: z.unknown().nullable(),
  errors: z.array(anilistErrorShape).optional(),
})

export type GraphQLResponse = z.infer<typeof graphQLResponseShape>

// ---- Media models ----

const nullableString = z.string().nullable().nullish()
const nullableInt = z.number().int().nullable().nullish()

const titleShape = z
  .object({
    romaji: nullableString,
    english: nullableString,
    native: nullableString,
  })
  .nullish()

const coverImageShape = z
  .object({
    extraLarge: nullableString,
    large: nullableString,
    medium: nullableString,
    color: nullableString,
  })
  .nullish()

// AniList FuzzyDate: every component can be null (e.g. "2023" with no
// month/day), and the whole date object can be null.
const dateShape = z.object({ year: nullableInt, month: nullableInt, day: nullableInt }).nullable()

const nextAiringEpisodeShape = z
  .object({
    episode: z.number(),
    airingAt: z.number(),
    timeUntilAiring: z.number(),
  })
  .nullish()

export const mediaShape = z.object({
  id: z.number(),
  type: nullableString,
  siteUrl: nullableString,
  title: titleShape,
  coverImage: coverImageShape,
  bannerImage: nullableString,
  averageScore: nullableInt,
  meanScore: nullableInt,
  popularity: nullableInt,
  favourites: nullableInt,
  trending: nullableInt,
  format: nullableString,
  status: nullableString,
  episodes: nullableInt,
  chapters: nullableInt,
  volumes: nullableInt,
  updatedAt: nullableInt,
  startDate: dateShape.nullish(),
  season: nullableString,
  seasonYear: nullableInt,
  genres: z.array(nullableString).nullish(),
  countryOfOrigin: nullableString,
  isAdult: z.boolean().nullish(),
  nextAiringEpisode: nextAiringEpisodeShape,
})

export type AniListMedia = z.infer<typeof mediaShape>

export type AniListDate = z.infer<typeof dateShape>

export const rankingShape = z.object({
  id: z.number(),
  rank: z.number(),
  type: nullableString,
  format: nullableString,
  year: nullableInt,
  season: nullableString,
  allTime: z.boolean().nullish(),
  context: nullableString,
})
export type AniListRanking = z.infer<typeof rankingShape>

export const tagShape = z.object({
  id: z.number(),
  name: z.string(),
  description: nullableString,
  category: nullableString,
  rank: nullableInt,
  isGeneralSpoiler: z.boolean().nullish(),
  isMediaSpoiler: z.boolean().nullish(),
  isAdult: z.boolean().nullish(),
})
export type AniListTag = z.infer<typeof tagShape>

export const detailShape = mediaShape.extend({
  description: nullableString,
  duration: nullableInt,
  startDate: dateShape,
  endDate: dateShape,
  source: nullableString,
  synonyms: z.array(nullableString).nullish(),
  studios: z
    .object({
      nodes: z
        .array(
          z
            .object({
              id: z.number(),
              name: nullableString,
              isAnimationStudio: z.boolean().nullish(),
              siteUrl: nullableString,
            })
            .nullish(),
        )
        .nullish(),
    })
    .nullish(),
  trailer: z
    .object({ id: z.string(), site: nullableString, thumbnail: nullableString })
    .nullish(),
  externalLinks: z
    .array(
      z
        .object({
          id: z.number(),
          site: nullableString,
          type: nullableString,
          language: nullableString,
          color: nullableString,
          icon: nullableString,
          url: nullableString,
          isDisabled: z.boolean().nullish(),
        })
        .nullish(),
    )
    .nullish(),
  rankings: z.array(rankingShape).nullish(),
  tags: z.array(tagShape).nullish(),
  staff: z
    .object({
      edges: z
        .array(
          z
            .object({
              role: nullableString,
              node: z
                .object({
                  id: z.number(),
                  name: z.object({ full: nullableString, native: nullableString }).nullish(),
                  image: z.object({ medium: nullableString }).nullish(),
                  primaryOccupations: z.array(nullableString).nullish(),
                  siteUrl: nullableString,
                })
                .nullish(),
            })
            .nullish(),
        )
        .nullish(),
    })
    .nullish(),
  characters: z
    .object({
      edges: z
        .array(
          z
            .object({
              role: nullableString,
              node: z
                .object({
                  id: z.number(),
                  siteUrl: nullableString,
                  name: z.object({ full: nullableString }).nullish(),
                  image: z.object({ medium: nullableString }).nullish(),
                })
                .nullish(),
              voiceActors: z
                .array(
                  z
                    .object({
                      id: z.number(),
                      name: z.object({ full: nullableString, native: nullableString }).nullish(),
                      image: z.object({ medium: nullableString }).nullish(),
                      languageV2: nullableString,
                      primaryOccupations: z.array(nullableString).nullish(),
                      siteUrl: nullableString,
                    })
                    .nullish(),
                )
                .nullish(),
            })
            .nullish(),
        )
        .nullish(),
    })
    .nullish(),
  relations: z
    .object({
      edges: z
        .array(
          z
            .object({
              relationType: nullableString,
              node: mediaShape.nullable(),
            })
            .nullish()
        )
        .nullish(),
    })
    .nullish(),
  recommendations: z
    .object({
      nodes: z
        .array(z.object({ mediaRecommendation: mediaShape.nullable() }).nullish())
        .nullish(),
    })
    .nullish(),
})

export type AniListDetail = z.infer<typeof detailShape>

export const pageInfoShape = z.object({
  currentPage: z.number().int().positive(),
  lastPage: z.number().int().nonnegative(),
  hasNextPage: z.boolean(),
  total: z.number().int().nonnegative(),
})

export const pageShape = z.object({
  pageInfo: pageInfoShape.nullish(),
  media: z.array(mediaShape).nullish(),
})

export type AniListPage = z.infer<typeof pageShape>

// The home query aliases five `Page` fields; each GraphQL Page object carries
// its items under a nested `media` key, so each rail is { media: Media[] }.
export const homeShape = z.object({
  trending: z.object({ media: z.array(mediaShape) }),
  season: z.object({ media: z.array(mediaShape) }),
  allTime: z.object({ media: z.array(mediaShape) }),
  topRated: z.object({ media: z.array(mediaShape) }),
  upcoming: z.object({ media: z.array(mediaShape) }),
})

export type AniListHome = z.infer<typeof homeShape>

export const genreCollectionShape = z.array(z.string())
export type AniListGenre = z.infer<typeof genreCollectionShape> // string[]

export const scheduleItemShape = z.object({
  episode: z.number(),
  airingAt: z.number(),
  media: z
    .object({
      id: z.number(),
      title: z.object({ romaji: nullableString, english: nullableString }).nullish(),
      coverImage: z.object({ large: nullableString }).nullish(),
      format: nullableString,
      status: nullableString,
      genres: z.array(nullableString).nullish(),
    })
    .nullish(),
})

export type AniListScheduleItem = z.infer<typeof scheduleItemShape>

export const scheduleShape = z.array(scheduleItemShape)
export type AniListSchedule = z.infer<typeof scheduleShape>

export const schedulePageShape = z.object({
  Page: z.object({
    pageInfo: pageInfoShape.optional(),
    airingSchedules: z.array(scheduleItemShape),
  }),
})
export type AniListSchedulePage = z.infer<typeof schedulePageShape>
