import { describe, expect, it } from 'vitest'
import { detailShape } from '../app/data/anilist/schema'
import {
  getDetailLinks,
  getDetailTitles,
  getDetailTags,
  getOrderedRelations,
  getSingleMangaSourceRelation,
  getStaffMembers,
  getStudios,
  isSafeExternalUrl,
} from '../app/components/anime/detail/model'

const detail = detailShape.parse({
  id: 42,
  siteUrl: 'https://anilist.co/anime/42',
  title: { english: 'Signal: The Series', romaji: 'Signal', native: 'シグナル' },
  coverImage: null,
  bannerImage: null,
  averageScore: 84,
  popularity: 100,
  format: 'TV',
  status: 'FINISHED',
  episodes: 12,
  season: 'FALL',
  seasonYear: 2025,
  genres: ['Drama'],
  nextAiringEpisode: null,
  description: null,
  duration: 24,
  startDate: null,
  endDate: null,
  source: 'ORIGINAL',
  synonyms: ['Signal', 'シグナル'],
  studios: {
    nodes: [
      { id: 7, name: 'Signal Studio', isAnimationStudio: true, siteUrl: 'https://anilist.co/staff/7' },
      { id: 8, name: 'Network', isAnimationStudio: false, siteUrl: null },
    ],
  },
  trailer: null,
  externalLinks: [
    { id: 1, site: 'Official', type: 'STREAMING', language: 'English', color: null, icon: null, url: 'https://example.com/signal', isDisabled: false },
    { id: 2, site: 'Dead link', type: 'INFO', language: null, color: null, icon: null, url: 'https://example.com/dead', isDisabled: true },
    { id: 3, site: 'Unsafe', type: null, language: null, color: null, icon: null, url: 'javascript:alert(1)', isDisabled: false },
  ],
  rankings: null,
  tags: [
    { id: 1, name: 'Time Travel', description: 'A theme', category: 'テーマ', rank: 90, isGeneralSpoiler: false, isMediaSpoiler: false, isAdult: false },
    { id: 2, name: 'Spoiler', description: null, category: 'Technical', rank: 100, isGeneralSpoiler: true, isMediaSpoiler: false, isAdult: false },
  ],
  characters: {
    edges: [
      {
        role: 'MAIN',
        node: { id: 5, name: { full: 'Ada' }, image: { medium: 'https://img.test/ada.jpg' }, siteUrl: 'https://anilist.co/character/5' },
        voiceActors: [{ id: 6, name: { full: 'Aoi Voice', native: '青い声' }, image: { medium: 'https://img.test/aoi.jpg' }, languageV2: 'Japanese', siteUrl: 'https://anilist.co/staff/6', primaryOccupations: ['Voice Actor'] }],
      },
    ],
  },
  staff: {
    edges: [
      { role: 'DIRECTOR', node: { id: 10, name: { full: 'A Director', native: '監督' }, image: { medium: 'https://img.test/director.jpg' }, primaryOccupations: ['Director'], siteUrl: 'https://anilist.co/staff/10' } },
      { role: 'WRITER', node: { id: 10, name: { full: 'A Director', native: '監督' }, image: { medium: 'https://img.test/director.jpg' }, primaryOccupations: ['Director'], siteUrl: 'https://anilist.co/staff/10' } },
    ],
  },
  relations: {
    edges: [
      { relationType: 'SEQUEL', node: { id: 44, title: { romaji: 'Next Signal' }, coverImage: null, format: 'TV', averageScore: 80 } },
      { relationType: 'PREQUEL', node: { id: 41, title: { romaji: 'Before Signal' }, coverImage: null, format: 'OVA', averageScore: 79 } },
    ],
  },
  recommendations: null,
})

describe('anime detail model', () => {
  it('deduplicates primary and alternate titles while retaining meaningful labels', () => {
    expect(getDetailTitles(detail)).toEqual([
      { label: 'Romaji', value: 'Signal' },
      { label: 'Native', value: 'シグナル' },
    ])
  })

  it('normalizes staff, studios, tags, and safe external links', () => {
    expect(getStaffMembers(detail)).toEqual([
      expect.objectContaining({ id: 10, name: 'A Director', roles: ['DIRECTOR', 'WRITER'] }),
    ])
    expect(getStudios(detail)[0]).toMatchObject({ id: 7, name: 'Signal Studio', isAnimationStudio: true })
    expect(getDetailTags(detail)).toEqual({
      themes: [expect.objectContaining({ name: 'Time Travel', category: 'テーマ' })],
      tags: [],
    })
    expect(getDetailLinks(detail)).toEqual([
      expect.objectContaining({ site: 'Official', url: 'https://example.com/signal' }),
    ])
  })

  it('orders continuity relations and rejects unsafe URLs', () => {
    expect(getOrderedRelations(detail).map((item) => item.label)).toEqual(['Prequel', 'Sequel'])
    expect(isSafeExternalUrl('https://anilist.co/anime/42')).toBe(true)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('//example.com/path')).toBe(false)
  })

  it('returns a manga source relation only when it is unique', () => {
    const mangaSource = { relationType: 'SOURCE', node: { id: 52, type: 'MANGA', title: { romaji: 'Signal Manga' }, coverImage: null, averageScore: 80 } }
    expect(getSingleMangaSourceRelation({ ...detail, relations: { edges: [mangaSource] } })).toBe(52)
    expect(getSingleMangaSourceRelation({ ...detail, relations: { edges: [mangaSource, { ...mangaSource, node: { ...mangaSource.node, id: 53 } }] } })).toBeNull()
    expect(getSingleMangaSourceRelation({ ...detail, relations: { edges: [{ ...mangaSource, relationType: 'SEQUEL' }] } })).toBeNull()
  })
})
