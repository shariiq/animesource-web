// Domain types are derived from the zod schemas in ./schema — the validated
// output shape IS the domain shape. Re-exported here so internal code imports
// from one place and never handles raw AniList JSON.
export type {
  AniListDate,
  AniListMedia,
  AniListDetail,
  AniListPage,
  AniListHome,
  AniListGenre,
  AniListRanking,
  AniListTag,
} from './schema'