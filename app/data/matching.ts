import type { AniListDetail } from './anilist/types'
import type { AniSourceAnime } from './anisource/schema'

export const AUTO_MATCH_THRESHOLD = 0.86
export const AUTO_MATCH_MARGIN = 0.08

export interface TitleVariant {
  title: string
  label: 'English' | 'Romaji' | 'Native' | 'Synonym'
  normalized: string
}

export interface TitleCandidate {
  id: string
  title: string
  alternative_titles: string[]
}

export interface RankedCandidate<T extends TitleCandidate = AniSourceAnime> {
  candidate: T
  score: number
  aniListTitle: string
  sourceTitle: string
}

export type MatchResult<T extends TitleCandidate = AniSourceAnime> =
  | { kind: 'auto'; match: RankedCandidate<T>; ranked: RankedCandidate<T>[] }
  | { kind: 'picker'; ranked: RankedCandidate<T>[] }
  | { kind: 'empty'; ranked: [] }

const NOISE_WORDS = new Set(['the', 'anime', 'tv', 'series'])

/** Normalize Unicode, punctuation, spacing, and common title notation. */
export function normTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase()
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .replace(/\bseason\s+(\d+)\b/g, 's $1')
    .replace(/\b(\d+)(?:st|nd|rd|th)\s+season\b/g, 's $1')
    .replace(/\bpart\s+(\d+)\b/g, 'part $1')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenSet(title: string): Set<string> {
  return new Set(
    normTitle(title)
      .split(' ')
      .filter((token) => token && !NOISE_WORDS.has(token)),
  )
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection += 1
  return (2 * intersection) / (a.size + b.size)
}

function bigrams(value: string): Set<string> {
  const compact = normTitle(value).replaceAll(' ', '')
  if (compact.length < 2) return new Set(compact ? [compact] : [])
  return new Set(Array.from({ length: compact.length - 1 }, (_, index) => compact.slice(index, index + 2)))
}

function markers(value: string): Set<string> {
  return new Set(normTitle(value).split(' ').filter((token) => /^\d{1,4}$/.test(token)))
}

function titleScore(left: string, right: string): number {
  const normalizedLeft = normTitle(left)
  const normalizedRight = normTitle(right)
  if (!normalizedLeft || !normalizedRight) return 0
  if (normalizedLeft === normalizedRight) return 1

  const leftTokens = tokenSet(left)
  const rightTokens = tokenSet(right)
  const tokenScore = similarity(leftTokens, rightTokens)
  const characterScore = similarity(bigrams(left), bigrams(right))
  const containment = normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft) ? 1 : 0
  let score = tokenScore * 0.62 + characterScore * 0.28 + containment * 0.1

  const leftMarkers = markers(left)
  const rightMarkers = markers(right)
  if (leftMarkers.size && rightMarkers.size && ![...leftMarkers].some((value) => rightMarkers.has(value))) {
    score -= 0.22
  }
  return Math.max(0, Math.min(1, score))
}

export function titleVariants(anime: AniListDetail): TitleVariant[] {
  const values: Array<[string | null | undefined, TitleVariant['label']]> = [
    [anime.title?.english, 'English'],
    [anime.title?.romaji, 'Romaji'],
    [anime.title?.native, 'Native'],
    ...(anime.synonyms ?? []).map((title): [string | null | undefined, TitleVariant['label']] => [title, 'Synonym']),
  ]
  const seen = new Set<string>()
  const variants: TitleVariant[] = []
  for (const [title, label] of values) {
    if (!title) continue
    const normalized = normTitle(title)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    variants.push({ title, label, normalized })
  }
  return variants
}

export function rankCandidates<T extends TitleCandidate>(titles: readonly string[], candidates: T[]): RankedCandidate<T>[] {
  return candidates
    .map((candidate) => {
      let best: RankedCandidate<T> = { candidate, score: 0, aniListTitle: titles[0] ?? '', sourceTitle: candidate.title }
      const sourceTitles = [candidate.title, ...candidate.alternative_titles]
      for (const aniListTitle of titles) {
        for (const sourceTitle of sourceTitles) {
          const score = titleScore(aniListTitle, sourceTitle)
          if (score > best.score) best = { candidate, score, aniListTitle, sourceTitle }
        }
      }
      return best
    })
    .sort((left, right) => right.score - left.score || left.candidate.title.localeCompare(right.candidate.title))
}

export function findBestMatch(aniListTitle: string, candidates: AniSourceAnime[]): { index: number; score: number } {
  const ranked = rankCandidates([aniListTitle], candidates)
  const best = ranked[0]
  return best ? { index: candidates.findIndex((candidate) => candidate.id === best.candidate.id), score: best.score } : { index: -1, score: 0 }
}

export function matchFlow<T extends TitleCandidate>(aniListTitles: string | readonly string[], candidates: T[]): MatchResult<T> {
  if (!candidates.length) return { kind: 'empty', ranked: [] }
  const ranked = rankCandidates(typeof aniListTitles === 'string' ? [aniListTitles] : aniListTitles, candidates)
  const best = ranked[0]!
  const runnerUp = ranked[1]
  if (best.score >= AUTO_MATCH_THRESHOLD && (!runnerUp || best.score - runnerUp.score >= AUTO_MATCH_MARGIN)) {
    return { kind: 'auto', match: best, ranked }
  }
  return { kind: 'picker', ranked }
}
