import { describe, expect, it } from 'vitest'
import { countdownLabel, dateFromKey, extractScheduleGenres, filterScheduleItems, groupScheduleByDay, itemsInRange, localDateKey, scheduleRange, shiftedDateKey } from '../app/lib/schedule'
import type { AniListScheduleItem } from '../app/data/anilist/types'

const item = (airingAt: number): AniListScheduleItem => ({ episode: 1, airingAt, media: null })

describe('schedule calendar helpers', () => {
  it('uses local calendar boundaries for day and Monday-based week views', () => {
    const day = scheduleRange('2026-09-17', 'day')
    expect(localDateKey(day.start)).toBe('2026-09-17')
    expect(localDateKey(day.end)).toBe('2026-09-18')

    const week = scheduleRange('2026-09-17', 'week')
    expect(localDateKey(week.start)).toBe('2026-09-14')
    expect(localDateKey(week.end)).toBe('2026-09-21')
  })

  it('navigates calendar dates without UTC conversion', () => {
    expect(shiftedDateKey('2026-01-01', 'day', -1)).toBe('2025-12-31')
    expect(shiftedDateKey('2026-01-01', 'week', 1)).toBe('2026-01-08')
    expect(() => dateFromKey('2026-02-30')).toThrow('Invalid calendar date')
  })

  it('filters half-open ranges and groups items by local date', () => {
    const start = dateFromKey('2026-09-17')
    const end = dateFromKey('2026-09-18')
    const atStart = item(start.getTime() / 1000)
    const atEnd = item(end.getTime() / 1000)
    expect(itemsInRange([atStart, atEnd], start, end)).toEqual([atStart])
    expect(groupScheduleByDay([atStart]).get('2026-09-17')).toEqual([atStart])
  })

  it('formats current, past, and future countdowns', () => {
    const now = Date.UTC(2026, 8, 17, 12)
    expect(countdownLabel(now / 1000, now)).toBe('Airing now')
    expect(countdownLabel((now - 120_000) / 1000, now)).toBe('Aired')
    expect(countdownLabel((now + 90 * 60_000) / 1000, now)).toBe('In 1h 30m')
  })

  it('filters schedule items by saved IDs, genre, and status', () => {
    const anime = (id: number, genres: string[], status: string) => ({
      episode: 1,
      airingAt: 0,
      media: { id, genres, status, title: null, coverImage: null, format: null }
    })
    const items = [
      anime(1, ['Action'], 'RELEASING'),
      anime(2, ['Comedy', 'Action'], 'NOT_YET_RELEASED'),
      anime(3, ['Drama'], 'RELEASING'),
    ]

    expect(filterScheduleItems(items, { genre: 'Action' }).map(i => i.media?.id)).toEqual([1, 2])
    expect(filterScheduleItems(items, { genre: 'Drama' }).map(i => i.media?.id)).toEqual([3])
    expect(filterScheduleItems(items, { status: 'RELEASING' }).map(i => i.media?.id)).toEqual([1, 3])
    expect(filterScheduleItems(items, { saved: new Set([2, 3]) }).map(i => i.media?.id)).toEqual([2, 3])
    expect(filterScheduleItems(items, { saved: new Set([2]), genre: 'Action' }).map(i => i.media?.id)).toEqual([2])
  })

  it('extracts unique genres sorted from schedule items', () => {
    const items = [
      { episode: 1, airingAt: 0, media: { id: 1, genres: ['Action', 'Mecha'], status: '', title: null, coverImage: null, format: null } },
      { episode: 1, airingAt: 0, media: { id: 2, genres: ['Zombies', 'Action'], status: '', title: null, coverImage: null, format: null } },
    ]
    expect(extractScheduleGenres(items)).toEqual(['Action', 'Mecha', 'Zombies'])
  })
})
