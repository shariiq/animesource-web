import { describe, expect, it } from 'vitest'
import { anisourceAnimeSchema, episodeSchema, streamSchema } from '../app/data/anisource/schema'
import { detailShape, graphQLResponseShape, mediaShape } from '../app/data/anilist/schema'

describe('boundary schemas', () => {
  it('rejects AniSource records without required identity fields', () => {
    expect(() => anisourceAnimeSchema.parse({ title: 'Missing id' })).toThrow()
  })
  it('defaults optional AniSource fields', () => {
    expect(animeSourceFixture()).toMatchObject({ thumbnail: '', genres: [], status: 'unknown' })
  })
  it('defaults episode flags and stream metadata', () => {
    expect(episodeSchema.parse({ id: 'ep', number: 1, title: 'Episode' })).toMatchObject({ is_filler: false, has_sub: false, has_dub: false })
    expect(streamSchema.parse({ url: 'https://video.test/a.m3u8', quality: '1080p' })).toMatchObject({ headers: {}, subtitles: [], is_hls: false })
  })
  it('accepts GraphQL data with optional errors omitted', () => {
    expect(graphQLResponseShape.parse({ data: { Media: null } })).toEqual({ data: { Media: null } })
  })
  it('rejects malformed AniList media', () => {
    expect(() => mediaShape.parse({ id: 'not-a-number' })).toThrow()
  })
  it('allows nullable detail fields', () => {
    expect(detailShape.parse({ id: 1, title: null, siteUrl: null, coverImage: null, bannerImage: null, averageScore: null, popularity: null, format: null, status: null, episodes: null, season: null, seasonYear: null, genres: null, nextAiringEpisode: null, description: null, duration: null, startDate: null, endDate: null, source: null, synonyms: null, studios: null, trailer: null, externalLinks: null, rankings: null, tags: null, staff: null, characters: null, relations: null, recommendations: null })).toMatchObject({ id: 1 })
  })
  it('validates expanded detail identity and link fields', () => {
    const parsed = detailShape.parse({
      id: 2,
      siteUrl: 'https://anilist.co/anime/2',
      title: null,
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
      synonyms: null,
      studios: { nodes: [{ id: 8, name: 'Studio', isAnimationStudio: true, siteUrl: 'https://anilist.co/studio/8' }] },
      trailer: null,
      externalLinks: [{ id: 1, site: 'Official', type: 'INFO', language: null, color: null, icon: null, url: 'https://example.com', isDisabled: true }],
      rankings: null,
      tags: null,
      staff: null,
      characters: null,
      relations: null,
      recommendations: null,
    })
    expect(parsed.studios?.nodes?.[0]).toMatchObject({ id: 8, isAnimationStudio: true })
    expect(parsed.externalLinks?.[0]).toMatchObject({ isDisabled: true })
    expect(() => detailShape.parse({ ...parsed, externalLinks: [{ id: 1, site: 'Official', url: 42 }] })).toThrow()
  })
})

function animeSourceFixture() {
  return anisourceAnimeSchema.parse({ id: 'a', title: 'Anime', url: 'https://source.test/a' })
}
