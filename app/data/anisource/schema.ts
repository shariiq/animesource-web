import { z } from 'zod'

// ---- AniSource API response schemas (validated at the boundary) ----
// Fields the OpenAPI spec marks optional are treated as optional here too —
// the backend docs explicitly warn not every listed field is always present.

export const healthResponseSchema = z.object({
  status: z.string().default('ok'),
  version: z.string(),
  uptime_seconds: z.number(),
  memory_usage_mb: z.number(),
  active_sources: z.number().int(),
  // OpenAPI intentionally permits backend-specific observability counters here.
  cache_stats: z.record(z.string(), z.unknown()),
})
export type HealthResponse = z.infer<typeof healthResponseSchema>

export const sourceInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  base_url: z.string(),
})
export type SourceInfo = z.infer<typeof sourceInfoSchema>

export const sourceListResponseSchema = z.object({
  sources: z.array(sourceInfoSchema),
  count: z.number(),
})
export type SourceListResponse = z.infer<typeof sourceListResponseSchema>

export const anisourceAnimeSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  thumbnail: z.string().default(''),
  description: z.string().default(''),
  genres: z.array(z.string()).default([]),
  studios: z.array(z.string()).default([]),
  producers: z.array(z.string()).default([]),
  alternative_titles: z.array(z.string()).default([]),
  status: z.string().default('unknown'),
  score: z.number().nullable().optional(),
  tags: z.array(z.string()).default([]),
})
export type AniSourceAnime = z.infer<typeof anisourceAnimeSchema>

export const searchResponseSchema = z.object({
  items: z.array(anisourceAnimeSchema),
  page: z.number(),
  has_next: z.boolean(),
  total_returned: z.number(),
})
export type SearchResponse = z.infer<typeof searchResponseSchema>

export const anisourceMangaSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  thumbnail: z.string().default(''),
  description: z.string().default(''),
  genres: z.array(z.string()).default([]),
  authors: z.array(z.string()).default([]),
  artists: z.array(z.string()).default([]),
  alternative_titles: z.array(z.string()).default([]),
  status: z.string().default('unknown'),
})
export type AniSourceManga = z.infer<typeof anisourceMangaSchema>

export const mangaSearchResponseSchema = z.object({
  items: z.array(anisourceMangaSchema),
  page: z.number().int(),
  has_next: z.boolean(),
  total_returned: z.number().int(),
})
export type MangaSearchResponse = z.infer<typeof mangaSearchResponseSchema>

export const mangaChapterSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  number: z.number().default(0),
  volume: z.number().nullable().optional(),
  scanlator: z.string().default(''),
  language: z.string().default(''),
  released_at: z.string().datetime().nullable().optional(),
})
export type MangaChapter = z.infer<typeof mangaChapterSchema>

export const chapterPageSchema = z.object({
  index: z.number().int(),
  url: z.string(),
  page_url: z.string().default(''),
})
export type ChapterPage = z.infer<typeof chapterPageSchema>

export const episodeSchema = z.object({
  id: z.string(),
  number: z.number(),
  title: z.string(),
  is_filler: z.boolean().default(false),
  has_sub: z.boolean().default(false),
  has_dub: z.boolean().default(false),
  scanlator: z.string().default(''),
  released_at: z.string().nullable().optional(),
})
export type Episode = z.infer<typeof episodeSchema>

export const serverSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
})
export type Server = z.infer<typeof serverSchema>

export const subtitleSchema = z.object({
  url: z.string(),
  label: z.string().default(''),
  language: z.string().default(''),
})
export type Subtitle = z.infer<typeof subtitleSchema>

export const streamSchema = z.object({
  url: z.string(),
  quality: z.string(),
  headers: z.record(z.string(), z.string()).default({}),
  subtitles: z.array(subtitleSchema).default([]),
  is_hls: z.boolean().default(false),
  is_audio: z.boolean().default(false),
})
export type Stream = z.infer<typeof streamSchema>
