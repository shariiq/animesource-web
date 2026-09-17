import { describe, expect, it } from 'vitest'
import { findBestMatch, matchFlow, normTitle, rankCandidates, similarity, titleVariants, tokenSet } from '../app/data/matching'
import type { AniSourceAnime } from '../app/data/anisource/schema'

const anime = (over: Partial<AniSourceAnime>): AniSourceAnime => ({
  id: '1',
  title: 'Example Title',
  url: '',
  thumbnail: '',
  description: '',
  genres: [],
  studios: [],
  producers: [],
  alternative_titles: [],
  status: 'unknown',
  score: null,
  tags: [],
  ...over,
})

describe('normTitle', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normTitle('  Attack ON Titan!! ')).toBe('attack on titan')
  })
  it('handles empty input', () => {
    expect(normTitle('')).toBe('')
  })
})

describe('tokenSet / similarity', () => {
  it('returns 1 for two empty sets', () => {
    expect(similarity(tokenSet(''), tokenSet(''))).toBe(1)
  })
  it('returns 0 when one set is empty', () => {
    expect(similarity(tokenSet('a b'), tokenSet(''))).toBe(0)
  })
  it('computes the Dice coefficient', () => {
    expect(similarity(tokenSet('a b c'), tokenSet('a b d'))).toBeCloseTo(2 / 3, 5)
  })
  it('returns 1 for identical sets', () => {
    expect(similarity(tokenSet('one two'), tokenSet('one two'))).toBe(1)
  })
})

describe('findBestMatch', () => {
  it('returns index -1 with score 0 for an empty candidate list', () => {
    expect(findBestMatch('Some Title', [])).toEqual({ index: -1, score: 0 })
  })
  it('exact title match returns score 1', () => {
    const candidates = [anime({ id: 'x', title: 'One Piece' }), anime({ id: 'y', title: 'Naruto' })]
    expect(findBestMatch('One Piece', candidates)).toEqual({ index: 0, score: 1 })
  })
  it('picks the highest-similarity candidate', () => {
    const candidates = [anime({ id: 'x', title: 'Attack on Titan' }), anime({ id: 'y', title: 'A Certain Scientific Railgun' })]
    const result = findBestMatch('Attack on Titan: Final Season', candidates)
    expect(result.index).toBe(0)
  })
})

describe('matchFlow', () => {
  it('returns an empty state for no candidates', () => {
    expect(matchFlow('Anything', [])).toEqual({ kind: 'empty', ranked: [] })
  })
  it('auto-confirms a high-similarity match', () => {
    const result = matchFlow('One Piece', [anime({ title: 'One Piece' })])
    expect(result.kind).toBe('auto')
    if (result.kind === 'auto') expect(result.match.score).toBeGreaterThanOrEqual(0.86)
  })
  it('shows a picker for ambiguous candidates', () => {
    const result = matchFlow('Attack on Titan', [
      anime({ id: 'a', title: 'Attack on Titan: Junior High' }),
      anime({ id: 'b', title: 'Attack on Titan: Chronicle' }),
    ])
    expect(result.kind).toBe('picker')
  })

  it('ranks AniSource alternative titles against every AniList alias', () => {
    const candidates = [
      anime({ id: 'wrong', title: 'Fate/Grand Order' }),
      anime({ id: 'right', title: 'Shingeki no Kyojin', alternative_titles: ['Attack on Titan Final Season'] }),
    ]
    const ranked = rankCandidates(['Attack on Titan: The Final Season', 'Shingeki no Kyojin The Final Season'], candidates)
    expect(ranked[0]?.candidate.id).toBe('right')
    expect(ranked[0]?.sourceTitle).toBe('Attack on Titan Final Season')
  })

  it('deduplicates all AniList title variants for source search', () => {
    const variants = titleVariants({
      id: 1,
      type: 'ANIME',
      title: { english: 'One Piece', romaji: 'One Piece', native: 'ワンピース' },
      coverImage: null,
      bannerImage: null,
      averageScore: null,
      popularity: null,
      format: null,
      status: null,
      episodes: null,
      season: null,
      seasonYear: null,
      genres: null,
      nextAiringEpisode: null,
      description: null,
      duration: null,
      startDate: null,
      endDate: null,
      source: null,
      synonyms: ['ONE PIECE', 'The One Piece'],
      studios: null,
      trailer: null,
      externalLinks: null,
      characters: null,
      relations: null,
      recommendations: null,
    })
    expect(variants.map((variant) => variant.title)).toEqual(['One Piece', 'ワンピース', 'The One Piece'])
  })

  // Proven against a real pair: AniList "HUNTER×HUNTER (2011)" maps to an
  // AniSource entry titled "HUNTER×HUNTER (2011)" — near-identical normalized
  // tokens must auto-confirm.
  it('auto-confirms a real AniList/AniSource sample pair', () => {
    const anilistTitle = 'HUNTER×HUNTER (2011)'
    const candidates = [anime({ id: 'hxh', title: 'HUNTER×HUNTER (2011)' }), anime({ id: 'other', title: 'Hunter x Hunter 1999' })]
    const result = matchFlow(anilistTitle, candidates)
    expect(result.kind).toBe('auto')
    if (result.kind === 'auto') expect(result.match.candidate.id).toBe('hxh')
  })
})
