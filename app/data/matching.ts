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

/**
 * Words that carry no identity signal: aggregator tags ("(TV)", "Movie") and
 * possessive residue ("Journey's" → "journey s end").
 */
const NOISE_WORDS = new Set(['the', 'anime', 'tv', 'series', 'movie', 's'])

/** Trailing ordinals streaming sites write as roman numerals ("Overlord II" = season 2). */
const ROMAN_ORDINALS: Readonly<Record<string, number>> = {
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
}

const ROMAN_ALTERNATION = '(viii|vii|iii|ii|iv|vi|ix|x|v)'
const SEASON_ROMAN_RE = new RegExp(`\\bseason\\s+${ROMAN_ALTERNATION}\\b`)
const PART_ROMAN_RE = new RegExp(`\\bpart\\s+${ROMAN_ALTERNATION}\\b`)
const YEAR_RE = /\b(19\d{2}|20\d{2})\b/
const SEASON_RE = /\bs\s+(\d{1,2})\b/
const PART_RE = /\b(?:part|cour)\s+(\d{1,2})\b/
const DIGIT_TOKEN_RE = /^\d{1,4}$/

/**
 * Normalize a title for comparison: Unicode-folded, lowercased, punctuation-free,
 * with equivalent notations unified — "Season 2" / "2nd Season" / "Season II" all
 * become "s 2", and "×" becomes "x" so "HUNTER×HUNTER" matches "Hunter x Hunter".
 */
export function normTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/×/g, ' x ')
    .replace(/&/g, ' and ')
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .replace(/\b(\d+)(?:st|nd|rd|th)\s+season\b/g, 's $1')
    .replace(/\bseason\s*(\d{1,2})\b/g, 's $1')
    .replace(SEASON_ROMAN_RE, (_match, numeral: string) => `s ${ROMAN_ORDINALS[numeral]}`)
    .replace(PART_ROMAN_RE, (_match, numeral: string) => `part ${ROMAN_ORDINALS[numeral]}`)
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

/** Sørensen–Dice coefficient over two sets: `2|A∩B| / (|A| + |B|)`. */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection += 1
  return (2 * intersection) / (a.size + b.size)
}

/**
 * Everything the scorer needs from a title, computed once per unique string and
 * memoized. The previous implementation re-normalized both sides of every pair
 * up to ten times per comparison, which dominated the entire cost of matching.
 */
interface TitleFeatures {
  normalized: string
  compact: string
  tokens: Set<string>
  bigrams: Set<string>
  year: number | null
  season: number | null
  part: number | null
  digits: Set<string>
}

const FEATURE_CACHE_LIMIT = 4096
const featureCache = new Map<string, TitleFeatures>()

function features(title: string): TitleFeatures {
  const cached = featureCache.get(title)
  if (cached) return cached
  if (featureCache.size >= FEATURE_CACHE_LIMIT) featureCache.clear()
  // The cache only holds pure, request-independent derivations of the key string.
  const computed = computeFeatures(title)
  featureCache.set(title, computed)
  return computed
}

function computeFeatures(title: string): TitleFeatures {
  const normalized = normTitle(title)
  const compact = normalized.replaceAll(' ', '')

  // A trailing roman numeral ("Mob Psycho 100 II") is how sources write
  // "Season 2": fold it into the token stream and record it as the ordinal.
  const words = normalized.split(' ').filter(Boolean)
  let romanSeason: number | null = null
  const tokens = new Set<string>()
  for (let index = 0; index < words.length; index += 1) {
    let word = words[index]!
    const ordinal = ROMAN_ORDINALS[word]
    if (ordinal !== undefined && index === words.length - 1 && words.length > 1) {
      romanSeason = ordinal
      word = String(ordinal)
    }
    if (!NOISE_WORDS.has(word)) tokens.add(word)
  }

  const yearMatch = normalized.match(YEAR_RE)
  const seasonMatch = normalized.match(SEASON_RE)
  const partMatch = normalized.match(PART_RE)
  const year = yearMatch ? Number(yearMatch[1]) : null
  const season = seasonMatch ? Number(seasonMatch[1]) : romanSeason
  const part = partMatch ? Number(partMatch[1]) : null

  // Identity numbers that are not ordinals ("Mob Psycho **100**", "**86**").
  const ordinals = new Set([year, season, part].filter((value): value is number => value !== null))
  const digits = new Set<string>()
  for (const token of tokens) {
    if (DIGIT_TOKEN_RE.test(token) && !ordinals.has(Number(token))) digits.add(token)
  }

  return { normalized, compact, tokens, bigrams: bigramsOf(compact), year, season, part, digits }
}

function bigramsOf(compact: string): Set<string> {
  if (compact.length < 2) return new Set(compact ? [compact] : [])
  const bigrams = new Set<string>()
  for (let index = 0; index < compact.length - 1; index += 1) bigrams.add(compact.slice(index, index + 2))
  return bigrams
}

/** IDF weights over the candidate corpus, with a fallback for query tokens it never saw. */
interface TokenWeights {
  weights: Map<string, number>
  fallback: number
}

/**
 * Score a pair of titles in [0, 1].
 *
 * Three complementary signals are blended:
 * - IDF-weighted token Dice (55%): shared rare words ("kokurasetai") count far
 *   more than shared filler ("no", "wa"), so long romaji titles still rank
 *   correctly against short English variants.
 * - Character-bigram Dice on the compacted string (30%): tolerates spacing,
 *   punctuation, and minor spelling drift between sources.
 * - Graduated containment (15%): scaled by how much of the longer title the
 *   shorter one covers, so "Attack on Titan" ⊂ "Attack on Titan: Junior High"
 *   helps ranking but can never outscore a genuine full match.
 *
 * Numeric identity markers then adjust the blend: a conflicting release year or
 * season/part ordinal is strong evidence of a *different* entry (Hunter x
 * Hunter 1999 vs 2011, Season 2 vs Season 3), while agreement corroborates.
 */
function pairScore(a: TitleFeatures, b: TitleFeatures, tokens: TokenWeights): number {
  if (!a.normalized || !b.normalized) return 0
  if (a.normalized === b.normalized) return 1

  const tokenScore = weightedTokenDice(a.tokens, b.tokens, tokens)
  const characterScore = similarity(a.bigrams, b.bigrams)
  const containment = containmentScore(a, b)
  const score = tokenScore * 0.55 + characterScore * 0.3 + containment * 0.15 + markerAdjustment(a, b)
  return Math.max(0, Math.min(1, score))
}

function weightedTokenDice(a: Set<string>, b: Set<string>, tokens: TokenWeights): number {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  let total = 0
  for (const token of a) {
    const weight = tokens.weights.get(token) ?? tokens.fallback
    total += weight
    if (b.has(token)) shared += weight
  }
  for (const token of b) total += tokens.weights.get(token) ?? tokens.fallback
  return (2 * shared) / total
}

function containmentScore(a: TitleFeatures, b: TitleFeatures): number {
  const [shorter, longer] = a.compact.length <= b.compact.length ? [a, b] : [b, a]
  if (!shorter.compact) return 0
  let best = 0
  if (longer.compact.includes(shorter.compact)) best = shorter.compact.length / longer.compact.length
  let overlap = 0
  for (const token of shorter.tokens) if (longer.tokens.has(token)) overlap += 1
  if (shorter.tokens.size > 0 && longer.tokens.size > 0) {
    best = Math.max(best, (overlap / shorter.tokens.size) * (shorter.tokens.size / longer.tokens.size))
  }
  return best
}

function markerAdjustment(a: TitleFeatures, b: TitleFeatures): number {
  return (
    ordinalAdjustment(a.year, b.year, 0.05, -0.3, -0.04) +
    ordinalAdjustment(a.season, b.season, 0.04, -0.3, -0.03) +
    ordinalAdjustment(a.part, b.part, 0.04, -0.25, -0.03) +
    digitAdjustment(a.digits, b.digits)
  )
}

/** Ordinals stated by both sides must agree; a conflict is near-decisive. */
function ordinalAdjustment(
  a: number | null,
  b: number | null,
  agreement: number,
  conflict: number,
  oneSided: number,
): number {
  if (a !== null && b !== null) return a === b ? agreement : conflict
  if (a !== null || b !== null) return oneSided
  return 0
}

/** Leftover identity numbers must overlap when both sides carry them. */
function digitAdjustment(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  for (const digit of a) if (b.has(digit)) return 0
  return -0.15
}

/** Inverse document frequency over every candidate title string being ranked. */
function buildTokenWeights(documents: TitleFeatures[]): TokenWeights {
  const frequency = new Map<string, number>()
  for (const document of documents) {
    for (const token of document.tokens) frequency.set(token, (frequency.get(token) ?? 0) + 1)
  }
  const weights = new Map<string, number>()
  for (const [token, count] of frequency) weights.set(token, Math.log(1 + documents.length / count))
  return { weights, fallback: Math.log(1 + documents.length) }
}

interface ScoredTitle {
  raw: string
  parsed: TitleFeatures
}

/** Extract features for each distinct non-empty title, preserving first-seen order. */
function scoredTitles(rawTitles: readonly string[]): ScoredTitle[] {
  const seen = new Set<string>()
  const scored: ScoredTitle[] = []
  for (const raw of rawTitles) {
    const parsed = features(raw)
    if (!parsed.normalized || seen.has(parsed.normalized)) continue
    seen.add(parsed.normalized)
    scored.push({ raw, parsed })
  }
  return scored
}

export function rankCandidates<T extends TitleCandidate>(titles: readonly string[], candidates: T[]): RankedCandidate<T>[] {
  const queries = scoredTitles(titles)
  const sources = candidates.map((candidate) => scoredTitles([candidate.title, ...candidate.alternative_titles]))
  const tokens = buildTokenWeights(sources.flatMap((candidateTitles) => candidateTitles.map(({ parsed }) => parsed)))

  return candidates
    .map((candidate, index) => bestCandidateScore(candidate, queries, sources[index]!, tokens, titles[0] ?? ''))
    .sort((left, right) => right.score - left.score || left.candidate.title.localeCompare(right.candidate.title))
}

function bestCandidateScore<T extends TitleCandidate>(
  candidate: T,
  queries: ScoredTitle[],
  sources: ScoredTitle[],
  tokens: TokenWeights,
  fallbackTitle: string,
): RankedCandidate<T> {
  let best: RankedCandidate<T> = { candidate, score: 0, aniListTitle: fallbackTitle, sourceTitle: candidate.title }
  for (const query of queries) {
    for (const source of sources) {
      const score = pairScore(query.parsed, source.parsed, tokens)
      if (score > best.score) best = { candidate, score, aniListTitle: query.raw, sourceTitle: source.raw }
      if (best.score === 1) return best
    }
  }
  return best
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

export function findBestMatch(aniListTitle: string, candidates: AniSourceAnime[]): { index: number; score: number } {
  const ranked = rankCandidates([aniListTitle], candidates)
  const best = ranked[0]
  return best
    ? { index: candidates.findIndex((candidate) => candidate.id === best.candidate.id), score: best.score }
    : { index: -1, score: 0 }
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
