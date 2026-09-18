import { z } from 'zod'
import type { AniListScheduleItem } from '../data/anilist/types'

export const SCHEDULE_VIEWS = ['day', 'week'] as const
export type ScheduleView = (typeof SCHEDULE_VIEWS)[number]

export const scheduleSearchSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  view: z.enum(SCHEDULE_VIEWS).catch('week'),
  saved: z.preprocess((value) => value === true || value === 'true', z.boolean()).catch(false),
  genre: z.string().optional(),
  status: z.string().optional(),
}).transform((value) => ({ ...value, date: value.date ?? localDateKey(new Date()) }))
export type ScheduleSearch = z.infer<typeof scheduleSearchSchema>

export function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function dateFromKey(key: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!match) throw new Error(`Invalid calendar date: ${key}`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (localDateKey(date) !== key) throw new Error(`Invalid calendar date: ${key}`)
  return date
}

export function startOfLocalWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const mondayOffset = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - mondayOffset)
  return start
}

export function scheduleRange(dateKey: string, view: ScheduleView): { start: Date; end: Date } {
  const selected = dateFromKey(dateKey)
  const start = view === 'week'
    ? startOfLocalWeek(selected)
    : new Date(selected.getFullYear(), selected.getMonth(), selected.getDate())
  const end = new Date(start)
  end.setDate(end.getDate() + (view === 'week' ? 7 : 1))
  return { start, end }
}

export function shiftedDateKey(dateKey: string, view: ScheduleView, direction: -1 | 1): string {
  const date = dateFromKey(dateKey)
  date.setDate(date.getDate() + direction * (view === 'week' ? 7 : 1))
  return localDateKey(date)
}

export function scheduleRequestRange(dateKey: string, view: ScheduleView): { start: number; end: number } {
  const { start, end } = scheduleRange(dateKey, view)
  const paddedStart = new Date(start)
  const paddedEnd = new Date(end)
  paddedStart.setDate(paddedStart.getDate() - 1)
  paddedEnd.setDate(paddedEnd.getDate() + 1)
  return { start: Math.floor(paddedStart.getTime() / 1000), end: Math.ceil(paddedEnd.getTime() / 1000) }
}

export function itemsInRange(items: readonly AniListScheduleItem[], start: Date, end: Date): AniListScheduleItem[] {
  const startSeconds = start.getTime() / 1000
  const endSeconds = end.getTime() / 1000
  return items.filter((item) => item.airingAt >= startSeconds && item.airingAt < endSeconds)
}

export function groupScheduleByDay(items: readonly AniListScheduleItem[]): Map<string, AniListScheduleItem[]> {
  const groups = new Map<string, AniListScheduleItem[]>()
  for (const item of items) {
    const key = localDateKey(new Date(item.airingAt * 1000))
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return groups
}

export function countdownLabel(airingAt: number, now = Date.now()): string {
  const difference = airingAt * 1000 - now
  if (Math.abs(difference) < 60_000) return 'Airing now'
  if (difference < 0) return 'Aired'
  const minutes = Math.floor(difference / 60_000)
  const days = Math.floor(minutes / 1_440)
  const hours = Math.floor((minutes % 1_440) / 60)
  if (days > 0) return `In ${days}d ${hours}h`
  if (hours > 0) return `In ${hours}h ${minutes % 60}m`
  return `In ${minutes}m`
}

export function filterScheduleItems(
  items: readonly AniListScheduleItem[],
  filters: { saved?: ReadonlySet<number>; genre?: string; status?: string },
): AniListScheduleItem[] {
  return items.filter((item) => {
    if (filters.saved && filters.saved.size > 0 && item.media?.id !== undefined && !filters.saved.has(item.media.id)) return false
    if (filters.genre && !(item.media?.genres ?? []).some((g) => g === filters.genre)) return false
    if (filters.status && item.media?.status !== filters.status) return false
    return true
  })
}

export function extractScheduleGenres(items: readonly AniListScheduleItem[]): string[] {
  const genres = new Set<string>()
  for (const item of items) {
    for (const genre of item.media?.genres ?? []) {
      if (genre) genres.add(genre)
    }
  }
  return [...genres].sort()
}
