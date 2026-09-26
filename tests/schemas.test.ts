import { describe, expect, it } from 'vitest'
import { anisourceAnimeSchema, episodeSchema, streamSchema } from '../app/data/anisource/schema'
import { detailShape, graphQLResponseShape, mediaShape } from '../app/data/anilist/schema'

describe('boundary schemas', () => {
  it('rejects AniSource anime records missing required identity fields', () => {
    expect(() => anisourceAnimeSchema.parse({ title: 'Missing ID', url: 'https://source.test/anime' })).toThrow()
    expect(() => anisourceAnimeSchema.parse({ id: 'anime-1', url: 'https://source.test/anime' })).toThrow()
  })

  it('applies documented defaults when optional AniSource fields are omitted', () => {
    expect(anisourceAnimeSchema.parse({ id: 'anime-1', title: 'Anime', url: 'https://source.test/anime' }))
      .toMatchObject({ thumbnail: '', genres: [], status: 'unknown' })
    expect(episodeSchema.parse({ id: 'ep-1', number: 1, title: 'Episode' }))
      .toMatchObject({ is_filler: false, has_sub: false, has_dub: false })
    expect(streamSchema.parse({ url: 'https://video.test/a.m3u8', quality: '1080p' }))
      .toMatchObject({ headers: {}, subtitles: [], is_hls: false, is_audio: false })
  })

  it('rejects GraphQL envelopes with no data field', () => {
    expect(() => graphQLResponseShape.parse({ errors: [{ message: 'Missing data' }] })).toThrow()
  })

  it('rejects AniList media without a numeric identity', () => {
    expect(() => mediaShape.parse({ id: 'not-a-number' })).toThrow()
  })

  it('rejects detail links with malformed URL data', () => {
    expect(() => detailShape.parse({
      id: 2,
      startDate: null,
      endDate: null,
      externalLinks: [{ id: 1, site: 'Official', url: 42 }],
    })).toThrow()
  })
})
