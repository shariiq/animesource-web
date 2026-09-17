import { describe, expect, it } from 'vitest'
import { currentSeason, escapeHtml, formatAniDate, formatDate, formatEnum, formatStatus, nextSeasonOf, renderDescription, stripDescription, timeUntil, titleOf } from '../app/lib/format'

describe('format helpers', () => {
  it('formats enum and status values', () => {
    expect(formatEnum('NOT_YET_RELEASED')).toBe('Not Yet Released')
    expect(formatStatus('RELEASING')).toBe('Airing')
    expect(formatStatus(null)).toBe('')
  })
  it('formats AniList partial dates', () => {
    expect(formatAniDate({ year: 2024, month: 1, day: 3 })).toBe('Jan 3, 2024')
    expect(formatAniDate({ year: 2024, month: null, day: null })).toBe('2024')
    expect(formatAniDate(null)).toBe('')
  })
  it('formats valid dates and rejects invalid dates', () => {
    expect(formatDate('2024-01-03T00:00:00.000Z')).toContain('2024')
    expect(formatDate('not-a-date')).toBe('')
  })
  it('formats relative airing times', () => {
    expect(timeUntil(0)).toBe('airing now')
    expect(timeUntil(90)).toBe('1m')
    expect(timeUntil(90_000)).toBe('1d 1h')
  })
  it('calculates season boundaries and rollover', () => {
    expect(currentSeason(new Date(2024, 0, 1))).toEqual({ season: 'WINTER', year: 2024 })
    expect(currentSeason(new Date(2024, 8, 1))).toEqual({ season: 'FALL', year: 2024 })
    expect(nextSeasonOf(new Date(2024, 10, 1))).toEqual({ season: 'WINTER', year: 2025 })
  })
  it('escapes and sanitizes description markup', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;')
    expect(stripDescription('<b>Hello</b><br>world')).toBe('Hello world')
    expect(renderDescription('<img src=x onerror=alert(1)>Hello')).toBe('<p>Hello</p>')
  })
  it('selects the first available title', () => {
    expect(titleOf({ title: { english: null, romaji: 'Romaji', native: 'Native' } })).toBe('Romaji')
    expect(titleOf(null)).toBe('Untitled')
  })
})
