import { z } from 'zod'

export interface Versioned<T> {
  v: number
  data: T
}

export const favoriteStatusSchema = z.enum(['WATCHING', 'COMPLETED', 'PLANNING', 'PAUSED', 'DROPPED'])
export type FavoriteStatus = z.infer<typeof favoriteStatusSchema>

export const favoriteItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  cover: z.string().default(''),
  format: z.string().nullable().default(null),
  averageScore: z.number().nullable().default(null),
  // Version-1 records created before status support are planning by default.
  status: favoriteStatusSchema.default('PLANNING'),
  ts: z.number(),
})
export type FavoriteItem = z.infer<typeof favoriteItemSchema>

export const continueItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  cover: z.string().default(''),
  sourceId: z.string(),
  sourceName: z.string().default(''),
  animeId: z.string(),
  episodeId: z.string(),
  episodeNumber: z.number(),
  position: z.number().nonnegative().default(0),
  duration: z.number().nonnegative().default(0),
  completed: z.boolean().default(false),
  ts: z.number(),
})
export type ContinueItem = z.infer<typeof continueItemSchema>

export const matchItemSchema = z.object({
  sourceId: z.string(),
  animeId: z.string(),
  title: z.string().default(''),
})
export type MatchItem = z.infer<typeof matchItemSchema>

export const searchHistoryItemSchema = z.object({
  query: z.string().trim().min(1).max(100),
  ts: z.number(),
})
export type SearchHistoryItem = z.infer<typeof searchHistoryItemSchema>

export const favoritesDoc = z.object({
  v: z.literal(1),
  data: z.array(favoriteItemSchema),
})
export const continueDoc = z.object({
  v: z.literal(1),
  data: z.array(continueItemSchema).max(20),
})
export const prefSourceDoc = z.object({
  v: z.literal(1),
  data: z.string(),
})
export const matchDoc = z.object({
  v: z.literal(1),
  data: matchItemSchema,
})
export const searchHistoryDoc = z.object({
  v: z.literal(1),
  data: z.array(searchHistoryItemSchema).max(8),
})
