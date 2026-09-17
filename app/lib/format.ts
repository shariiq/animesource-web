import type { AniListDate, AniListMedia } from '../data/anilist/types'

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return entities[character] ?? character
  })
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

export function formatUptime(seconds: number | null | undefined): string {
  const value = Math.round(seconds ?? 0)
  const days = Math.floor(value / 86_400)
  const hours = Math.floor((value % 86_400) / 3_600)
  const minutes = Math.floor((value % 3_600) / 60)
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${minutes}m`
  return `${minutes}m ${value % 60}s`
}

export function formatEnum(value: string | null | undefined): string {
  return String(value ?? '')
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

export function formatStatus(value: string | null | undefined): string {
  const names: Record<string, string> = {
    FINISHED: 'Finished',
    RELEASING: 'Airing',
    NOT_YET_RELEASED: 'Upcoming',
    CANCELLED: 'Cancelled',
    HIATUS: 'Hiatus',
  }
  return value ? (names[value] ?? formatEnum(value)) : ''
}

export function formatSeason(value: string | null | undefined): string {
  return value ? value[0] + value.slice(1).toLowerCase() : ''
}

const compactNumber = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatCompactNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : compactNumber.format(value)
}

export function formatScore(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : `${value}%`
}

export function formatRank(rank: number | null | undefined): string {
  if (rank === null || rank === undefined) return ''
  const modulo100 = rank % 100
  const suffix = modulo100 >= 11 && modulo100 <= 13
    ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' } as const)[rank % 10 as 1 | 2 | 3] ?? 'th'
  return `${rank}${suffix}`
}

export function joinPresent(
  values: ReadonlyArray<string | number | null | undefined>,
  separator = ' · ',
): string {
  return values
    .filter((value): value is string | number => value !== null && value !== undefined && value !== '')
    .join(separator)
}

export function formatAniDate(date: AniListDate | null | undefined): string {
  if (!date?.year) return ''
  const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const month = date.month ? months[date.month] : undefined
  if (date.day && month) return `${month} ${date.day}, ${date.year}`
  if (month) return `${month} ${date.year}`
  return String(date.year)
}

export function timeUntil(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return ''
  if (seconds <= 0) return 'airing now'
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function titleOf(media: Pick<AniListMedia, 'title'> | null | undefined): string {
  return (
    media?.title?.english ||
    media?.title?.romaji ||
    media?.title?.native ||
    'Untitled'
  )
}

export function stripDescriptionKeepNewlines(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

export function stripDescription(value: string | null | undefined): string {
  return stripDescriptionKeepNewlines(value).replace(/\s+/g, ' ').trim()
}

/** Returns safe escaped paragraph markup used by the rich description block. */
export function renderDescription(value: string | null | undefined): string {
  const clean = stripDescriptionKeepNewlines(value)
  if (!clean) return ''
  return clean
    .split(/\n\s*\n|\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join('')
}

export function currentSeason(date: Date = new Date()): { season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL'; year: number } {
  const month = date.getMonth() + 1
  const year = date.getFullYear()
  if (month <= 2) return { season: 'WINTER', year }
  if (month <= 5) return { season: 'SPRING', year }
  if (month <= 8) return { season: 'SUMMER', year }
  return { season: 'FALL', year }
}

export function nextSeasonOf(date: Date = new Date()): ReturnType<typeof currentSeason> {
  const current = currentSeason(date)
  const order = ['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const
  const index = order.indexOf(current.season)
  return index === 3
    ? { season: 'WINTER', year: current.year + 1 }
    : { season: order[index + 1] ?? 'WINTER', year: current.year }
}
