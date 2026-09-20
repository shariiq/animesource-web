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

/** Durable per-episode state. ContinueItem remains the latest-per-anime projection. */
export const playbackRecordSchema = z.object({
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
  completedAt: z.number().nullable().default(null),
  ts: z.number(),
})
export type PlaybackRecord = z.infer<typeof playbackRecordSchema>

export const playbackPreferencesSchema = z.object({
  quality: z.string().nullable().default(null),
  subtitleLanguage: z.string().nullable().default(null),
  subtitleLabel: z.string().nullable().default(null),
  updatedAt: z.number().nonnegative().optional(),
})
export type PlaybackPreferences = z.infer<typeof playbackPreferencesSchema>

export const viewerProfileSchema = z.object({
  displayName: z.string().trim().max(80).default(''),
  updatedAt: z.number().nonnegative().default(0),
})
export type ViewerProfile = z.infer<typeof viewerProfileSchema>

export const viewerPreferencesSchema = z.object({
  adultContent: z.boolean().default(false),
  language: z.string().trim().min(2).max(20).default('en'),
  timezone: z.string().trim().min(1).max(100).default('UTC'),
  notifications: z.boolean().default(false),
  updatedAt: z.number().nonnegative().default(0),
})
export type ViewerPreferences = z.infer<typeof viewerPreferencesSchema>

export const viewerProfileDoc = z.object({
  v: z.literal(1),
  data: viewerProfileSchema,
})
export const viewerPreferencesDoc = z.object({
  v: z.literal(1),
  data: viewerPreferencesSchema,
})

export const playbackDoc = z.object({
  v: z.literal(1),
  data: playbackRecordSchema,
})
export const playbackPrefsDoc = z.object({
  v: z.literal(1),
  data: playbackPreferencesSchema,
})

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
export const timestampDoc = z.object({
  v: z.literal(1),
  data: z.number().nonnegative(),
})
export const matchDoc = z.object({
  v: z.literal(1),
  data: matchItemSchema,
})
export const searchHistoryDoc = z.object({
  v: z.literal(1),
  data: z.array(searchHistoryItemSchema).max(8),
})

export const viewerTombstoneSchema = z.object({
  collection: z.enum(['favorites', 'continue', 'playback', 'matches']),
  key: z.string().min(1),
  ts: z.number().nonnegative(),
})
export type ViewerTombstone = z.infer<typeof viewerTombstoneSchema>

export const viewerTombstonesDoc = z.object({
  v: z.literal(1),
  data: z.array(viewerTombstoneSchema).max(2_000),
})

export const viewerMatchExportSchema = z.object({
  anilistId: z.number().int().positive(),
  match: matchItemSchema,
  updatedAt: z.number().nonnegative().default(0),
})
export type ViewerMatchExport = z.infer<typeof viewerMatchExportSchema>

export const viewerExportSchema = z.object({
  source: z.literal('animesource-viewer'),
  version: z.literal(1),
  exportedAt: z.number().nonnegative(),
  profile: viewerProfileSchema,
  preferences: viewerPreferencesSchema,
  favorites: z.array(favoriteItemSchema).max(300),
  continue: z.array(continueItemSchema).max(20),
  playback: z.array(playbackRecordSchema).max(2_000),
  playbackPreferences: playbackPreferencesSchema,
  preferredSource: z.string().nullable(),
  preferredSourceUpdatedAt: z.number().nonnegative().default(0),
  matches: z.array(viewerMatchExportSchema).max(300),
  searchHistory: z.array(searchHistoryItemSchema).max(8),
  tombstones: z.array(viewerTombstoneSchema).max(2_000),
})
export type ViewerExport = z.infer<typeof viewerExportSchema>

export const viewerSyncStatusSchema = z.object({
  state: z.enum(['local-only', 'idle', 'syncing', 'error']),
  lastSyncedAt: z.number().nonnegative().nullable(),
  pendingChanges: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
})
export type ViewerSyncStatus = z.infer<typeof viewerSyncStatusSchema>

export const viewerSyncStatusDoc = z.object({
  v: z.literal(1),
  data: viewerSyncStatusSchema,
})
